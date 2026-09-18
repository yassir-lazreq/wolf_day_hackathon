import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeMetrics, scoreCase, groundTruthFromRaw } from '../src/eval/metrics.ts';
import type { ExtractionResult } from '../src/extraction/schema.ts';

function mkResult(overrides: Partial<ExtractionResult>): ExtractionResult {
  return {
    caseId: 1,
    method: 'hybrid',
    llmModel: 'test',
    caseType: 'damage',
    caseKind: 'Parkschaden',
    insuranceType: 'vollkasko',
    lifecycleStage: 'laufend',
    damages: [],
    overallConfidence: 0.5,
    warnings: [],
    llmAttempts: 1,
    llmError: null,
    extractedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function mkGt(zones: string[], severity: 'leicht' | 'mittel' | 'schwer', caseType = 'damage'): ReturnType<typeof groundTruthFromRaw> {
  const gt = groundTruthFromRaw({
    case_type: caseType,
    case_kind: 'Parkschaden',
    zones,
    severity,
    insurance_type: 'vollkasko',
    lifecycle_stage: 'laufend',
  });
  return gt;
}

const D = (zoneId: string, severity: string = 'leicht') => ({
  zoneId,
  damageType: 'Kratzer',
  severity: severity as 'leicht',
  status: 'festgestellt' as const,
  action: 'instandsetzen' as const,
  replacementPart: null,
  replacementInferred: false,
  evidence: 'Beleg',
  confidence: 0.8,
});

test('scoreCase: perfect match', () => {
  const pred = mkResult({ damages: [D('BUMPER_REAR_LEFT')] });
  const s = scoreCase(pred, mkGt(['Stoßstange hinten links'], 'leicht'));
  assert.equal(s.caseTypeOk, true);
  assert.deepEqual(s.fp, []);
  assert.deepEqual(s.fn, []);
  assert.equal(s.severityOk, true);
});

test('scoreCase: false positive and false negative zones', () => {
  const pred = mkResult({ damages: [D('HOOD'), D('ROOF')] });
  const s = scoreCase(pred, mkGt(['Motorhaube'], 'leicht'));
  assert.deepEqual(s.fp, ['ROOF']);
  assert.deepEqual(s.fn, []);
});

test('scoreCase: severity mismatch detected', () => {
  const pred = mkResult({ damages: [D('HOOD', 'leicht')] });
  const s = scoreCase(pred, mkGt(['Motorhaube'], 'schwer'));
  assert.equal(s.severityOk, false);
});

test('computeMetrics: manually verified numbers', () => {
  // 3 cases: perfect, one FP, one FN+FP with severity error
  const pairs = [
    { pred: mkResult({ caseId: 1, damages: [D('HOOD')] }), gt: mkGt(['Motorhaube'], 'leicht') },
    { pred: mkResult({ caseId: 2, damages: [D('HOOD'), D('ROOF')] }), gt: mkGt(['Motorhaube'], 'leicht') },
    { pred: mkResult({ caseId: 3, damages: [D('ROOF', 'schwer')] }), gt: mkGt(['Motorhaube'], 'schwer') },
  ];
  const m = computeMetrics(pairs);
  // TP: case1 HOOD, case2 HOOD => 2; FP: case2 ROOF, case3 ROOF => 2; FN: case3 HOOD => 1
  assert.equal(m.zonePrecision, 2 / 4); // 0.5
  assert.equal(m.zoneRecall, 2 / 3);
  assert.equal(m.zoneF1, (2 * 0.5 * (2 / 3)) / (0.5 + 2 / 3));
  assert.equal(m.falsePositiveZones, 2);
  assert.equal(m.missedZones, 1);
  assert.equal(m.caseTypeAccuracy, 1);
  // severity: case1 leicht==leicht ok, case2 leicht==leicht ok, case3 schwer==schwer ok
  assert.equal(m.severityAccuracy, 1);
  assert.equal(m.exactMultiZoneMatchRate, 1 / 3);
});

test('groundTruthFromRaw maps German labels to canonical zones', () => {
  const gt = groundTruthFromRaw({
    case_type: 'damage',
    case_kind: 'Parkschaden',
    zones: ['Stoßstange hinten links', 'Windschutzscheibe'],
    severity: 'mittel',
    insurance_type: 'teilkasko',
    lifecycle_stage: 'fertig',
  });
  assert.deepEqual(gt.zones, ['BUMPER_REAR_LEFT', 'WINDSHIELD']);
  assert.equal(gt.severity, 'mittel');
});
