/**
 * Deterministic baseline extractor (Phase 3).
 *
 * Pure dictionary/regex extraction. No LLM, no ground truth.
 * Provides the lower bound that the hybrid and LLM pipelines are measured
 * against, and acts as the fallback when the API is unavailable.
 */

import type { CaseKind, CaseType, InsuranceType, LifecycleStage, Severity } from '../domain/enums.ts';
import {
  findZoneMentions,
  INSURANCE_HINTS,
  KIND_HINTS,
  normalizeNoteText,
  SEVERITY_HINTS,
} from '../domain/glossary.ts';
import { lifecycleFromStatus } from '../domain/status.ts';
import { type ZoneId } from '../domain/zones.ts';

export interface BaselineDamage {
  zoneId: ZoneId;
  damageType: string;
  severity: Severity | 'unknown';
  evidence: string;
}

export interface BaselineResult {
  caseType: CaseType | 'unknown';
  caseKind: CaseKind | 'unknown';
  insuranceType: InsuranceType | 'unknown';
  lifecycleStage: LifecycleStage;
  damages: BaselineDamage[];
}

/** Damage-type phrases matched near a zone mention (window ±160 chars). */
const DAMAGE_TYPE_PATTERNS: ReadonlyArray<{ type: string; re: RegExp }> = [
  { type: 'Kratzer im Klarlack', re: /kratzer\s+im\s+klarlack/i },
  { type: 'feine Kratzspuren', re: /feine\s+kratzspuren/i },
  { type: 'Riss im Lack', re: /riss\s+im\s+lack/i },
  { type: 'Lackabrieb', re: /lackabrieb/i },
  { type: 'Lack abgeplatzt', re: /lack\s+abgeplatzt/i },
  { type: 'Kunststoff eingedrückt', re: /kunststoff\s+eingedrückt/i },
  { type: 'Beule', re: /\bbeule\b/i },
  { type: 'Delle', re: /\bdelle\b/i },
  { type: 'Halterung gebrochen', re: /halterung\s+gebrochen/i },
  { type: 'Blech verzogen', re: /blech\s+verzogen/i },
  { type: 'Träger verformt', re: /träger\s+verformt/i },
  { type: 'Steinschlag', re: /steinschlag/i },
  { type: 'Teil gerissen', re: /teil\s+gerissen/i },
  { type: 'Glasbruch', re: /glasbruch/i },
];

const SEVERITY_RANK: Record<string, number> = { unknown: 0, leicht: 1, mittel: 2, schwer: 3 };

function firstMatch(text: string, patterns: ReadonlyArray<{ type: string; re: RegExp }>): string | null {
  for (const p of patterns) if (p.re.test(text)) return p.type;
  return null;
}

function severityNear(normText: string, mentionStart: number): Severity | 'unknown' {
  const from = Math.max(0, mentionStart - 160);
  const to = Math.min(normText.length, mentionStart + 220);
  const window = normText.slice(from, to);
  const hits = SEVERITY_HINTS.filter((h) => h.patterns.some((p) => p.test(window)));
  if (hits.length === 0) return 'unknown';
  hits.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return hits[0].severity as Severity;
}

function damageTypeNear(normText: string, mentionStart: number): string {
  const from = Math.max(0, mentionStart - 160);
  const to = Math.min(normText.length, mentionStart + 220);
  return firstMatch(normText.slice(from, to), DAMAGE_TYPE_PATTERNS) ?? 'unknown';
}

/** Original (non-normalized) evidence snippet around a normalized-text offset. */
function evidenceSnippet(original: string, normText: string, mentionStart: number): string {
  // approximate: find the same region in the original text by proportional mapping
  const start = Math.max(0, mentionStart - 60);
  const end = Math.min(normText.length, mentionStart + 90);
  return normText.slice(start, end).trim();
}

export interface BaselineInput {
  freitext: string;
  firstStateName?: string;
}

export function extractBaseline(input: BaselineInput): BaselineResult {
  const norm = normalizeNoteText(input.freitext);
  const mentions = findZoneMentions(norm);
  const damages: BaselineDamage[] = [];
  const seen = new Set<ZoneId>();
  for (const m of mentions) {
    if (seen.has(m.zoneId)) continue;
    seen.add(m.zoneId);
    damages.push({
      zoneId: m.zoneId,
      damageType: damageTypeNear(norm, m.start),
      severity: severityNear(norm, m.start),
      evidence: evidenceSnippet(input.freitext, norm, m.start),
    });
  }

  const kindHits = KIND_HINTS.filter((h) => h.patterns.some((p) => p.test(norm)));
  const caseKind = (kindHits[0]?.kind as CaseKind | undefined) ?? 'unknown';

  let caseType: CaseType | 'unknown';
  if (damages.length > 0) caseType = 'damage';
  else if (kindHits.length > 0) caseType = 'service';
  else caseType = 'unknown';

  const insHits = INSURANCE_HINTS.filter((h) => h.patterns.some((p) => p.test(norm)));
  const insuranceType = (insHits[0]?.type as InsuranceType | undefined) ?? 'unknown';

  const lifecycleStage = lifecycleFromStatus(input.firstStateName ?? '');

  return { caseType, caseKind, insuranceType, lifecycleStage, damages };
}
