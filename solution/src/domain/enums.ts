/**
 * Canonical enums for the damage-intelligence domain.
 * Stable IDs. All German vocabulary lives here or in zones.ts — nowhere else.
 */

export const CASE_TYPES = ['service', 'damage'] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_KINDS = [
  'Inspektion',
  'Parkschaden',
  'Räder und Reifen',
  'Bremsen',
  'HU/AU',
  'Ölwechsel',
  'Rangierschaden',
  'Auffahrunfall',
  'Hagelschaden',
  'Steinschlag',
  'Vandalismus',
  'Wildunfall',
] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const SERVICE_KINDS: readonly CaseKind[] = ['Inspektion', 'Räder und Reifen', 'Bremsen', 'HU/AU', 'Ölwechsel'];
export const DAMAGE_KINDS: readonly CaseKind[] = [
  'Parkschaden',
  'Rangierschaden',
  'Auffahrunfall',
  'Hagelschaden',
  'Steinschlag',
  'Vandalismus',
  'Wildunfall',
];

export const SEVERITIES = ['leicht', 'mittel', 'schwer'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INSURANCE_TYPES = ['teilkasko', 'vollkasko', 'haftpflicht_gegner', 'selbstzahler', 'gesteuert'] as const;
export type InsuranceType = (typeof INSURANCE_TYPES)[number];

export const LIFECYCLE_STAGES = ['neu', 'laufend', 'fertig', 'abgeschlossen', 'storniert'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/**
 * Damage status: how far the repair of this damage has progressed.
 * Derived from the case lifecycle (deterministic mapping), not free text.
 */
export const DAMAGE_STATUSES = ['festgestellt', 'in_bearbeitung', 'behoben', 'unknown'] as const;
export type DamageStatus = (typeof DAMAGE_STATUSES)[number];

export const LIFECYCLE_TO_DAMAGE_STATUS: Record<LifecycleStage, DamageStatus> = {
  neu: 'festgestellt',
  laufend: 'in_bearbeitung',
  fertig: 'behoben',
  abgeschlossen: 'behoben',
  storniert: 'unknown',
};

export const ACTION_KINDS = ['instandsetzen', 'austauschen', 'smart_repair', 'pruefen', 'keine_angabe'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type Confidence = number; // 0..1

export function isCaseKind(v: unknown): v is CaseKind {
  return typeof v === 'string' && (CASE_KINDS as readonly string[]).includes(v);
}
