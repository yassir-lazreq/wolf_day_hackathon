/**
 * Reconciliation + business-rule validation (Phase 5).
 *
 * Deterministic post-processing of the LLM interpretation:
 *  - canonical ZoneId normalization (German label -> ZoneId)
 *  - duplicate merging
 *  - evidence / enum guards (business rules)
 *  - recommended-action + replacement-part inference (rules only, never LLM)
 *  - hybrid fallback: fill `unknown` fields from deterministic hints
 */

import type { CaseKind, CaseType, DamageStatus, InsuranceType, LifecycleStage, Severity } from '../domain/enums.ts';
import { LIFECYCLE_TO_DAMAGE_STATUS } from '../domain/enums.ts';
import { ZONE_DEFS, type ZoneId, zoneByGermanLabel } from '../domain/zones.ts';
import { extractBaseline, type BaselineResult } from './baseline.ts';
import { normalizeNoteText, uniqueZonesInText } from '../domain/glossary.ts';
import type { LlmResponse } from './schema.ts';

export interface ReconcileInput {
  freitext: string;
  llm: LlmResponse | null; // null => pure baseline
  baseline: BaselineResult;
}

export interface ReconciledDamage {
  zoneId: ZoneId;
  damageType: string;
  severity: Severity | 'unknown';
  status: DamageStatus;
  action: 'instandsetzen' | 'austauschen' | 'smart_repair' | 'pruefen' | 'keine_angabe';
  replacementPart: ZoneId | null;
  replacementInferred: boolean;
  evidence: string;
  confidence: number;
  /** true when at least one field came from deterministic hints instead of the LLM */
  hybridFilled: boolean;
}

export interface ReconcileResult {
  caseType: CaseType | 'unknown';
  caseKind: CaseKind | 'unknown';
  insuranceType: InsuranceType | 'unknown';
  damages: ReconciledDamage[];
  overallConfidence: number;
  warnings: string[];
}

const SEVERITY_RANK: Record<string, number> = { unknown: 0, leicht: 1, mittel: 2, schwer: 3 };
const EXCHANGE_PATTERNS = [
  /austausch\s+statt\s+instandsetzung/i,
  /ersatzteil\s+nur\s+komplett\s+lieferbar/i,
  /ersetzen\b/i,
  /komplett\s+getauscht/i,
  /kompletter\s+austausch/i,
];
const REPAIR_PATTERNS = [
  /\binstandsetzung\s+reicht\b/i,
  /\binstandsetzen\b/i,
  /\bausbeulen\b/i,
  /\bdellen\s+entfernen\b/i,
  /\bsmart\s+repair\b/i,
];
const CHECK_PATTERNS = [
  /\breparatur\s+laut\s+prüfung\s+möglich\b/i,
  /\breparatur\s+möglich\b/i,
  /\bprüfen\b/i,
  /\bprüfung\b/i,
];

interface ActionInference {
  action: ReconciledDamage['action'];
  replacementPart: ZoneId | null;
  replacementInferred: boolean;
}

/**
 * Replacement/action rules, keyed by zone semantic group.
 * Metal panels -> repair; plastic covers (bumpers) -> replace; glass -> check.
 * Explicit text signals always override the default.
 */
function inferAction(zoneId: ZoneId, freitext: string, damageType: string): ActionInference {
  const zone = ZONE_DEFS[zoneId];
  const isBumper = zoneId.startsWith('BUMPER_');
  const isGlass = zoneId === 'WINDSHIELD';
  const isMirror = zoneId.startsWith('MIRROR_');

  if (REPAIR_PATTERNS.some((p) => p.test(freitext))) {
    if (/smart\s+repair/i.test(freitext)) {
      return { action: 'smart_repair', replacementPart: null, replacementInferred: false };
    }
    return { action: 'instandsetzen', replacementPart: null, replacementInferred: false };
  }
  if (EXCHANGE_PATTERNS.some((p) => p.test(freitext))) {
    return { action: 'austauschen', replacementPart: zone.replacementPart, replacementInferred: true };
  }
  if (CHECK_PATTERNS.some((p) => p.test(freitext)) && (isGlass || damageType.toLowerCase().includes('steinschlag'))) {
    return { action: 'pruefen', replacementPart: null, replacementInferred: false };
  }
  // silent defaults
  if (isGlass) return { action: 'pruefen', replacementPart: null, replacementInferred: false };
  if (isBumper || isMirror) {
    return { action: 'austauschen', replacementPart: zone.replacementPart, replacementInferred: true };
  }
  return { action: 'instandsetzen', replacementPart: null, replacementInferred: false };
}

/** Map an LLM zone label to a canonical ZoneId, falling back to glossary matching. */
function resolveZone(label: string, freitext: string): ZoneId | null {
  const direct = zoneByGermanLabel(label);
  if (direct) return direct;
  const viaGlossary = uniqueZonesInText(label);
  if (viaGlossary.length === 1) return viaGlossary[0];
  const viaText = uniqueZonesInText(freitext);
  if (viaText.length === 1) return viaText[0];
  return null;
}

function maxSeverity(a: Severity | 'unknown', b: Severity | 'unknown'): Severity | 'unknown' {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Deterministic severity overrides for unambiguous German workshop
 * vocabulary. Applied per damage AFTER the LLM (business-rule layer).
 * Ordered: first match wins. Only fires on strong, specific signals.
 */
export const SEVERITY_OVERRIDES: ReadonlyArray<{ severity: Severity; patterns: RegExp[] }> = [
  {
    severity: 'schwer',
    patterns: [/\bträger\s+verformt\b/i, /\bteil\s+gerissen\b/i, /\btotalschaden\b/i, /\bblech\s+verzogen\b/i],
  },
  {
    severity: 'leicht',
    patterns: [
      /\bfeine\s+kratzspuren\b/i,
      /\bkratzer\s+im\s+klarlack\b/i,
      /\blackabrieb\b/i,
      /\bharzreparatur\b/i,
      /\baußerhalb\s+sichtfeld\b/i,
      /\bkleine\s+delle\b/i,
      /\bdruckstelle\b/i,
    ],
  },
  {
    severity: 'mittel',
    patterns: [
      /\bhalterung\s+gebrochen\b/i,
      /\briss\s+im\s+lack\b/i,
      /\bkunststoff\s+eingedrückt\b/i,
      /\bhandtellergroß\b/i,
      /\bdelle\s+mit\s+lackschaden\b/i,
    ],
  },
];

/** Apply deterministic severity overrides to an evidence text. */
export function overrideSeverity(current: Severity | 'unknown', evidence: string): Severity | 'unknown' {
  for (const rule of SEVERITY_OVERRIDES) {
    if (rule.patterns.some((p) => p.test(evidence))) return rule.severity;
  }
  return current;
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const warnings: string[] = [];
  const damages: ReconciledDamage[] = [];

  const lifecycleStage: LifecycleStage = input.baseline.lifecycleStage;
  const status = LIFECYCLE_TO_DAMAGE_STATUS[lifecycleStage];

  if (input.llm) {
    for (const d of input.llm.damages) {
      const zoneId = resolveZone(d.zone, input.freitext);
      if (!zoneId) {
        warnings.push(`LLM zone "${d.zone}" not resolvable to canonical zone — dropped`);
        continue;
      }
      if (d.evidence.trim().length === 0) {
        warnings.push(`damage on ${zoneId} without evidence — dropped`);
        continue;
      }
      const existing = damages.find((x) => x.zoneId === zoneId);
      if (existing) {
        // deterministic merge: strongest severity, longest evidence, max confidence
        existing.severity = maxSeverity(existing.severity, d.severity);
        existing.evidence = existing.evidence.includes(d.evidence) ? existing.evidence : `${existing.evidence} | ${d.evidence}`;
        existing.confidence = Math.max(existing.confidence, d.confidence);
        continue;
      }
      const a = inferAction(zoneId, input.freitext, d.damageType);
      damages.push({
        zoneId,
        damageType: d.damageType === '' ? 'unknown' : d.damageType,
        severity: d.severity,
        status,
        action: a.action,
        replacementPart: a.replacementPart,
        replacementInferred: a.replacementInferred,
        evidence: d.evidence,
        confidence: d.confidence,
        hybridFilled: false,
      });
    }
  }

  // hybrid fallback: fill damages/fields the LLM missed, from deterministic hints
  const llmZoneIds = new Set(damages.map((d) => d.zoneId));
  let hybridFilled = false;
  for (const bd of input.baseline.damages) {
    if (llmZoneIds.has(bd.zoneId)) {
      const existing = damages.find((x) => x.zoneId === bd.zoneId)!;
      if (existing.severity === 'unknown' && bd.severity !== 'unknown') {
        existing.severity = bd.severity;
        existing.hybridFilled = true;
        hybridFilled = true;
      }
      if (existing.damageType === 'unknown' && bd.damageType !== 'unknown') {
        existing.damageType = bd.damageType;
        existing.hybridFilled = true;
        hybridFilled = true;
      }
      continue;
    }
    const a = inferAction(bd.zoneId, input.freitext, bd.damageType);
    damages.push({
      zoneId: bd.zoneId,
      damageType: bd.damageType,
      severity: bd.severity,
      status,
      action: a.action,
      replacementPart: a.replacementPart,
      replacementInferred: a.replacementInferred,
      evidence: bd.evidence,
      confidence: 0.5, // deterministic hint: medium confidence
      hybridFilled: true,
    });
    hybridFilled = true;
  }

  let caseType: CaseType | 'unknown' = input.llm?.caseType ?? input.baseline.caseType;
  let caseKind: CaseKind | 'unknown' = input.llm?.caseKind ?? input.baseline.caseKind;
  let insuranceType: InsuranceType | 'unknown' = input.llm?.insuranceType ?? input.baseline.insuranceType;

  // deterministic severity overrides (business-rule layer, post-LLM)
  for (const d of damages) {
    const overridden = overrideSeverity(d.severity, d.evidence);
    if (overridden !== d.severity) {
      warnings.push(`severity ${d.severity}->${overridden} on ${d.zoneId} (deterministic override from evidence)`);
      d.severity = overridden;
    }
  }

  // business rules
  if (caseType === 'unknown' && damages.length > 0) caseType = 'damage';
  if (caseKind === 'unknown' && input.baseline.caseKind !== 'unknown') {
    caseKind = input.baseline.caseKind;
    hybridFilled = true;
  }
  if (insuranceType === 'unknown' && input.baseline.insuranceType !== 'unknown') {
    insuranceType = input.baseline.insuranceType;
    hybridFilled = true;
  }
  if (caseType === 'service' && damages.length > 0) {
    warnings.push('caseType=service but damages extracted from text — contradiction flagged for review');
  }
  if (caseType === 'damage' && damages.length === 0) {
    warnings.push('caseType=damage but no damage zone extracted');
  }

  let overallConfidence = input.llm?.overallConfidence ?? 0;
  if (damages.length > 0 && overallConfidence <= 0) {
    overallConfidence = Math.min(...damages.map((d) => d.confidence));
  }
  if (damages.length === 0 && caseType === 'service' && overallConfidence <= 0) overallConfidence = 0.8;
  if (hybridFilled && overallConfidence > 0.7) overallConfidence = 0.7; // cap when hints were needed

  return {
    caseType,
    caseKind,
    insuranceType,
    damages,
    overallConfidence: Math.min(1, Math.max(0, overallConfidence)),
    warnings,
  };
}

export { extractBaseline, normalizeNoteText };
