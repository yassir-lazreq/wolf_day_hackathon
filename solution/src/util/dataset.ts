/**
 * Dataset access utilities.
 * The ground truth is NEVER read here — inference inputs are built from
 * non-GT fields only. Evaluation code reads ground truth separately and
 * never passes it into the pipeline.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RawCase {
  id: number;
  freitext: string;
  note: string;
  manufacturer: string;
  model: string;
  model_type: string;
  mileage: number;
  license_plate: string;
  first_registration: string;
  states: Array<{ id: number; name: string; category: string; is_done: boolean }>;
  orders: unknown[];
  workshop_tasks: unknown[];
  ground_truth?: unknown;
  [key: string]: unknown;
}

export function datasetPath(env: NodeJS.ProcessEnv): string {
  return join(process.cwd(), env.DATASET_DIR ?? '../track-b-dataset/kit/dataset', 'da-cases.json');
}

export function loadDataset(): RawCase[] {
  const p = datasetPath(process.env);
  const raw = readFileSync(p, 'utf8');
  return JSON.parse(raw) as RawCase[];
}

/** Everything the inference pipeline is allowed to see. No ground truth. */
export interface CaseInferenceInput {
  caseId: number;
  freitext: string;
  manufacturer: string;
  model: string;
  firstStateName: string;
  states: Array<{ name: string; category: string; is_done: boolean }>;
  vehicle: {
    licensePlate: string;
    mileage: number;
    firstRegistration: string;
  };
}

export function toInferenceInput(c: RawCase): CaseInferenceInput {
  return {
    caseId: c.id,
    freitext: c.freitext ?? '',
    manufacturer: c.manufacturer ?? '',
    model: c.model ?? '',
    firstStateName: c.states?.[0]?.name ?? '',
    states: (c.states ?? []).map((s) => ({ name: s.name, category: s.category, is_done: s.is_done })),
    vehicle: {
      licensePlate: c.license_plate ?? '',
      mileage: c.mileage ?? 0,
      firstRegistration: c.first_registration ?? '',
    },
  };
}
