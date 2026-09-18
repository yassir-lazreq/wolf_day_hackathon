/**
 * German workshop terminology normalization (deterministic layer).
 *
 * Order of the pipeline:
 *   1. normalizeNoteText(): lowercase, unify spellings (ß/ss is handled via
 *      alias variants, not by rewriting), normalize whitespace/punctuation.
 *   2. findZoneMentions(): longest-first alias matching over the text with
 *      boundary guards (e.g. Fahrertür must not match inside Beifahrertür).
 *
 * The dictionary is deliberately small and unit-tested; the LLM handles
 * phrasing that escapes it.
 */

import { ZONE_DEFS, ZONE_LIST, type ZoneId } from './zones.ts';

export interface ZoneMention {
  zoneId: ZoneId;
  /** the exact substring matched in the normalized text */
  matchedAlias: string;
  /** character offsets into the normalized text */
  start: number;
  end: number;
}

/** Normalize a German note for deterministic matching. Never translated. */
export function normalizeNoteText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[„“”«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escapes an alias for regex use and appends guards:
 * - word-ish boundaries for standalone nouns
 * - a negative lookbehind so "fahrertür" does not match inside "beifahrertür"
 */
function aliasToRegex(alias: string): RegExp {
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let prefix = '(?<![a-zäöüß])';
  let suffix = '(?![a-zäöüß])';
  if (esc.startsWith('fahrertür')) prefix = '(?<![a-zäöüß])(?<!bei)';
  if (esc.startsWith('stoßstange ') || esc.startsWith('stoßfänger ')) suffix = '(?![a-zäöüß])';
  if (esc.endsWith(' li.')) suffix = '(?![a-zäöüß])';
  return new RegExp(prefix + esc + suffix, 'gi');
}

interface CompiledAlias {
  zoneId: ZoneId;
  alias: string;
  regex: RegExp;
}

const COMPILED: CompiledAlias[] = ZONE_LIST.flatMap((def) =>
  def.aliases.map((alias) => ({
    zoneId: def.id,
    alias,
    regex: aliasToRegex(alias),
  })),
).sort((a, b) => b.alias.length - a.alias.length); // longest first

/**
 * Deterministic zone-mention extraction.
 * Longest-first, non-overlapping: a more specific alias wins over a shorter one.
 */
export function findZoneMentions(text: string): ZoneMention[] {
  const norm = normalizeNoteText(text);
  const mentions: ZoneMention[] = [];
  for (const { zoneId, alias, regex } of COMPILED) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(norm)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (mentions.some((e) => start < e.end && end > e.start)) continue; // overlap: skip shorter
      mentions.push({ zoneId, matchedAlias: alias, start, end });
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

/** Unique canonical zone IDs mentioned in the text, in order of appearance. */
export function uniqueZonesInText(text: string): ZoneId[] {
  const seen = new Set<ZoneId>();
  for (const m of findZoneMentions(text)) {
    if (!seen.has(m.zoneId)) seen.add(m.zoneId);
  }
  return [...seen];
}

/**
 * Deterministic insurance-type hints from German workshop phrasing.
 * Used as baseline + as a reconciliation fallback when the LLM is unsure.
 * The LLM result is authoritative; these are hints only.
 */
export const INSURANCE_HINTS: ReadonlyArray<{ type: string; patterns: RegExp[] }> = [
  {
    type: 'vollkasko',
    patterns: [/\bvollkasko\b/i, /\bvk\s+mit\b/i, /\bvk,\s*sb\b/i],
  },
  {
    type: 'teilkasko',
    patterns: [/\bteilkasko\b/i, /\btk\s+deckt\b/i, /\btk\s+mit\b/i, /\btk,\s*sb\b/i],
  },
  {
    type: 'haftpflicht_gegner',
    patterns: [/\bhaftpflicht\s+gegner\b/i, /\bgegnerische\s+haftpflicht\b/i, /\bgegnerische\s+haftpflicht\s+reguliert\b/i],
  },
  {
    type: 'selbstzahler',
    patterns: [/\bselbstzahler\b/i, /\bzahlt\s+selbst\b/i, /\bkeine\s+vers(?:icherung)?\s+im\s+spiel\b/i],
  },
  {
    type: 'gesteuert',
    patterns: [/\bsteuerung\s+über\b/i, /\bgesteuerter\s+auftrag\b/i, /\bflottenpartner\b/i, /\bgesteuert\b/i],
  },
];

/**
 * Deterministic case-kind hints: strong signal words per kind.
 * Only used when the LLM has no answer; never overrides LLM output.
 */
export const KIND_HINTS: ReadonlyArray<{ kind: string; patterns: RegExp[] }> = [
  { kind: 'Inspektion', patterns: [/\binspektion\b/i, /\bgroße\s+inspektion\b/i] },
  { kind: 'Ölwechsel', patterns: [/\bölwechsel\b/i, /\bölservice\b/i, /\böl\s+wechseln\b/i] },
  { kind: 'HU/AU', patterns: [/\bhu\/au\b/i, /\bhauptuntersuchung\b/i, /\btüv\b/i, /\babgasuntersuchung\b/i] },
  { kind: 'Bremsen', patterns: [/\bbremsen\b/i, /\bbremsbeläge\b/i, /\bbremsklötze\b/i, /\bbremsflüssigkeit\b/i, /\bbremsscheiben\b/i] },
  { kind: 'Räder und Reifen', patterns: [/\breifen\b/i, /\bräder\b/i, /\breifenwechsel\b/i, /\bwuchten\b/i, /\bfelge\b/i] },
  { kind: 'Parkschaden', patterns: [/\bparkschaden\b/i, /\bparkrempler\b/i] },
  { kind: 'Rangierschaden', patterns: [/\brangierschaden\b/i, /\bpoller\s+übersehen\b/i, /\brangiert\b/i] },
  { kind: 'Auffahrunfall', patterns: [/\bauffahrunfall\b/i, /\baufgefahren\b/i] },
  { kind: 'Hagelschaden', patterns: [/\bhagelschaden\b/i, /\bhagelschlag\b/i, /\bhagel\b/i] },
  { kind: 'Steinschlag', patterns: [/\bsteinschlag\b/i] },
  { kind: 'Vandalismus', patterns: [/\bvandalismus\b/i, /\büber\s+nacht\s+an\s+der\s+straße\b/i] },
  { kind: 'Wildunfall', patterns: [/\bwildunfall\b/i, /\bwildschaden\b/i, /\breh\b/i, /\bwildschwein\b/i, /\bfuchs\b/i] },
];

/** Deterministic severity hints. Conservative: only fire on explicit signals. */
export const SEVERITY_HINTS: ReadonlyArray<{ severity: string; patterns: RegExp[] }> = [
  { severity: 'schwer', patterns: [/\büber\s+zwei\s+bauteile\b/i, /\bträger\s+verformt\b/i, /\bflächig\b/i, /\bzahlreichen\s+dellen\b/i, /\btotalschaden\b/i] },
  { severity: 'leicht', patterns: [/\bfeine\s+kratzspuren\b/i, /\bkratzer\s+im\s+klarlack\b/i, /\bkleine\s+delle\b/i, /\blackabrieb\b/i] },
  { severity: 'mittel', patterns: [/\bhandtellergroß\b/i, /\bhalterung\s+gebrochen\b/i] },
];

export { ZONE_DEFS, ZONE_LIST };
