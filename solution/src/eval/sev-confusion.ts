import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDataset } from '../util/dataset.ts';
import { loadEnv } from '../util/env.ts';
import type { ExtractionResult } from '../extraction/schema.ts';
import { SEVERITY_RANK } from './severity-rank.ts';

const cfg = loadEnv();
const byId = new Map<number, ExtractionResult>();
for (const line of readFileSync(join(process.cwd(), cfg.dataDir, 'processed', 'results.jsonl'), 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const r = JSON.parse(line) as ExtractionResult;
  byId.set(r.caseId, r);
}
const gtById = new Map(loadDataset().map((c) => [c.id, c.ground_truth as { severity?: string | null; case_type?: string; case_kind?: string; zones?: string[] }]));

const conf: Record<string, Record<string, number>> = {};
const predSev = (r: ExtractionResult) => r.damages.reduce((acc, d) => { const r = SEVERITY_RANK[d.severity] ?? 0; return acc && acc.rank >= r ? acc : { rank: r, sev: d.severity }; }, null as null | { rank: number; sev: string });

const errors: Array<{ id: number; gt: string; pred: string; kind: string; text: string }> = [];
for (const [id, r] of byId) {
  const gt = gtById.get(id);
  if (!gt || gt.case_type !== 'damage') continue;
  const p = predSev(r)?.sev ?? 'unknown';
  conf[gt.severity ?? '?'] ??= {};
  conf[gt.severity ?? '?'][p] = (conf[gt.severity ?? '?'][p] ?? 0) + 1;
  if (p !== gt.severity) {
    const c = loadDataset().find((x) => x.id === id)!;
    errors.push({ id, gt: gt.severity ?? '', pred: p, kind: gt.case_kind ?? '', text: c.freitext.slice(0, 220).replace(/\n/g, ' | ') });
  }
}
console.log('confusion matrix (rows=GT, cols=pred):');
console.log(JSON.stringify(conf, null, 2));
console.log(`errors: ${errors.length}`);
for (const e of errors.slice(0, 30)) console.log(`#${e.id} [${e.kind}] gt=${e.gt} pred=${e.pred}\n  ${e.text}\n`);
