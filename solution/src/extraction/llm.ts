/**
 * DeepSeek structured-extraction client (Phase 4).
 *
 * - JSON output mode, strict Zod validation of every response
 * - retries with exponential backoff (429 / 5xx / network)
 * - schema-fix retries: invalid JSON payloads are re-sent once with the
 *   validation error appended
 * - API key lives in process env only, never reaches the browser
 */

import { z } from 'zod';
import { llmResponseSchema, type LlmResponse } from './schema.ts';
import { ZONE_DEFS, ZONE_LIST } from '../domain/zones.ts';
import { CASE_KINDS, CASE_TYPES, INSURANCE_TYPES, SEVERITIES } from '../domain/enums.ts';

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface LlmCaseInput {
  caseId: number;
  freitext: string;
  manufacturer?: string;
  model?: string;
}

const ZONE_LABELS = ZONE_LIST.map((z) => z.germanLabel).join('\n');

function buildSystemPrompt(): string {
  return [
    'Du bist ein Extraktionssystem für Werkstatt-Notizen einer deutschen Autohausgruppe.',
    'Deine Aufgabe: strukturiere den Freitext. Du arbeitest ausschließlich mit dem gegebenen Text.',
    '',
    'Regeln:',
    '1. Der Text bleibt Deutsch. Übersetze NICHTS. Alle evidence-Angaben sind wörtliche Zitate aus dem Text.',
    '2. Unterscheide Servicefälle (Inspektion, Ölwechsel, HU/AU, Bremsen, Räder/Reifen) von Schadenfällen.',
    '3. Nenne nur Schäden, die der Text belegt. Vermute keine weiteren Schäden und keine Ersatzteile.',
    '4. Mehrere Schadenszonen sind möglich — eine Eintrag pro Zone.',
    '5. Verstehe Positionsangaben: "vorne links", "hinten rechts", Abkürzungen wie VL, VR, HL, HR, "li.", "re.", Werkstattkürzel wie KVA (Kostenvoranschlag), KV, SB (Selbstbeteiligung), TK, VK, Fzg., KD (Kunde).',
    '6. "zone" MUSS exakt einer der folgenden 22 Zonenbezeichnungen entsprechen:',
    ZONE_LABELS,
    '7. "severity": leicht | mittel | schwer | unknown. Nur aus Textsignalen ableiten (z.B. "über zwei Bauteile", "flächig" => schwer; "Kratzer im Klarlack", "feine Kratzspuren" => leicht; "handtellergroß" => mittel).',
    '8. "caseType": damage | service | unknown. "caseKind": eine der folgenden Bezeichnungen oder unknown: ' + CASE_KINDS.join(', '),
    '9. "insuranceType": teilkasko | vollkasko | haftpflicht_gegner | selbstzahler | gesteuert | unknown ("gesteuert" bei Flottenpartner/Steuerung).',
    '10. "damageType" ist eine kurze deutsche Beschreibung aus dem Text (z.B. "Kratzer im Klarlack"), max. 5 Wörter. Unbekannt => "unknown".',
    '11. "evidence" ist ein wörtlicher deutscher Textschnipsel, der den Schaden belegt. Niemals erfinden. Ist keine Evidenz vorhanden, darf der Schaden nicht aufgeführt werden.',
    '12. "confidence": 0.0–1.0 als Zahl, MUSS in jedem damages-Eintrag stehen. Niedrig bei unsicherer Zuordnung.',
    '13. Berechne keine Statistiken. Gib nur die Struktur aus.',
    '14. Ausgabe: nur gültiges JSON mit den Feldern caseType, caseKind, insuranceType, damages[], overallConfidence.',
    '15. Bei reinen Servicefällen: damages = [].',
    '16. Falls im Text Datumszeilen mit "~~~~~" und Autorenkürzeln stehen: Das sind Verlaufszeilen, sie gehören mit zum Befund, aber der Erstbefund (davor) ist maßgeblich für die Zonen.',
  ].join('\n');
}

function buildUserPrompt(input: LlmCaseInput): string {
  const header =
    input.manufacturer || input.model
      ? `Fahrzeug: ${input.manufacturer ?? ''} ${input.model ?? ''}\n\n`
      : '';
  return `${header}Werkstatt-Notiz:\n"""\n${input.freitext}\n"""`;
}

export class LlmClient {
  private cfg: LlmConfig;

  constructor(cfg: LlmConfig) {
    this.cfg = cfg;
  }

  get modelName(): string {
    return this.cfg.model;
  }

  private async chat(messages: Array<{ role: string; content: string }>, signal?: AbortSignal): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 1200,
        stream: false,
      }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`DeepSeek HTTP ${res.status}: ${body.slice(0, 300)}`) as Error & { status?: number; retryAfter?: string };
      err.status = res.status;
      err.retryAfter = res.headers.get('retry-after') ?? undefined;
      throw err;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!data.choices?.[0]?.message?.content) {
      throw new Error(`DeepSeek empty response: ${JSON.stringify(data.error ?? data).slice(0, 300)}`);
    }
    return data.choices[0].message.content;
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    });
  }

  /**
   * One extraction call with retry/backoff and one schema-correction retry.
   * Returns { response, attempts }.
   */
  async extract(input: LlmCaseInput): Promise<{ response: LlmResponse; attempts: number }> {
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(input) },
    ];
    let attempts = 0;

    while (attempts < this.cfg.maxRetries) {
      attempts += 1;
      const signal = AbortSignal.timeout(this.cfg.timeoutMs);
      try {
        const raw = await this.chat(messages, signal);
        const parsed = this.parseJson(raw);
        if (parsed.success) return { response: parsed.data, attempts };
        // schema mismatch: one correction attempt with the error fed back
        if (attempts >= this.cfg.maxRetries) {
          throw new Error(`schema validation failed after ${attempts} attempts: ${z.prettifyError(parsed.error).slice(0, 500)}`);
        }
        const errMsg = z.prettifyError(parsed.error);
        messages.push(
          { role: 'assistant', content: raw.slice(0, 4000) },
          {
            role: 'user',
            content: `Deine Antwort war kein gültiges JSON gemäß Schema. Fehler: ${errMsg}. Gib NUR das korrigierte JSON aus.`,
          },
        );
      } catch (e) {
        const err = e as Error & { status?: number; retryAfter?: string };
        const transient = !err.status || err.status === 429 || err.status >= 500;
        if (!transient || attempts >= this.cfg.maxRetries) throw err;
        const retryAfterMs = err.retryAfter ? Number(err.retryAfter) * 1000 : null;
        const wait = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : Math.min(30_000, 500 * 2 ** attempts + Math.random() * 250);
        await this.sleep(wait);
      }
    }
    throw new Error('unreachable');
  }

  private parseJson(raw: string): { success: true; data: LlmResponse } | { success: false; error: z.ZodError } {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let obj: unknown;
    try {
      obj = JSON.parse(cleaned);
    } catch {
      // salvage: find first { ... last } — unreliable free-form fallback
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) return { success: false, error: new z.ZodError([{ code: 'custom', message: 'no JSON object found', path: [] }]) };
      try {
        obj = JSON.parse(m[0]);
      } catch {
        return { success: false, error: new z.ZodError([{ code: 'custom', message: 'JSON unparsable', path: [] }]) };
      }
    }
    const parsed = llmResponseSchema.safeParse(obj);
    if (!parsed.success) return { success: false, error: parsed.error };
    return { success: true, data: parsed.data };
  }
}

export function validateCanonical(zoneId: string): boolean {
  return Object.keys(ZONE_DEFS).includes(zoneId);
}

export { CASE_KINDS, CASE_TYPES, INSURANCE_TYPES, SEVERITIES };
