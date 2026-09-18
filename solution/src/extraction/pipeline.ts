/**
 * Hybrid extraction pipeline (Phase 4+5 orchestration).
 *
 *   freitext -> baseline hints (deterministic)
 *            -> DeepSeek structured extraction (JSON mode)
 *            -> Zod validation (layer 1)
 *            -> canonical enum validation (layer 2)
 *            -> reconciliation + business rules (layer 3)
 *            -> ExtractionResult
 *
 * On LLM failure the deterministic baseline result is used and the failure
 * is recorded — never silently discarded.
 */

import type { ExtractionResult } from './schema.ts';
import { extractBaseline } from './baseline.ts';
import { reconcile } from './reconcile.ts';
import { LlmClient } from './llm.ts';
import type { CaseInferenceInput } from '../util/dataset.ts';

export interface PipelineOptions {
  client: LlmClient | null; // null => baseline only
}

export async function runExtraction(input: CaseInferenceInput, opts: PipelineOptions): Promise<ExtractionResult> {
  const baseline = extractBaseline({
    freitext: input.freitext,
    firstStateName: input.firstStateName,
  });

  let llm = null;
  let llmModel: string | null = null;
  let llmAttempts = 0;
  let llmError: string | null = null;
  let method: ExtractionResult['method'] = 'baseline';

  if (opts.client) {
    try {
      const r = await opts.client.extract({
        caseId: input.caseId,
        freitext: input.freitext,
        manufacturer: input.manufacturer,
        model: input.model,
      });
      llm = r.response;
      llmAttempts = r.attempts;
      llmModel = opts.client.modelName;
      method = 'hybrid'; // reconciliation always combines LLM + deterministic rules
    } catch (e) {
      llmError = e instanceof Error ? e.message : String(e);
      llmModel = opts.client.modelName;
      // fall through to baseline — recorded, not silent
    }
  }

  const rec = reconcile({ freitext: input.freitext, llm, baseline });

  return {
    caseId: input.caseId,
    method,
    llmModel,
    caseType: rec.caseType,
    caseKind: rec.caseKind,
    insuranceType: rec.insuranceType,
    lifecycleStage: baseline.lifecycleStage,
    damages: rec.damages,
    overallConfidence: rec.overallConfidence,
    warnings: rec.warnings,
    llmAttempts,
    llmError,
    extractedAt: new Date().toISOString(),
  };
}

export function modelName(client: LlmClient | null): string | null {
  return client ? client.modelName : null;
}
