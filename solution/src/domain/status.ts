/**
 * Deterministic mapping from the workshop general case status (first entry
 * in a case's `states`, category "Vorgangsstatus") to the canonical
 * lifecycle stage. Business-rule table, semantically defined from the status
 * vocabulary. The status is normal input data — never ground truth.
 */

import type { LifecycleStage } from './enums.ts';

const ABGESCHLOSSEN: readonly string[] = [
  '🏁 Abgeholt',
  '🚛✅ Ausgeliefert',
  'abgerechnet ! Auftrag erledigt abgeschlossen',
  'Fahrzeug abgeholt (/kommt nochmal)',
  '🏁🔜Abgeholt/Ausgeliefert - Folgetermin offen',
  '🌝 Fzg angekauft',
  '🛑 Wartet auf Abholung durch Verwerter/Leasing/sonstige',
];

const FERTIG: readonly string[] = [
  '👍 Fertig zur Abholung',
  '👍 🔜Fertig zur Abholung mit Folgetermin',
  '📞🔜✔️Abholbereit Folgetermin vereinbaren',
  '👆🚚 Bringservice mit Folgetermin',
];

const STORNIERT: readonly string[] = [
  '❌ Auftrag storniert',
  '☹️Absage Termin',
  '😢 Kunde nicht erschienen',
  '🚧Wurde Totalschaden',
];

const NEU: readonly string[] = [
  '🙂Vorgang angelegt',
  '🚀Auftrag erteilt/Teile vorbestellt/Termin wenn Teile da',
  '📲🔰DSA/Bilder/GA/Infos erhalten bitte Kalkulieren',
  '📆✔Termin vereinbart',
  '✔️Termin bestätigt',
  '❓Termin unsicher',
  '📲✅Vorkalkulation erledigt bitte Termin vereinbaren',
  '👋 Termin bitte vereinbaren /Teile/Freigabe/etc. eingetroffen',
  'Hagel Termin vereinbaren !',
  '🔧📞 Mechanik Termin bitte vereinbaren /Teile, Freigabe eingetroffen',
];

const STAGE_BY_STATE = new Map<string, LifecycleStage>();
for (const s of ABGESCHLOSSEN) STAGE_BY_STATE.set(s, 'abgeschlossen');
for (const s of FERTIG) STAGE_BY_STATE.set(s, 'fertig');
for (const s of STORNIERT) STAGE_BY_STATE.set(s, 'storniert');
for (const s of NEU) STAGE_BY_STATE.set(s, 'neu');

/**
 * Map a Vorgangsstatus name to a lifecycle stage.
 * Anything not explicitly listed is a case under active work => 'laufend'.
 */
export function lifecycleFromStatus(stateName: string): LifecycleStage {
  return STAGE_BY_STATE.get(stateName) ?? 'laufend';
}

export function isDoneState(name: string): boolean {
  return (
    name.includes('Abgeholt') ||
    name.includes('Ausgeliefert') ||
    name.includes('abgeschlossen') ||
    name.includes('angekauft') ||
    name.includes('storniert')
  );
}
