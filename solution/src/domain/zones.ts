/**
 * Canonical damage zones. Single source of truth.
 * The 22 zone IDs are derived from dataset ground-truth vocabulary
 * (track-b-dataset/kit/dataset/schema.json `damage_zones`).
 *
 * Do NOT duplicate zone definitions anywhere else.
 */

export const ZONE_IDS = [
  'MIRROR_LEFT',
  'MIRROR_RIGHT',
  'DOOR_FRONT_LEFT',
  'DOOR_FRONT_RIGHT',
  'DOOR_REAR_LEFT',
  'DOOR_REAR_RIGHT',
  'ROOF',
  'HOOD',
  'TAILGATE',
  'WINDSHIELD',
  'FENDER_FRONT_LEFT',
  'FENDER_FRONT_RIGHT',
  'FENDER_REAR_LEFT',
  'FENDER_REAR_RIGHT',
  'SILL_LEFT',
  'SILL_RIGHT',
  'BUMPER_FRONT_LEFT',
  'BUMPER_FRONT_RIGHT',
  'BUMPER_FRONT_FULL',
  'BUMPER_REAR_LEFT',
  'BUMPER_REAR_RIGHT',
  'BUMPER_REAR_FULL',
] as const;

export type ZoneId = (typeof ZONE_IDS)[number];

/**
 * Geometric region descriptor, used by the deterministic surface
 * segmentation of the 3D model. Axes are resolved at runtime against the
 * actual model (which axis is length/width/height is discovered, not assumed).
 */
export interface ZoneRegion {
  /** position along the car length */
  length: 'front' | 'mid' | 'rear' | 'full';
  /** vertical band */
  height: 'low' | 'mid' | 'high' | 'full';
  /** lateral position */
  lateral: 'left' | 'right' | 'center' | 'full';
}

export interface ZoneDef {
  id: ZoneId;
  /** canonical German label as used by the dataset ground truth */
  germanLabel: string;
  /** normalized (lowercased) alias forms found in real notes; matched longest-first */
  aliases: string[];
  region: ZoneRegion;
  /**
   * Primary replacement part: deterministic business rule.
   * Bumper side damage => whole bumper assembly replacement.
   */
  replacementPart: ZoneId;
  /**
   * Intact parts physically/mechanically connected to this zone.
   * Static, manually defined from real vehicle structure — never LLM-generated.
   */
  linkedZones: ZoneId[];
}

const L = 'left' as const;
const R = 'right' as const;
const F = 'full' as const;

export const ZONE_DEFS: Record<ZoneId, ZoneDef> = {
  MIRROR_LEFT: {
    id: 'MIRROR_LEFT',
    germanLabel: 'Außenspiegel links',
    aliases: ['außenspiegel links', 'aussenspiegel links', 'seitenspiegel links', 'spiegel links', 'außenspiegel li.', 'linker außenspiegel'],
    region: { length: 'front', height: 'high', lateral: L },
    replacementPart: 'MIRROR_LEFT',
    linkedZones: ['DOOR_FRONT_LEFT', 'WINDSHIELD'],
  },
  MIRROR_RIGHT: {
    id: 'MIRROR_RIGHT',
    germanLabel: 'Außenspiegel rechts',
    aliases: ['außenspiegel rechts', 'aussenspiegel rechts', 'seitenspiegel rechts', 'spiegel rechts', 'außenspiegel re.', 'rechter außenspiegel'],
    region: { length: 'front', height: 'high', lateral: R },
    replacementPart: 'MIRROR_RIGHT',
    linkedZones: ['DOOR_FRONT_RIGHT', 'WINDSHIELD'],
  },
  DOOR_FRONT_LEFT: {
    id: 'DOOR_FRONT_LEFT',
    germanLabel: 'Fahrertür',
    aliases: ['fahrertür', 'tür vorne links', 'tür vorn links', 'tür links vorne', 'vordertür links'],
    region: { length: 'front', height: 'mid', lateral: L },
    replacementPart: 'DOOR_FRONT_LEFT',
    linkedZones: ['FENDER_FRONT_LEFT', 'DOOR_REAR_LEFT', 'SILL_LEFT', 'MIRROR_LEFT'],
  },
  DOOR_FRONT_RIGHT: {
    id: 'DOOR_FRONT_RIGHT',
    germanLabel: 'Beifahrertür',
    aliases: ['beifahrertür', 'tür vorne rechts', 'tür vorn rechts', 'tür rechts vorne', 'vordertür rechts'],
    region: { length: 'front', height: 'mid', lateral: R },
    replacementPart: 'DOOR_FRONT_RIGHT',
    linkedZones: ['FENDER_FRONT_RIGHT', 'DOOR_REAR_RIGHT', 'SILL_RIGHT', 'MIRROR_RIGHT'],
  },
  DOOR_REAR_LEFT: {
    id: 'DOOR_REAR_LEFT',
    germanLabel: 'Tür hinten links',
    aliases: ['tür hinten links', 'hintertür links', 'tür links hinten', 'fondtür links'],
    region: { length: 'rear', height: 'mid', lateral: L },
    replacementPart: 'DOOR_REAR_LEFT',
    linkedZones: ['DOOR_FRONT_LEFT', 'FENDER_REAR_LEFT', 'SILL_LEFT'],
  },
  DOOR_REAR_RIGHT: {
    id: 'DOOR_REAR_RIGHT',
    germanLabel: 'Tür hinten rechts',
    aliases: ['tür hinten rechts', 'hintertür rechts', 'tür rechts hinten', 'fondtür rechts'],
    region: { length: 'rear', height: 'mid', lateral: R },
    replacementPart: 'DOOR_REAR_RIGHT',
    linkedZones: ['DOOR_FRONT_RIGHT', 'FENDER_REAR_RIGHT', 'SILL_RIGHT'],
  },
  ROOF: {
    id: 'ROOF',
    germanLabel: 'Dach',
    aliases: ['dach'],
    region: { length: 'mid', height: 'high', lateral: F },
    replacementPart: 'ROOF',
    linkedZones: ['WINDSHIELD', 'TAILGATE'],
  },
  HOOD: {
    id: 'HOOD',
    germanLabel: 'Motorhaube',
    aliases: ['motorhaube', 'fronthaube', 'haube'],
    region: { length: 'front', height: 'mid', lateral: F },
    replacementPart: 'HOOD',
    linkedZones: ['BUMPER_FRONT_FULL', 'FENDER_FRONT_LEFT', 'FENDER_FRONT_RIGHT', 'WINDSHIELD'],
  },
  TAILGATE: {
    id: 'TAILGATE',
    germanLabel: 'Heckklappe',
    aliases: ['heckklappe', 'kofferraumdeckel', 'heckdeckel', 'hecktür'],
    region: { length: 'rear', height: 'mid', lateral: F },
    replacementPart: 'TAILGATE',
    linkedZones: ['BUMPER_REAR_FULL', 'FENDER_REAR_LEFT', 'FENDER_REAR_RIGHT', 'ROOF'],
  },
  WINDSHIELD: {
    id: 'WINDSHIELD',
    germanLabel: 'Windschutzscheibe',
    aliases: ['windschutzscheibe', 'frontscheibe', 'scheibe vorne'],
    region: { length: 'front', height: 'high', lateral: F },
    replacementPart: 'WINDSHIELD',
    linkedZones: ['HOOD', 'ROOF'],
  },
  FENDER_FRONT_LEFT: {
    id: 'FENDER_FRONT_LEFT',
    germanLabel: 'Kotflügel vorne links',
    aliases: ['kotflügel vorne links', 'kotflügel vorn links', 'kotflügel links vorne', 'vorderer kotflügel links'],
    region: { length: 'front', height: 'mid', lateral: L },
    replacementPart: 'FENDER_FRONT_LEFT',
    linkedZones: ['BUMPER_FRONT_LEFT', 'HOOD', 'DOOR_FRONT_LEFT', 'SILL_LEFT'],
  },
  FENDER_FRONT_RIGHT: {
    id: 'FENDER_FRONT_RIGHT',
    germanLabel: 'Kotflügel vorne rechts',
    aliases: ['kotflügel vorne rechts', 'kotflügel vorn rechts', 'kotflügel rechts vorne', 'vorderer kotflügel rechts'],
    region: { length: 'front', height: 'mid', lateral: R },
    replacementPart: 'FENDER_FRONT_RIGHT',
    linkedZones: ['BUMPER_FRONT_RIGHT', 'HOOD', 'DOOR_FRONT_RIGHT', 'SILL_RIGHT'],
  },
  FENDER_REAR_LEFT: {
    id: 'FENDER_REAR_LEFT',
    germanLabel: 'Kotflügel hinten links',
    aliases: ['kotflügel hinten links', 'kotflügel links hinten', 'hinterer kotflügel links'],
    region: { length: 'rear', height: 'mid', lateral: L },
    replacementPart: 'FENDER_REAR_LEFT',
    linkedZones: ['DOOR_REAR_LEFT', 'TAILGATE', 'BUMPER_REAR_LEFT', 'SILL_LEFT'],
  },
  FENDER_REAR_RIGHT: {
    id: 'FENDER_REAR_RIGHT',
    germanLabel: 'Kotflügel hinten rechts',
    aliases: ['kotflügel hinten rechts', 'kotflügel rechts hinten', 'hinterer kotflügel rechts'],
    region: { length: 'rear', height: 'mid', lateral: R },
    replacementPart: 'FENDER_REAR_RIGHT',
    linkedZones: ['DOOR_REAR_RIGHT', 'TAILGATE', 'BUMPER_REAR_RIGHT', 'SILL_RIGHT'],
  },
  SILL_LEFT: {
    id: 'SILL_LEFT',
    germanLabel: 'Schweller links',
    aliases: ['schweller links', 'seitenschweller links', 'schweller li.'],
    region: { length: 'full', height: 'low', lateral: L },
    replacementPart: 'SILL_LEFT',
    linkedZones: ['DOOR_FRONT_LEFT', 'DOOR_REAR_LEFT', 'FENDER_FRONT_LEFT', 'FENDER_REAR_LEFT'],
  },
  SILL_RIGHT: {
    id: 'SILL_RIGHT',
    germanLabel: 'Schweller rechts',
    aliases: ['schweller rechts', 'seitenschweller rechts', 'schweller re.'],
    region: { length: 'full', height: 'low', lateral: R },
    replacementPart: 'SILL_RIGHT',
    linkedZones: ['DOOR_FRONT_RIGHT', 'DOOR_REAR_RIGHT', 'FENDER_FRONT_RIGHT', 'FENDER_REAR_RIGHT'],
  },
  BUMPER_FRONT_LEFT: {
    id: 'BUMPER_FRONT_LEFT',
    germanLabel: 'Stoßstange vorne links',
    aliases: ['stoßstange vorne links', 'stossstange vorne links', 'stoßfänger vorne links', 'stossfänger vorne links', 'stoßstange links vorne'],
    region: { length: 'front', height: 'low', lateral: L },
    replacementPart: 'BUMPER_FRONT_FULL',
    linkedZones: ['FENDER_FRONT_LEFT', 'HOOD', 'WINDSHIELD'],
  },
  BUMPER_FRONT_RIGHT: {
    id: 'BUMPER_FRONT_RIGHT',
    germanLabel: 'Stoßstange vorne rechts',
    aliases: ['stoßstange vorne rechts', 'stossstange vorne rechts', 'stoßfänger vorne rechts', 'stossfänger vorne rechts', 'stoßstange rechts vorne'],
    region: { length: 'front', height: 'low', lateral: R },
    replacementPart: 'BUMPER_FRONT_FULL',
    linkedZones: ['FENDER_FRONT_RIGHT', 'HOOD', 'WINDSHIELD'],
  },
  BUMPER_FRONT_FULL: {
    id: 'BUMPER_FRONT_FULL',
    germanLabel: 'Stoßstange vorne',
    aliases: ['stoßstange vorne', 'stossstange vorne', 'stoßfänger vorne', 'stossfänger vorne', 'frontstoßstange', 'frontstoßfänger', 'vordere stoßstange'],
    region: { length: 'front', height: 'low', lateral: F },
    replacementPart: 'BUMPER_FRONT_FULL',
    linkedZones: ['FENDER_FRONT_LEFT', 'FENDER_FRONT_RIGHT', 'HOOD', 'WINDSHIELD'],
  },
  BUMPER_REAR_LEFT: {
    id: 'BUMPER_REAR_LEFT',
    germanLabel: 'Stoßstange hinten links',
    aliases: ['stoßstange hinten links', 'stossstange hinten links', 'stoßfänger hinten links', 'stossfänger hinten links', 'stoßstange links hinten'],
    region: { length: 'rear', height: 'low', lateral: L },
    replacementPart: 'BUMPER_REAR_FULL',
    linkedZones: ['FENDER_REAR_LEFT', 'TAILGATE'],
  },
  BUMPER_REAR_RIGHT: {
    id: 'BUMPER_REAR_RIGHT',
    germanLabel: 'Stoßstange hinten rechts',
    aliases: ['stoßstange hinten rechts', 'stossstange hinten rechts', 'stoßfänger hinten rechts', 'stossfänger hinten rechts', 'stoßstange rechts hinten'],
    region: { length: 'rear', height: 'low', lateral: R },
    replacementPart: 'BUMPER_REAR_FULL',
    linkedZones: ['FENDER_REAR_RIGHT', 'TAILGATE'],
  },
  BUMPER_REAR_FULL: {
    id: 'BUMPER_REAR_FULL',
    germanLabel: 'Stoßstange hinten',
    aliases: ['stoßstange hinten', 'stossstange hinten', 'stoßfänger hinten', 'stossfänger hinten', 'heckstoßstange', 'heckstoßfänger', 'hintere stoßstange'],
    region: { length: 'rear', height: 'low', lateral: F },
    replacementPart: 'BUMPER_REAR_FULL',
    linkedZones: ['FENDER_REAR_LEFT', 'FENDER_REAR_RIGHT', 'TAILGATE'],
  },
};

export const ZONE_LIST: readonly ZoneDef[] = Object.values(ZONE_DEFS);

/**
 * LINKED_ZONES: static table of intact parts that are physically/mechanically
 * connected to each damaged zone. Manually defined in ZONE_DEFS (single
 * source of truth); this export is DERIVED from it, never duplicated and
 * never LLM-generated.
 */
export const LINKED_ZONES = Object.fromEntries(
  ZONE_LIST.map((z) => [z.id, [...z.linkedZones]] as const),
) as Record<ZoneId, ZoneId[]>;

export function isZoneId(v: unknown): v is ZoneId {
  return typeof v === 'string' && (ZONE_IDS as readonly string[]).includes(v);
}

/** Exact label lookup (canonical German ground-truth label). */
export function zoneByGermanLabel(label: string): ZoneId | null {
  const z = ZONE_LIST.find((d) => d.germanLabel === label);
  return z ? z.id : null;
}
