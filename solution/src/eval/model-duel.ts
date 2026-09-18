import { loadDataset } from '../util/dataset.ts';
import { loadEnv } from '../util/env.ts';
import { runExtraction } from '../extraction/pipeline.ts';
import { LlmClient } from '../extraction/llm.ts';
import { computeMetrics, formatMetrics, groundTruthFromRaw } from './metrics.ts';

const cfg = loadEnv();
const cases = loadDataset();
const dmg = cases.filter((c) => (c.ground_truth as { case_type?: string }).case_type === 'damage').slice(0, 12);
const svc = cases.filter((c) => (c.ground_truth as { case_type?: string }).case_type === 'service').slice(0, 6);
const devSet = [...dmg, ...svc];

for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
  const client = new LlmClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model, timeoutMs: 180000, maxRetries: 3 });
  const pairs = [];
  const t0 = Date.now();
  for (const c of devSet) {
    const pred = await runExtraction(
      {
        caseId: c.id,
        freitext: c.freitext,
        manufacturer: c.manufacturer,
        model: c.model,
        firstStateName: c.states?.[0]?.name ?? '',
        states: [],
        vehicle: { licensePlate: c.license_plate ?? '', mileage: c.mileage ?? 0, firstRegistration: c.first_registration ?? '' },
      },
      { client },
    );
    const gt = groundTruthFromRaw(c.ground_truth as Parameters<typeof groundTruthFromRaw>[0]);
    pairs.push({ pred, gt });
  }
  console.log(`=== ${model} (${((Date.now() - t0) / 1000).toFixed(0)}s) ===\n${formatMetrics(computeMetrics(pairs))}\n`);
}
