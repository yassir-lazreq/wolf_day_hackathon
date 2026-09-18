/**
 * Model comparison smoke test (dev set).
 * Runs baseline / deepseek-flash / deepseek-v4-pro on a fixed dev sample
 * and prints metrics. Ground truth used for scoring only.
 */

import { loadDataset } from '../util/dataset.ts';
import { loadEnv } from '../util/env.ts';
import { runExtraction } from '../extraction/pipeline.ts';
import { LlmClient } from '../extraction/llm.ts';
import { computeMetrics, formatMetrics, groundTruthFromRaw } from './metrics.ts';

const cfg = loadEnv();
const cases = loadDataset();
const DEV_SIZE = Number(process.env.DEV_SIZE || 25);

const dev = cases.filter((c) => (c.ground_truth as { case_type?: string })?.case_type).slice(0, DEV_SIZE * 2);
const devDamage = dev.filter((c) => (c.ground_truth as { case_type?: string }).case_type === 'damage').slice(0, Math.ceil(DEV_SIZE / 2));
const devService = dev.filter((c) => (c.ground_truth as { case_type?: string }).case_type === 'service').slice(0, Math.floor(DEV_SIZE / 2));
const devSet = [...devDamage, ...devService].sort((a, b) => a.id - b.id);

console.log(`dev set: ${devSet.length} cases (${devDamage.length} damage / ${devService.length} service)\n`);

async function evaluate(name: string, model: string | null) {
  const client = model ? new LlmClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model, timeoutMs: cfg.timeoutMs, maxRetries: cfg.maxRetries }) : null;
  const pairs = [];
  for (const c of devSet) {
    const input = {
      caseId: c.id,
      freitext: c.freitext,
      manufacturer: c.manufacturer,
      model: c.model,
      firstStateName: c.states?.[0]?.name ?? '',
      states: [],
      vehicle: { licensePlate: c.license_plate ?? '', mileage: c.mileage ?? 0, firstRegistration: c.first_registration ?? '' },
    };
    const pred = await runExtraction(input, { client });
    const gt = groundTruthFromRaw(c.ground_truth as Parameters<typeof groundTruthFromRaw>[0]);
    pairs.push({ pred, gt });
  }
  const m = computeMetrics(pairs);
  console.log(`=== ${name} ===\n${formatMetrics(m)}\n`);
  return pairs;
}

const baselinePairs = await evaluate('baseline (deterministic)', null);
if (process.env.SKIP_LLM !== '1') {
  await evaluate('deepseek-flash', 'deepseek-flash');
  await evaluate('deepseek-v4-pro', 'deepseek-v4-pro');
}

// print a few examples from baseline for debugging
console.log('--- sample outputs (baseline) ---');
for (const { pred, gt } of baselinePairs.slice(0, 3)) {
  console.log(JSON.stringify({ id: pred.caseId, caseType: pred.caseType, caseKind: pred.caseKind, zones: pred.damages.map((d) => d.zoneId), gtZones: gt.zones, severity: pred.damages.map((d) => d.severity), gtSeverity: gt.severity }, null, 2));
}
