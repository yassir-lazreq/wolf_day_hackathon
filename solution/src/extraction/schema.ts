/**
 * Extraction schemas.
 *
 * Zod schema validates raw LLM output (layer 1) and enforces canonical
 * enums (layer 2). `ExtractionResult` is the canonical structured result
 * persisted and consumed by the frontend.
 */

import { z } from 'zod';
import { CASE_KINDS, CASE_TYPES, INSURANCE_TYPES, SEVERITIES } from '../domain/enums.ts';
import { ZONE_IDS, type ZoneId } from '../domain/zones.ts';

export const zoneIdSchema = z.enum(ZONE_IDS);
export const caseTypeSchema = z.enum([...CASE_TYPES, 'unknown']);
export const caseKindSchema = z.enum([...CASE_KINDS, 'unknown']);
export const severitySchema = z.enum([...SEVERITIES, 'unknown']);
export const insuranceTypeSchema = z.enum([...INSURANCE_TYPES, 'unknown']);

/** What the LLM returns. Zones are canonical German labels from the 22 list. */
export const llmDamageSchema = z.object({
  zone: z.string().min(1),
  damageType: z.string().max(80).optional().default('unknown'),
  severity: severitySchema,
  evidence: z.string().min(1),
  confidence: z.number().min(0).max(1).optional().default(0.5),
});

export const llmResponseSchema = z.object({
  caseType: caseTypeSchema,
  caseKind: caseKindSchema,
  insuranceType: insuranceTypeSchema,
  damages: z.array(llmDamageSchema).max(10),
  overallConfidence: z.number().min(0).max(1),
});

export type LlmResponse = z.infer<typeof llmResponseSchema>;

export const damageSchema = z.object({
  zoneId: zoneIdSchema,
  damageType: z.string().max(80),
  severity: severitySchema,
  status: z.enum(['festgestellt', 'in_bearbeitung', 'behoben', 'unknown']),
  action: z.enum(['instandsetzen', 'austauschen', 'smart_repair', 'pruefen', 'keine_angabe']),
  /** replacement assembly derived deterministically from the zone; null when no replacement applies */
  replacementPart: zoneIdSchema.nullable(),
  replacementInferred: z.boolean(),
  /** verbatim German evidence from the original note */
  evidence: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const extractionResultSchema = z.object({
  caseId: z.number().int().positive(),
  method: z.enum(['hybrid', 'llm', 'baseline']),
  llmModel: z.string().nullable(),
  caseType: caseTypeSchema,
  caseKind: caseKindSchema,
  insuranceType: insuranceTypeSchema,
  lifecycleStage: z.enum(['neu', 'laufend', 'fertig', 'abgeschlossen', 'storniert']),
  damages: z.array(damageSchema),
  overallConfidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  llmAttempts: z.number().int().min(0),
  llmError: z.string().nullable(),
  extractedAt: z.string(),
});

export type Damage = z.infer<typeof damageSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type { ZoneId };
