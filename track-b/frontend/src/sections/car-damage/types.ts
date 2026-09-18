/**
 * Frontend types for the generated data artifacts (public/data/*.json).
 * The canonical domain definitions live in the solution worker; these
 * types only mirror the JSON shape for safe consumption.
 */

export interface Damage {
  zoneId: string;
  damageType: string;
  severity: 'leicht' | 'mittel' | 'schwer' | 'unknown';
  status: 'festgestellt' | 'in_bearbeitung' | 'behoben' | 'unknown';
  action: 'instandsetzen' | 'austauschen' | 'smart_repair' | 'pruefen' | 'keine_angabe';
  replacementPart: string | null;
  replacementInferred: boolean;
  evidence: string;
  confidence: number;
}

export interface CaseExtracted {
  id: number;
  licensePlate: string;
  manufacturer: string;
  model: string;
  modelType: string;
  firstRegistration: string;
  mileage: number;
  company: string;
  city: string;
  freitext: string;
  states: Array<{ name: string; category: string; is_done: boolean }>;
  orderCount: number;
  workshopTaskCount: number;
  inOpenList: boolean;
  createdAt: string | null;
  completionDateTime: string | null;
  canceledAt: string | null;
  caseType: 'service' | 'damage' | 'unknown';
  caseKind: string;
  insuranceType: string;
  lifecycleStage: string;
  damages: Damage[];
  maxSeverity: 'leicht' | 'mittel' | 'schwer' | null;
  overallConfidence: number;
  method: 'hybrid' | 'llm' | 'baseline';
  warnings: string[];
  llmError: string | null;
}

export interface ZoneMeta {
  id: string;
  germanLabel: string;
  region: { length: string; height: string; lateral: string };
  replacementPart: string;
  linkedZones: string[];
}

export interface Insight {
  title: string;
  text: string;
  evidence: string;
}

export interface AnalyticsData {
  generatedAt: string;
  totals: {
    cases: number;
    serviceCases: number;
    damageCases: number;
    openCases: number;
    canceledCases: number;
    orderCount: number;
    workshopTaskCount: number;
    workLoadTotal: number;
    multiZoneDamageCases: number;
  };
  kindDist: Record<string, number>;
  zoneDist: Record<string, number>;
  replacementDist: Record<string, number>;
  actionDist: Record<string, number>;
  severityDist: Record<string, number>;
  insuranceDist: Record<string, number>;
  lifecycleDist: Record<string, number>;
  makeDist: Record<string, number>;
  modelDist: Record<string, number>;
  zonePairs: Record<string, number>;
  stateDistTop: Record<string, number>;
  durationStats: Record<string, { n: number; avgDays: number }>;
  insights: Insight[];
}

export interface EvalSummary {
  generatedAt: string;
  nResults: number;
  metrics: {
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
  };
  failures: Array<{
    caseId: number;
    fp: string[];
    fn: string[];
    caseTypeOk: boolean;
    caseKindOk: boolean;
    severityOk: boolean | null;
  }>;
}
