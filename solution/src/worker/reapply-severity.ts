/**
 * Post-hoc severity re-application: rewrites results.jsonl by running the
 * deterministic severity overrides on each damage's evidence.
 * Does NOT re-call the LLM — pure deterministic post-processing.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../util/env.ts';
import { overrideSeverity } from '../extraction/reconcile.ts';
import type { ExtractionResult } from '../extraction/schema.ts';

const cfg = loadEnv();
const file = join(process.cwd(), cfg.dataDir, 'processed', 'results.jsonl');
if (!existsSync(file)) throw new Error(`no ${file}`);

const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const byId = new Map<number, ExtractionResult>();
for (const line of lines) {
  const r = JSON.parse(line) as ExtractionResult;
  byId.set(r.caseId, r);
}

let changed = 0;
for (const r of byId.values()) {
  for (const d of r.damages) {
    const prev = d.severity;
    const next = overrideSeverity(prev, d.evidence);
    if (next !== prev) {
      d.severity = next;
      if (!r.warnings.includes(`severity override: ${prev}->${next} on ${d.zoneId}`)) {
        r.warnings.push(`severity override: ${prev}->${next} on ${d.zoneId}`);
      }
      changed += 1;
    }
  }
}

const out = [...byId.values()].sort((a, b) => a.caseId - b.caseId).map((r) => JSON.stringify(r)).join('\n') + '\n';
writeFileSync(file, out);
console.log(`rewrote ${byId.size} results, ${changed} severity overrides applied`);
