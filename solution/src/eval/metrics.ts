/**
 * Evaluation metrics (Phase 6).
 * Reusable functions — no hardcoded numbers.
 * Ground truth is used ONLY here, never in the pipeline.
 */

import type { ExtractionResult } from '../extraction/schema.ts';
import { SEVERITY_RANK } from './severity-rank.ts';
import { zoneByGermanLabel, type ZoneId } from '../domain/zones.ts';

export interface GroundTruth {
  case_id: number;
  case_type: 'service' | 'damage';
  case_kind: string | null;
  zones: ZoneId[];
  severity: 'leicht' | 'mittel' | 'schwer' | null;
  insurance_type: string | null;
  lifecycle_stage: string | null;
}

export function groundTruthFromRaw(gt: {
  case_type: string;
  case_kind: string;
  zones: string[];
  severity: string | null;
  insurance_type: string | null;
  lifecycle_stage: string | null;
}): GroundTruth {
  return {
    case_id: 0, // set by caller
    case_type: gt.case_type === 'damage' ? 'damage' : 'service',
    case_kind: gt.case_kind,
    zones: gt.zones.map((z) => zoneByGermanLabel(z)).filter((z): z is ZoneId => z !== null),
    severity: gt.severity === 'leicht' || gt.severity === 'mittel' || gt.severity === 'schwer' ? gt.severity : null,
    insurance_type: gt.insurance_type,
    lifecycle_stage: gt.lifecycle_stage,
  };
}

export interface MetricSet {
  nCases: number;
  nDamageCases: number;
  caseTypeAccuracy: number;
  caseKindAccuracy: number;
  zonePrecision: number;
  zoneRecall: number;
  zoneF1: number;
  severityAccuracy: number;
  severityAccuracyKnown: number;
  exactMultiZoneMatchRate: number;
  falsePositiveZones: number;
  missedZones: number;
  insuranceAccuracy: number;
  lifecycleAccuracy: number;
}

export interface CaseScore {
  caseId: number;
  caseTypeOk: boolean;
  caseKindOk: boolean;
  predZones: ZoneId[];
  gtZones: ZoneId[];
  fp: ZoneId[];
  fn: ZoneId[];
  severityOk: boolean | null; // null when GT has no severity
  insuranceOk: boolean;
  lifecycleOk: boolean;
}

function setEq(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

export function scoreCase(pred: ExtractionResult, gt: GroundTruth): CaseScore {
  const predZones = new Set(pred.damages.map((d) => d.zoneId));
  const gtZones = new Set(gt.zones);
  const fp = [...predZones].filter((z) => !gtZones.has(z)) as ZoneId[];
  const fn = [...gtZones].filter((z) => !predZones.has(z)) as ZoneId[];

  const predSeverity = pred.damages.reduce<{ rank: number } | null>((acc, d) => {
    const r = SEVERITY_RANK[d.severity] ?? 0;
    return acc && acc.rank >= r ? acc : { rank: r };
  }, null);

  const severityOk = gt.severity === null ? null : (SEVERITY_RANK[gt.severity] ?? 0) === (predSeverity?.rank ?? 0);

  return {
    caseId: pred.caseId,
    caseTypeOk: pred.caseType === gt.case_type,
    caseKindOk: pred.caseKind === gt.case_kind,
    predZones: [...predZones],
    gtZones: gt.zones,
    fp,
    fn,
    severityOk,
    insuranceOk: gt.insurance_type === null ? true : pred.insuranceType === gt.insurance_type,
    lifecycleOk: gt.lifecycle_stage === null ? true : pred.lifecycleStage === gt.lifecycle_stage,
  };
}

export function computeMetrics(pairs: Array<{ pred: ExtractionResult; gt: GroundTruth }>): MetricSet {
  const scores = pairs.map((p) => scoreCase(p.pred, p.gt));
  const n = scores.length;
  if (n === 0) throw new Error('no cases to evaluate');

  const damageScores = scores.filter((s) => s.gtZones.length > 0);
  const nDamage = damageScores.length;

  let tp = 0;
  let fpTotal = 0;
  let fnTotal = 0;
  let exactMatch = 0;
  for (const s of damageScores) {
    tp += s.gtZones.length - s.fn.length;
    fpTotal += s.fp.length;
    fnTotal += s.fn.length;
    if (setEq(new Set(s.predZones), new Set(s.gtZones))) exactMatch += 1;
  }
  const precision = tp + fpTotal === 0 ? 1 : tp / (tp + fpTotal);
  const recall = tp + fnTotal === 0 ? 1 : tp / (tp + fnTotal);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const sevOk = damageScores.filter((s) => s.severityOk === true).length;
  const sevKnown = damageScores.filter((s) => s.severityOk !== null).length;

  return {
    nCases: n,
    nDamageCases: nDamage,
    caseTypeAccuracy: scores.filter((s) => s.caseTypeOk).length / n,
    caseKindAccuracy: scores.filter((s) => s.caseKindOk).length / n,
    zonePrecision: precision,
    zoneRecall: recall,
    zoneF1: f1,
    severityAccuracy: sevKnown === 0 ? 0 : sevOk / sevKnown,
    severityAccuracyKnown: sevKnown,
    exactMultiZoneMatchRate: nDamage === 0 ? 0 : exactMatch / nDamage,
    falsePositiveZones: fpTotal,
    missedZones: fnTotal,
    insuranceAccuracy: scores.filter((s) => s.insuranceOk).length / n,
    lifecycleAccuracy: scores.filter((s) => s.lifecycleOk).length / n,
  };
}

export function formatMetrics(m: MetricSet): string {
  return [
    `cases evaluated:      ${m.nCases} (damage: ${m.nDamageCases})`,
    `caseType accuracy:    ${(m.caseTypeAccuracy * 100).toFixed(1)}%`,
    `caseKind accuracy:    ${(m.caseKindAccuracy * 100).toFixed(1)}%`,
    `zone precision:       ${(m.zonePrecision * 100).toFixed(1)}%`,
    `zone recall:          ${(m.zoneRecall * 100).toFixed(1)}%`,
    `zone F1:              ${(m.zoneF1 * 100).toFixed(1)}%`,
    `severity accuracy:    ${(m.severityAccuracy * 100).toFixed(1)}% (n=${m.severityAccuracyKnown})`,
    `exact multi-zone:     ${(m.exactMultiZoneMatchRate * 100).toFixed(1)}%`,
    `false-positive zones: ${m.falsePositiveZones}`,
    `missed zones:         ${m.missedZones}`,
    `insurance accuracy:   ${(m.insuranceAccuracy * 100).toFixed(1)}%`,
    `lifecycle accuracy:   ${(m.lifecycleAccuracy * 100).toFixed(1)}%`,
  ].join('\n');
}
