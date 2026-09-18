import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractBaseline } from '../src/extraction/baseline.ts';
import { reconcile, overrideSeverity } from '../src/extraction/reconcile.ts';
import { runExtraction } from '../src/extraction/pipeline.ts';
import { LlmClient } from '../src/extraction/llm.ts';
import { llmResponseSchema } from '../src/extraction/schema.ts';
import { lifecycleFromStatus } from '../src/domain/status.ts';

// ---------------- fixtures from real dataset patterns ----------------

const SERVICE_NOTE = `VW Tiguan, QQL-EG 396, km 229651
Inspektion: Große Inspektion inkl. Innenraumfilter.
Scheibenwischer schmieren, bitte erneuern.
Termin steht, Dauer ca. 2 Tage.`;

const SINGLE_DAMAGE_NOTE = `Kunde bringt Fzg., Rangierschaden an der Laderampe. Schaden an Stoßstange hinten links, Lackabrieb, ca. 3 cm Durchmesser.
Zusätzlich Stoßstange vorne betroffen, kleine Delle.
Kunde zahlt selbst, KVA vorab.`;

const MULTI_DAMAGE_NOTE = `Kunde meldet: Vandalismus, Schaden am 04.05. entdeckt. Kotflügel hinten rechts: Kratzer im Klarlack, ca. 5 cm.
Fahrertür ebenfalls: feine Kratzspuren.
Auch Kotflügel vorne rechts beschädigt (Kratzer im Klarlack).
Vollkasko, SB 500 EUR, Schadenmeldung raus.`;

const AMBIGUOUS_NOTE = `Beifahrertür hat eine Delle. Fahrertür ist ok.`;

test('baseline: service note => no damages, service kind', () => {
  const r = extractBaseline({ freitext: SERVICE_NOTE, firstStateName: '🙂Vorgang angelegt' });
  assert.equal(r.caseType, 'service');
  assert.equal(r.caseKind, 'Inspektion');
  assert.equal(r.damages.length, 0);
  assert.equal(r.lifecycleStage, 'neu');
});

test('baseline: single + multi damage with abbreviations', () => {
  const r = extractBaseline({ freitext: SINGLE_DAMAGE_NOTE, firstStateName: '♻️In Bearbeitung' });
  assert.equal(r.caseType, 'damage');
  assert.equal(r.caseKind, 'Rangierschaden');
  assert.equal(r.insuranceType, 'selbstzahler');
  const zones = r.damages.map((d) => d.zoneId).sort();
  assert.deepEqual(zones, ['BUMPER_FRONT_FULL', 'BUMPER_REAR_LEFT']);
  const rear = r.damages.find((d) => d.zoneId === 'BUMPER_REAR_LEFT')!;
  assert.equal(rear.damageType, 'Lackabrieb');
  assert.equal(rear.severity, 'leicht');
});

test('baseline: multi-zone vandalism + full-kasko + Beifahrertür trap', () => {
  const r = extractBaseline({ freitext: MULTI_DAMAGE_NOTE, firstStateName: '' });
  assert.deepEqual(r.damages.map((d) => d.zoneId).sort(), ['DOOR_FRONT_LEFT', 'FENDER_FRONT_RIGHT', 'FENDER_REAR_RIGHT']);
  assert.equal(r.insuranceType, 'vollkasko');
  assert.equal(r.caseKind, 'Vandalismus');
});

test('baseline: Beifahrertür not matched as Fahrertür (trap)', () => {
  const r = extractBaseline({ freitext: 'Beifahrertür hat eine Delle.', firstStateName: '' });
  assert.deepEqual(r.damages.map((d) => d.zoneId), ['DOOR_FRONT_RIGHT']);
});

test('baseline: negative mention "Fahrertür ist ok" still lists the zone (deterministic hint, LLM disambiguates)', () => {
  const r = extractBaseline({ freitext: AMBIGUOUS_NOTE, firstStateName: '' });
  assert.deepEqual(r.damages.map((d) => d.zoneId).sort(), ['DOOR_FRONT_LEFT', 'DOOR_FRONT_RIGHT']);
});

// ---------------- reconciliation / business rules ----------------

test('reconcile: service case with LLM damages gets flagged, damages kept', () => {
  const llm = llmResponseSchema.parse({
    caseType: 'service',
    caseKind: 'Inspektion',
    insuranceType: 'unknown',
    damages: [{ zone: 'Dach', damageType: 'Delle', severity: 'leicht', evidence: 'Dach mit Dellen', confidence: 0.6 }],
    overallConfidence: 0.6,
  });
  const r = reconcile({
    freitext: 'Inspektion. Dach mit Dellen.',
    llm,
    baseline: extractBaseline({ freitext: 'Inspektion. Dach mit Dellen.', firstStateName: '' }),
  });
  assert.equal(r.damages.length, 1);
  assert.ok(r.warnings.some((w) => w.includes('caseType=service')));
});

test('reconcile: duplicate LLM zones merged deterministically (strongest severity wins)', () => {
  const llm = llmResponseSchema.parse({
    caseType: 'damage',
    caseKind: 'Parkschaden',
    insuranceType: 'unknown',
    damages: [
      { zone: 'Stoßstange hinten links', damageType: 'Kratzer', severity: 'leicht', evidence: 'Kratzer an Stoßstange hinten links', confidence: 0.5 },
      { zone: 'Stoßstange hinten links', damageType: 'Delle', severity: 'mittel', evidence: 'Delle', confidence: 0.7 },
    ],
    overallConfidence: 0.7,
  });
  const r = reconcile({
    freitext: MULTI_DAMAGE_NOTE,
    llm,
    baseline: extractBaseline({ freitext: MULTI_DAMAGE_NOTE, firstStateName: '' }),
  });
  const bumper = r.damages.filter((d) => d.zoneId === 'BUMPER_REAR_LEFT');
  assert.equal(bumper.length, 1); // merged, no duplicate zone
  assert.equal(bumper[0].severity, 'mittel');
  assert.equal(bumper[0].confidence, 0.7);
  // hybrid fill still adds the baseline zones from the note
  assert.ok(r.damages.length > 1);
});

test('reconcile: unresolvable LLM zone falls back to the single zone in the text', () => {
  const llm = llmResponseSchema.parse({
    caseType: 'damage',
    caseKind: 'Parkschaden',
    insuranceType: 'unknown',
    damages: [{ zone: 'Kofferraum', damageType: 'Delle', severity: 'leicht', evidence: 'Delle', confidence: 0.5 }],
    overallConfidence: 0.5,
  });
  const r = reconcile({
    freitext: 'Schaden an Heckklappe.',
    llm,
    baseline: extractBaseline({ freitext: 'Schaden an Heckklappe.', firstStateName: '' }),
  });
  assert.equal(r.damages.length, 1);
  assert.equal(r.damages[0].zoneId, 'TAILGATE');
});

test('reconcile: unresolvable LLM zone with multiple text zones is dropped and flagged', () => {
  const llm = llmResponseSchema.parse({
    caseType: 'damage',
    caseKind: 'Parkschaden',
    insuranceType: 'unknown',
    damages: [{ zone: 'Unterboden', damageType: 'Delle', severity: 'leicht', evidence: 'Delle', confidence: 0.5 }],
    overallConfidence: 0.5,
  });
  const r = reconcile({
    freitext: 'Schaden an Heckklappe und Dach.',
    llm,
    baseline: extractBaseline({ freitext: 'Schaden an Heckklappe und Dach.', firstStateName: '' }),
  });
  assert.ok(r.warnings.some((w) => w.includes('not resolvable')));
});

test('reconcile: empty evidence damage dropped and flagged', () => {
  const llm = llmResponseSchema.parse({
    caseType: 'damage',
    caseKind: 'Parkschaden',
    insuranceType: 'unknown',
    damages: [{ zone: 'Dach', damageType: 'Delle', severity: 'leicht', evidence: '   ', confidence: 0.5 }],
    overallConfidence: 0.5,
  });
  const r = reconcile({
    freitext: 'Dach beschädigt.',
    llm,
    baseline: extractBaseline({ freitext: 'Dach beschädigt.', firstStateName: '' }),
  });
  assert.ok(r.warnings.some((w) => w.includes('without evidence')));
  assert.equal(r.damages.every((d) => d.evidence.trim().length > 0), true);
});

test('reconcile: bumper side damage infers full bumper replacement', () => {
  const llm = llmResponseSchema.parse({
    caseType: 'damage',
    caseKind: 'Parkschaden',
    insuranceType: 'unknown',
    damages: [{ zone: 'Stoßstange vorne links', damageType: 'Kunststoff eingedrückt', severity: 'mittel', evidence: 'Kunststoff eingedrückt an Stoßstange vorne links', confidence: 0.9 }],
    overallConfidence: 0.9,
  });
  const r = reconcile({
    freitext: 'Kunststoff eingedrückt an Stoßstange vorne links.',
    llm,
    baseline: extractBaseline({ freitext: 'Kunststoff eingedrückt an Stoßstange vorne links.', firstStateName: '' }),
  });
  assert.equal(r.damages[0].action, 'austauschen');
  assert.equal(r.damages[0].replacementPart, 'BUMPER_FRONT_FULL');
  assert.equal(r.damages[0].replacementInferred, true);
});

test('overrideSeverity: unambiguous vocabulary overrides', () => {
  assert.equal(overrideSeverity('leicht', 'Träger verformt an Stoßstange hinten.'), 'schwer');
  assert.equal(overrideSeverity('schwer', 'feine Kratzspuren an der Tür.'), 'leicht');
  assert.equal(overrideSeverity('unknown', 'Halterung gebrochen, ca. 25 cm.'), 'mittel');
  assert.equal(overrideSeverity('mittel', 'irgendein Text ohne Signal'), 'mittel');
});

test('reconcile: severity override applied post-LLM', () => {
  const llm = llmResponseSchema.parse({
    caseType: 'damage',
    caseKind: 'Auffahrunfall',
    insuranceType: 'unknown',
    damages: [{ zone: 'Stoßstange hinten', damageType: 'verformt', severity: 'leicht', evidence: 'Träger verformt an Stoßstange hinten, über zwei Bauteile', confidence: 0.8 }],
    overallConfidence: 0.8,
  });
  const r = reconcile({
    freitext: 'Träger verformt an Stoßstange hinten, über zwei Bauteile.',
    llm,
    baseline: extractBaseline({ freitext: 'Träger verformt an Stoßstange hinten, über zwei Bauteile.', firstStateName: '' }),
  });
  assert.equal(r.damages[0].severity, 'schwer');
});

// ---------------- validation of malformed LLM responses ----------------

test('zod: malformed LLM response rejected', () => {
  const bad = { caseType: 'nonsense', damages: 'not-an-array' };
  assert.equal(llmResponseSchema.safeParse(bad).success, false);
  const bad2 = { caseType: 'damage', caseKind: 'X', insuranceType: 'unknown', damages: [{ zone: 'Dach', severity: 'schwer', evidence: 'x', confidence: 5 }], overallConfidence: 0.5 };
  assert.equal(llmResponseSchema.safeParse(bad2).success, false); // confidence out of bounds
});

// ---------------- pipeline fallback (API error path) ----------------

test('pipeline: LLM failure falls back to baseline and records the error', async () => {
  const broken = new LlmClient({ apiKey: 'x', baseUrl: 'http://127.0.0.1:1', model: 'deepseek-flash', timeoutMs: 2000, maxRetries: 1 });
  const result = await runExtraction(
    {
      caseId: 123456,
      freitext: SINGLE_DAMAGE_NOTE,
      manufacturer: 'VW',
      model: 'Golf',
      firstStateName: '♻️In Bearbeitung',
      states: [],
      vehicle: { licensePlate: 'X-Y 1', mileage: 0, firstRegistration: '' },
    },
    { client: broken },
  );
  assert.equal(result.method, 'baseline');
  assert.ok(result.llmError, 'llmError must be recorded');
  assert.deepEqual(result.damages.map((d) => d.zoneId).sort(), ['BUMPER_FRONT_FULL', 'BUMPER_REAR_LEFT']);
  assert.equal(result.lifecycleStage, lifecycleFromStatus('♻️In Bearbeitung'));
});

test('pipeline: null client runs pure baseline', async () => {
  const result = await runExtraction(
    {
      caseId: 1,
      freitext: SERVICE_NOTE,
      manufacturer: '',
      model: '',
      firstStateName: '🙂Vorgang angelegt',
      states: [],
      vehicle: { licensePlate: '', mileage: 0, firstRegistration: '' },
    },
    { client: null },
  );
  assert.equal(result.method, 'baseline');
  assert.equal(result.caseType, 'service');
});
