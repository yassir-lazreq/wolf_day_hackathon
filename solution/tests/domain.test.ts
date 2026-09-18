import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ZONE_DEFS, ZONE_IDS, ZONE_LIST, zoneByGermanLabel, LINKED_ZONES } from '../src/domain/zones.ts';
import { findZoneMentions, normalizeNoteText, uniqueZonesInText, INSURANCE_HINTS, KIND_HINTS, SEVERITY_HINTS } from '../src/domain/glossary.ts';
import { lifecycleFromStatus } from '../src/domain/status.ts';

test('zone registry: 22 canonical zones, unique ids, valid replacement targets', () => {
  assert.equal(ZONE_LIST.length, 22);
  assert.equal(new Set(ZONE_IDS).size, 22);
  for (const def of ZONE_LIST) {
    assert.equal(def.id.length > 0, true);
    assert.ok(ZONE_IDS.includes(def.replacementPart), `replacementPart invalid for ${def.id}`);
    for (const linked of def.linkedZones) {
      assert.ok(ZONE_IDS.includes(linked), `linkedZone invalid for ${def.id}`);
      assert.notEqual(linked, def.id, `zone linked to itself: ${def.id}`);
    }
  }
});

test('bumper side damage maps to full bumper replacement assembly', () => {
  assert.equal(ZONE_DEFS.BUMPER_FRONT_LEFT.replacementPart, 'BUMPER_FRONT_FULL');
  assert.equal(ZONE_DEFS.BUMPER_FRONT_RIGHT.replacementPart, 'BUMPER_FRONT_FULL');
  assert.equal(ZONE_DEFS.BUMPER_REAR_LEFT.replacementPart, 'BUMPER_REAR_FULL');
  assert.equal(ZONE_DEFS.BUMPER_REAR_RIGHT.replacementPart, 'BUMPER_REAR_FULL');
});

test('linkedZones: static, deterministic, asymmetric-safe lookups', () => {
  assert.deepEqual(ZONE_DEFS.BUMPER_FRONT_FULL.linkedZones, [
    'FENDER_FRONT_LEFT',
    'FENDER_FRONT_RIGHT',
    'HOOD',
    'WINDSHIELD',
  ]);
  assert.deepEqual(ZONE_DEFS.MIRROR_LEFT.linkedZones, ['DOOR_FRONT_LEFT', 'WINDSHIELD']);
});

test('LINKED_ZONES: derived table covers all 22 zones with canonical ids only', () => {
  assert.equal(Object.keys(LINKED_ZONES).length, 22);
  for (const [zoneId, linked] of Object.entries(LINKED_ZONES)) {
    assert.ok(ZONE_IDS.includes(zoneId as (typeof ZONE_IDS)[number]), `unknown key ${zoneId}`);
    for (const lz of linked) assert.ok(ZONE_IDS.includes(lz), `unknown linked zone ${lz} for ${zoneId}`);
  }
  // derived from ZONE_DEFS — identical, not duplicated
  assert.deepEqual(LINKED_ZONES.DOOR_FRONT_LEFT, ZONE_DEFS.DOOR_FRONT_LEFT.linkedZones);
});

test('zoneByGermanLabel resolves all ground-truth labels', () => {
  const labels = [
    ['Außenspiegel links', 'MIRROR_LEFT'],
    ['Beifahrertür', 'DOOR_FRONT_RIGHT'],
    ['Fahrertür', 'DOOR_FRONT_LEFT'],
    ['Dach', 'ROOF'],
    ['Stoßstange hinten', 'BUMPER_REAR_FULL'],
    ['Windschutzscheibe', 'WINDSHIELD'],
  ] as const;
  for (const [label, id] of labels) assert.equal(zoneByGermanLabel(label), id);
});

test('normalizeNoteText lowercases and normalizes spacing', () => {
  assert.equal(normalizeNoteText('  Kotflügel   vorne\nrechts! '), 'kotflügel vorne rechts!');
});

test('findZoneMentions: exact labels from real notes', () => {
  const text = 'Schaden an Stoßstange hinten links, Halterung gebrochen. Auch Kotflügel hinten rechts beschädigt (Riss im Lack).';
  const zones = uniqueZonesInText(text);
  assert.deepEqual(zones, ['BUMPER_REAR_LEFT', 'FENDER_REAR_RIGHT']);
});

test('findZoneMentions: Beifahrertür must not match Fahrertür', () => {
  const zones = uniqueZonesInText('Schaden an Beifahrertür, Lack abgeplatzt.');
  assert.deepEqual(zones, ['DOOR_FRONT_RIGHT']);
});

test('findZoneMentions: full bumper vs bumper side (longest-first)', () => {
  assert.deepEqual(uniqueZonesInText('Stoßstange hinten links hat eine Delle.'), ['BUMPER_REAR_LEFT']);
  assert.deepEqual(uniqueZonesInText('Stoßstange hinten komplett neu.'), ['BUMPER_REAR_FULL']);
});

test('findZoneMentions: Stoßfänger spelling variant (real-world form)', () => {
  assert.deepEqual(uniqueZonesInText('Stoßfänger vorne rechts zerkratzt.'), ['BUMPER_FRONT_RIGHT']);
});

test('findZoneMentions: overlapping mentions resolve to more specific zone', () => {
  assert.deepEqual(uniqueZonesInText('Tür hinten rechts und Fahrertür'), ['DOOR_REAR_RIGHT', 'DOOR_FRONT_LEFT']);
});

test('findZoneMentions: no zone words in routine service note', () => {
  const text = 'Inspektion inkl. Innenraumfilter. Scheibenwischer erneuern.';
  assert.deepEqual(uniqueZonesInText(text), []);
});

test('hint tables: insurance', () => {
  const match = (text: string) => INSURANCE_HINTS.filter((h) => h.patterns.some((p) => p.test(text))).map((h) => h.type);
  assert.deepEqual(match('Vollkasko, SB 500 EUR, Schadenmeldung raus.'), ['vollkasko']);
  assert.deepEqual(match('TK deckt Glasschaden, SB 150 EUR.'), ['teilkasko']);
  assert.deepEqual(match('Gegnerische Haftpflicht reguliert, Haftung anerkannt.'), ['haftpflicht_gegner']);
  assert.deepEqual(match('Kunde zahlt selbst, KVA vorab.'), ['selbstzahler']);
  assert.deepEqual(match('Steuerung über Flottenpartner, Freigabe schriftlich nötig.'), ['gesteuert']);
  assert.deepEqual(match('Termin steht, Dauer ca. 2 Tage.'), []);
});

test('hint tables: kinds and severity', () => {
  assert.equal(KIND_HINTS.some((h) => h.kind === 'Hagelschaden' && h.patterns.some((p) => p.test('Hagelschlag flächig, Dach mit zahlreichen Dellen.'))), true);
  assert.equal(SEVERITY_HINTS.some((h) => h.severity === 'schwer' && h.patterns.some((p) => p.test('Träger verformt an Stoßstange hinten.'))), true);
  assert.equal(SEVERITY_HINTS.some((h) => h.severity === 'leicht' && h.patterns.some((p) => p.test('feine Kratzspuren an der Tür.'))), true);
});

test('lifecycleFromStatus maps the vocabulary deterministically', () => {
  assert.equal(lifecycleFromStatus('🙂Vorgang angelegt'), 'neu');
  assert.equal(lifecycleFromStatus('♻️In Bearbeitung'), 'laufend');
  assert.equal(lifecycleFromStatus('👍 Fertig zur Abholung'), 'fertig');
  assert.equal(lifecycleFromStatus('🏁 Abgeholt'), 'abgeschlossen');
  assert.equal(lifecycleFromStatus('❌ Auftrag storniert'), 'storniert');
  assert.equal(lifecycleFromStatus('⚠️Schadensfeststellung'), 'laufend');
});
