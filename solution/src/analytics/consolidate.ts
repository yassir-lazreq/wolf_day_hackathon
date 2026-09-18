/**
 * Deterministic analytics + consolidation (Phase 9).
 * Aggregates ONLY over structured extraction results and structured
 * dataset fields. No LLM statistics anywhere.
 * Writes the JSON artifacts the frontend consumes:
 *   frontend/public/data/cases-extracted.json
 *   frontend/public/data/analytics.json
 *   frontend/public/data/eval-summary.json
 *   frontend/public/data/zones.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadDataset, type RawCase } from '../util/dataset.ts';
import { loadEnv } from '../util/env.ts';
import type { ExtractionResult } from '../extraction/schema.ts';
import { SEVERITY_RANK } from '../eval/severity-rank.ts';
import { ZONE_DEFS, ZONE_LIST } from '../domain/zones.ts';
import { DAMAGE_KINDS, SERVICE_KINDS } from '../domain/enums.ts';

const cfg = loadEnv();
const processedDir = join(process.cwd(), cfg.dataDir, 'processed');
const evalDir = join(process.cwd(), cfg.dataDir, 'evaluation');
const frontendDataDir = resolve(process.cwd(), '../track-b/frontend/public/data');
mkdirSync(frontendDataDir, { recursive: true });

const resultsFile = join(processedDir, 'results.jsonl');
if (!existsSync(resultsFile)) throw new Error(`no ${resultsFile}`);
const byId = new Map<number, ExtractionResult>();
for (const line of readFileSync(resultsFile, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const r = JSON.parse(line) as ExtractionResult;
  byId.set(r.caseId, r);
}

const dataset = loadDataset();
const casesById = new Map<number, RawCase>(dataset.map((c) => [c.id, c]));

// ---------- slim per-case payload for the frontend ----------
const extracted = dataset
  .map((c) => {
    const r = byId.get(c.id);
    if (!r) return null;
    const maxSev = r.damages.reduce((acc, d) => {
      const rank = SEVERITY_RANK[d.severity] ?? 0;
      return acc >= rank ? acc : rank;
    }, 0);
    return {
      id: c.id,
      licensePlate: c.license_plate,
      manufacturer: c.manufacturer,
      model: c.model,
      modelType: c.model_type,
      firstRegistration: c.first_registration,
      mileage: c.mileage,
      company: c.company ?? '',
      city: c.city ?? '',
      freitext: c.freitext,
      states: (c.states ?? []).map((s) => ({ name: s.name, category: s.category, is_done: s.is_done })),
      orderCount: (c.orders ?? []).length,
      workshopTaskCount: (c.workshop_tasks ?? []).length,
      inOpenList: c.in_open_list,
      createdAt: c.created_at,
      completionDateTime: c.completion_date_time,
      canceledAt: c.canceled_at,
      caseType: r.caseType,
      caseKind: r.caseKind,
      insuranceType: r.insuranceType,
      lifecycleStage: r.lifecycleStage,
      damages: r.damages.map((d) => ({
        zoneId: d.zoneId,
        damageType: d.damageType,
        severity: d.severity,
        status: d.status,
        action: d.action,
        replacementPart: d.replacementPart,
        replacementInferred: d.replacementInferred,
        evidence: d.evidence,
        confidence: d.confidence,
      })),
      maxSeverity: maxSev === 0 ? null : Object.keys(SEVERITY_RANK).find((k) => SEVERITY_RANK[k] === maxSev) ?? null,
      overallConfidence: r.overallConfidence,
      method: r.method,
      warnings: r.warnings,
      llmError: r.llmError,
    };
  })
  .filter((x): x is NonNullable<typeof x> => x !== null);

writeFileSync(join(frontendDataDir, 'cases-extracted.json'), JSON.stringify(extracted));

// ---------- zones metadata (single source of truth exported) ----------
writeFileSync(
  join(frontendDataDir, 'zones.json'),
  JSON.stringify(
    ZONE_LIST.map((z) => ({
      id: z.id,
      germanLabel: z.germanLabel,
      region: z.region,
      replacementPart: z.replacementPart,
      linkedZones: z.linkedZones,
    })),
  ),
);

// ---------- aggregates ----------
const damageCases = extracted.filter((c) => c.caseType === 'damage');
const serviceCases = extracted.filter((c) => c.caseType === 'service');

const count = (xs: Array<string | null>, key: string | null) => xs.filter((x) => x === key).length;

const kindDist = Object.fromEntries(
  [...DAMAGE_KINDS, ...SERVICE_KINDS].map((k) => [k, count(extracted.map((c) => c.caseKind), k)]),
);

const zoneDist: Record<string, number> = {};
const replacementDist: Record<string, number> = {};
const actionDist: Record<string, number> = { instandsetzen: 0, austauschen: 0, smart_repair: 0, pruefen: 0, keine_angabe: 0 };
const zonePairs: Record<string, number> = {};
let damageCountTotal = 0;
for (const c of damageCases) {
  for (const d of c.damages) {
    damageCountTotal += 1;
    zoneDist[d.zoneId] = (zoneDist[d.zoneId] ?? 0) + 1;
    actionDist[d.action] = (actionDist[d.action] ?? 0) + 1;
    if (d.replacementPart && d.action === 'austauschen') {
      replacementDist[d.replacementPart] = (replacementDist[d.replacementPart] ?? 0) + 1;
    }
  }
  const zones = c.damages.map((d) => d.zoneId).sort();
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const key = `${zones[i]}|${zones[j]}`;
      zonePairs[key] = (zonePairs[key] ?? 0) + 1;
    }
  }
}

const severityDist = { leicht: 0, mittel: 0, schwer: 0, unknown: 0 };
for (const c of damageCases) {
  if (c.maxSeverity && c.maxSeverity in severityDist) severityDist[c.maxSeverity as keyof typeof severityDist] += 1;
}

const insuranceDist: Record<string, number> = {};
for (const c of damageCases) insuranceDist[c.insuranceType] = (insuranceDist[c.insuranceType] ?? 0) + 1;

const lifecycleDist: Record<string, number> = {};
for (const c of extracted) lifecycleDist[c.lifecycleStage] = (lifecycleDist[c.lifecycleStage] ?? 0) + 1;

const makeDist: Record<string, number> = {};
for (const c of extracted) makeDist[c.manufacturer] = (makeDist[c.manufacturer] ?? 0) + 1;
const modelDist: Record<string, number> = {};
for (const c of extracted) {
  const key = `${c.manufacturer} ${c.model}`;
  modelDist[key] = (modelDist[key] ?? 0) + 1;
}

const multiZone = damageCases.filter((c) => c.damages.length > 1).length;
const openCases = dataset.filter((c) => c.in_open_list).length;
const canceledCases = dataset.filter((c) => c.canceled_at !== null).length;
const orderCount = dataset.reduce((s, c) => s + (c.orders ?? []).length, 0);
const taskCount = dataset.reduce((s, c) => s + (c.workshop_tasks ?? []).length, 0);
const workLoadTotal = dataset.reduce(
  (s, c) => s + (c.workshop_tasks ?? []).reduce((s2, t) => s2 + ((t as { work_load?: number }).work_load ?? 0), 0),
  0,
);

// ---------- lifecycle duration analysis (only where timestamps exist) ----------
interface Duration { n: number; days: number }
const durations: Record<string, Duration> = {};
for (const c of dataset) {
  if (!c.created_at || !c.completion_date_time) continue;
  const created = new Date(c.created_at).getTime();
  const done = new Date(c.completion_date_time).getTime();
  if (Number.isNaN(created) || Number.isNaN(done) || done < created) continue;
  const days = (done - created) / 86_400_000;
  const r = byId.get(c.id);
  const stage = r?.lifecycleStage ?? 'laufend';
  durations[stage] ??= { n: 0, days: 0 };
  durations[stage].n += 1;
  durations[stage].days += days;
}
const durationStats = Object.fromEntries(
  Object.entries(durations).map(([k, v]) => [k, { n: v.n, avgDays: Math.round((v.days / v.n) * 10) / 10 }]),
);

// ---------- status bottleneck: open cases grouped by current state ----------
const stateDist: Record<string, number> = {};
for (const c of dataset) {
  if (!c.in_open_list) continue;
  const s = c.states?.[0]?.name ?? '(no status)';
  stateDist[s] = (stateDist[s] ?? 0) + 1;
}

// ---------- insights (deterministic templates over computed numbers) ----------
const pct = (n: number, d: number) => `${Math.round((n / d) * 1000) / 10}%`;
const insights: Array<{ title: string; text: string; evidence: string }> = [];
insights.push({
  title: 'Multi-Zone Damage',
  text: `${pct(multiZone, damageCases.length)} of damage cases involve more than one zone.`,
  evidence: `${multiZone} of ${damageCases.length} damage cases`,
});
const topZones = Object.entries(zoneDist).sort((a, b) => b[1] - a[1]).slice(0, 3);
insights.push({
  title: 'Most Frequent Damage Zones',
  text: `The three most frequent zones are ${topZones.map(([z, n]) => `${ZONE_DEFS[z as keyof typeof ZONE_DEFS].germanLabel} (${n})`).join(', ')}.`,
  evidence: `${damageCountTotal} zone mentions across ${damageCases.length} cases`,
});
const topPairs = Object.entries(zonePairs).sort((a, b) => b[1] - a[1]).slice(0, 3);
if (topPairs.length > 0) {
  insights.push({
    title: 'Typical Zone Combinations',
    text: topPairs.map(([k, n]) => {
      const [a, b] = k.split('|');
      return `${ZONE_DEFS[a as keyof typeof ZONE_DEFS].germanLabel} + ${ZONE_DEFS[b as keyof typeof ZONE_DEFS].germanLabel} (${n}×)`;
    }).join('; ') + '.',
    evidence: `${Object.values(zonePairs).reduce((a, b) => a + b, 0)} zone pairs recorded`,
  });
}
const topStates = Object.entries(stateDist).sort((a, b) => b[1] - a[1]).slice(0, 3);
insights.push({
  title: 'Open Cases: Bottlenecks',
  text: `${openCases} cases are open. The most frequent statuses are: ${topStates.map(([s, n]) => `${s} (${n})`).join(', ')}.`,
  evidence: `${openCases} open cases, ${Object.keys(stateDist).length} distinct statuses`,
});
const topKinds = Object.entries(kindDist).sort((a, b) => b[1] - a[1]).slice(0, 3);
insights.push({
  title: 'Order Types',
  text: `The most frequent order types are ${topKinds.map(([k, n]) => `${k} (${n})`).join(', ')}.`,
  evidence: `${extracted.length} evaluated cases`,
});
insights.push({
  title: 'Replace vs. Repair',
  text: `${actionDist.austauschen} damages with replacement recommendation, ${actionDist.instandsetzen + actionDist.smart_repair} with repair.`,
  evidence: `Action distribution: ${JSON.stringify(actionDist)}`,
});

const analytics = {
  generatedAt: new Date().toISOString(),
  totals: {
    cases: extracted.length,
    serviceCases: serviceCases.length,
    damageCases: damageCases.length,
    openCases,
    canceledCases,
    orderCount,
    workshopTaskCount: taskCount,
    workLoadTotal,
    multiZoneDamageCases: multiZone,
  },
  kindDist,
  zoneDist,
  replacementDist,
  actionDist,
  severityDist,
  insuranceDist,
  lifecycleDist,
  makeDist: Object.fromEntries(Object.entries(makeDist).sort((a, b) => b[1] - a[1]).slice(0, 10)),
  modelDist: Object.fromEntries(Object.entries(modelDist).sort((a, b) => b[1] - a[1]).slice(0, 10)),
  zonePairs: Object.fromEntries(Object.entries(zonePairs).sort((a, b) => b[1] - a[1]).slice(0, 12)),
  stateDistTop: Object.fromEntries(Object.entries(stateDist).sort((a, b) => b[1] - a[1]).slice(0, 12)),
  durationStats,
  insights,
};

writeFileSync(join(frontendDataDir, 'analytics.json'), JSON.stringify(analytics));

// ---------- evaluation summary for the frontend ----------
const metricsFile = join(evalDir, 'metrics.json');
if (existsSync(metricsFile)) {
  const metrics = JSON.parse(readFileSync(metricsFile, 'utf8'));
  const failuresFile = join(evalDir, 'failures.json');
  const failures = existsSync(failuresFile) ? JSON.parse(readFileSync(failuresFile, 'utf8')) : { failures: [] };
  writeFileSync(join(frontendDataDir, 'eval-summary.json'), JSON.stringify({ ...metrics, ...failures }));
}

console.log(`wrote frontend artifacts to ${frontendDataDir}`);
console.log(`cases: ${extracted.length}, damage: ${damageCases.length}, multi-zone: ${multiZone}, insights: ${insights.length}`);
