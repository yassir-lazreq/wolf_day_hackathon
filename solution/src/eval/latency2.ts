import { loadDataset } from '../util/dataset.ts';
import { loadEnv } from '../util/env.ts';
import { LlmClient } from '../extraction/llm.ts';

const cfg = loadEnv();
const cases = loadDataset();
const c = cases.find((x) => (x.ground_truth as { case_type?: string }).case_type === 'damage')!;

for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
  const client = new LlmClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model, timeoutMs: 120000, maxRetries: 2 });
  const t0 = Date.now();
  try {
    const r = await client.extract({ caseId: c.id, freitext: c.freitext, manufacturer: c.manufacturer, model: c.model });
    console.log(JSON.stringify({ model, ms: Date.now() - t0, attempts: r.attempts, damages: r.response.damages.length, caseType: r.response.caseType }));
  } catch (e) {
    console.log(JSON.stringify({ model, ms: Date.now() - t0, error: String(e) }));
  }
}
