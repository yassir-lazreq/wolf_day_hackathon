/**
 * Checkpointed batch extraction worker (Phase 7).
 *
 * Lifecycle per case: PENDING -> PROCESSING -> COMPLETED | FAILED
 * - bounded concurrency
 * - retries with exponential backoff (429/5xx) inside LlmClient
 * - checkpoint file flushed periodically; resumable after interruption
 * - failed cases stay visible in the checkpoint and in the output
 * - results appended to results.jsonl as they finish
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDataset, toInferenceInput, type RawCase } from '../util/dataset.ts';
import { loadEnv } from '../util/env.ts';
import { runExtraction } from '../extraction/pipeline.ts';
import { LlmClient } from '../extraction/llm.ts';
import type { ExtractionResult } from '../extraction/schema.ts';

export type CaseState = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface CheckpointEntry {
  caseId: number;
  state: CaseState;
  attempts: number;
  error?: string;
  extractedAt?: string;
}

export interface CheckpointFile {
  startedAt: string;
  updatedAt: string;
  model: string;
  entries: Record<string, CheckpointEntry>;
}

export interface BatchStats {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  processing: number;
}

const ckptPath = (dir: string) => join(dir, 'checkpoint.json');
const resultsPath = (dir: string) => join(dir, 'results.jsonl');

export function loadCheckpoint(dir: string): CheckpointFile | null {
  if (!existsSync(ckptPath(dir))) return null;
  return JSON.parse(readFileSync(ckptPath(dir), 'utf8')) as CheckpointFile;
}

export function saveCheckpoint(dir: string, ckpt: CheckpointFile): void {
  ckpt.updatedAt = new Date().toISOString();
  writeFileSync(ckptPath(dir), JSON.stringify(ckpt));
}

export function stats(ckpt: CheckpointFile): BatchStats {
  const vals = Object.values(ckpt.entries);
  return {
    total: vals.length,
    completed: vals.filter((e) => e.state === 'COMPLETED').length,
    failed: vals.filter((e) => e.state === 'FAILED').length,
    pending: vals.filter((e) => e.state === 'PENDING').length,
    processing: vals.filter((e) => e.state === 'PROCESSING').length,
  };
}

export async function runBatch(): Promise<void> {
  const cfg = loadEnv();
  const processedDir = join(process.cwd(), cfg.dataDir, 'processed');
  mkdirSync(processedDir, { recursive: true });

  const all = loadDataset();
  const selected = cfg.batchLimit ? all.slice(0, cfg.batchLimit) : all;

  let ckpt = loadCheckpoint(processedDir);
  if (!ckpt) {
    ckpt = {
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: cfg.model,
      entries: Object.fromEntries(selected.map((c) => [String(c.id), { caseId: c.id, state: 'PENDING', attempts: 0 }])),
    };
    saveCheckpoint(processedDir, ckpt);
  } else if (ckpt.model !== cfg.model) {
    console.log(`[batch] checkpoint was for model ${ckpt.model}, now ${cfg.model} — reprocessing FAILED and PENDING only`);
  }

  const client = new LlmClient({
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    timeoutMs: cfg.timeoutMs,
    maxRetries: cfg.maxRetries,
  });

  const byId = new Map(selected.map((c) => [String(c.id), c]));
  const queue: RawCase[] = [];
  for (const c of selected) {
    const e = ckpt.entries[String(c.id)];
    if (!e) {
      ckpt.entries[String(c.id)] = { caseId: c.id, state: 'PENDING', attempts: 0 };
      queue.push(c);
      continue;
    }
    if (e.state === 'COMPLETED' && cfg.batchResume) continue; // skip done
    if (e.state === 'FAILED' && e.attempts >= 3 && cfg.batchResume) continue; // exhausted
    queue.push(c);
  }
  saveCheckpoint(processedDir, ckpt);

  const t0 = Date.now();
  let done = 0;
  const total = queue.length;
  console.log(`[batch] model=${cfg.model} concurrency=${cfg.maxConcurrency} cases_to_process=${total}`);

  const persistResult = (r: ExtractionResult) => {
    appendFileSync(resultsPath(processedDir), JSON.stringify(r) + '\n');
  };

  let index = 0;
  const workers = Array.from({ length: cfg.maxConcurrency }, async () => {
    while (true) {
      const i = index++;
      if (i >= queue.length) break;
      const c = queue[i];
      const entry = ckpt.entries[String(c.id)];
      entry.state = 'PROCESSING';
      entry.attempts += 1;
      const input = toInferenceInput(c);
      try {
        const result = await runExtraction(input, { client });
        entry.state = 'COMPLETED';
        entry.extractedAt = result.extractedAt;
        entry.error = undefined;
        persistResult(result);
      } catch (e) {
        entry.state = 'FAILED';
        entry.error = e instanceof Error ? e.message : String(e);
        persistResult({
          caseId: c.id,
          method: 'baseline',
          llmModel: null,
          caseType: 'unknown',
          caseKind: 'unknown',
          insuranceType: 'unknown',
          lifecycleStage: 'laufend',
          damages: [],
          overallConfidence: 0,
          warnings: [`worker failed: ${entry.error}`],
          llmAttempts: entry.attempts,
          llmError: entry.error,
          extractedAt: new Date().toISOString(),
        });
      }
      done += 1;
      if (done % 25 === 0 || done === total) {
        const s = stats(ckpt);
        const elapsed = (Date.now() - t0) / 1000;
        const rate = done / elapsed;
        const eta = rate > 0 ? ((total - done) / rate).toFixed(0) : '?';
        console.log(`[batch] ${done}/${total} done (${rate.toFixed(1)}/s) ok=${s.completed} failed=${s.failed} eta=${eta}s`);
        saveCheckpoint(processedDir, ckpt);
      }
    }
  });
  await Promise.all(workers);
  saveCheckpoint(processedDir, ckpt);

  const s = stats(ckpt);
  console.log(`[batch] DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${JSON.stringify(s)}`);
  console.log(`[batch] results: ${resultsPath(processedDir)}`);
}
