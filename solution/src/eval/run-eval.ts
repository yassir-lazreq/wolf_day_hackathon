/**
 * Full evaluation over all processed cases (Phase 6).
 * Reads results.jsonl (deduped: last record per case wins), joins with
 * ground truth (evaluation-only), computes metrics, writes
 * data/evaluation/metrics.json + case-level scores.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDataset } from '../util/dataset.ts';
import { loadEnv } from '../util/env.ts';
import type { ExtractionResult } from '../extraction/schema.ts';
import { computeMetrics, formatMetrics, groundTruthFromRaw, type CaseScore } from './metrics.ts';

const cfg = loadEnv();
const processedDir = join(process.cwd(), cfg.dataDir, 'processed');
const evalDir = join(process.cwd(), cfg.dataDir, 'evaluation');
mkdirSync(evalDir, { recursive: true });

const resultsFile = join(processedDir, 'results.jsonl');
if (!existsSync(resultsFile)) throw new Error(`no results at ${resultsFile}`);

// dedupe: last write per caseId wins
const byId = new Map<number, ExtractionResult>();
for (const line of readFileSync(resultsFile, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const r = JSON.parse(line) as ExtractionResult;
  byId.set(r.caseId, r);
}
console.log(`results: ${byId.size} distinct cases`);

const dataset = loadDataset();
const gtById = new Map<number, ReturnType<typeof groundTruthFromRaw>>();
for (const c of dataset) {
  const gt = groundTruthFromRaw(c.ground_truth as Parameters<typeof groundTruthFromRaw>[0]);
  gt.case_id = c.id;
  gtById.set(c.id, gt);
}

const pairs = [];
const scores: CaseScore[] = [];
for (const [caseId, pred] of byId) {
  const gt = gtById.get(caseId);
  if (!gt) {
    console.log(`[warn] no ground truth for case ${caseId} — skipped`);
    continue;
  }
  const { scoreCase } = await import('./metrics.ts');
  const sc = scoreCase(pred, gt);
  scores.push(sc);
  pairs.push({ pred, gt });
}

const metrics = computeMetrics(pairs);
console.log('\n' + formatMetrics(metrics) + '\n');

writeFileSync(
  join(evalDir, 'metrics.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), nResults: byId.size, metrics }, null, 2),
);

// failure cases for the evaluation UI
const failures = scores
  .filter((s) => !s.caseTypeOk || !s.caseKindOk || s.fp.length > 0 || s.fn.length > 0 || s.severityOk === false)
  .map((s) => ({ caseId: s.caseId, fp: s.fp, fn: s.fn, caseTypeOk: s.caseTypeOk, caseKindOk: s.caseKindOk, severityOk: s.severityOk }));
writeFileSync(join(evalDir, 'failures.json'), JSON.stringify({ failures }, null, 2));
console.log(`wrote ${evalDir}/metrics.json + failures.json (${failures.length} failure cases)`);
