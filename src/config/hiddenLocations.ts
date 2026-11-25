// Ukryte lokacje (Sprint 7) — dane. Ukryta lokacja jest zwykłą lokacją modelu świata (src/config/world.ts,
// hidden: true) z własną mapą, ale wchodzi się do niej przez ukryte wejście w lokacji nadrzędnej, a nie przez zwykłe
// przejście. Pierwsze wejście = odkrycie (wydarzenie w zapisie i nagroda — raz). Logika: src/game/hiddenLocations.ts.

import type { TrainerReward } from './trainers';
import { GROTA_ID, REGION_ID, WZGORZA_ID, type LocationStatus, type Requirements } from './world';

/**
 * Ukryte wejście w lokacji nadrzędnej:
 * interact — gracz bada pole (patrzy na nie i naciska Akcja), np. szczelinę w głazie;
 * tile — wejście na pole uruchamia wejście (np. niepozorna ścieżka).
 */
export interface HiddenEntranceTrigger {
  kind: 'interact' | 'tile';
  x: number;
  y: number;
  /** Punkt pojawienia się w ukrytej lokacji. */
  destinationSpawnPoint: string;
}

export interface HiddenLocationDef {
  /** Identyfikator lokacji z modelu świata (ta sama lokacja, hidden: true). */
  id: string;
  regionId: string;
  parentLocationId: string;
  mapReference: string;
  entranceTrigger: HiddenEntranceTrigger;
  /** Wymagania wejścia: odznaki, przedmioty, wydarzenia, ukończone Próby, odkryte ukryte przejścia — wszystkie naraz. */
  entryRequirements: Requirements;
  /** Flaga zapisu ustawiana przy odkryciu (pierwszym wejściu). */
  discoveryEventId: string;
  /** Po odkryciu wejście jest widoczne na mapie lokacji nadrzędnej, a miejsce — w Dzienniku. */
  visibleAfterDiscovery: boolean;
  specialEncounterIds: string[];
  /** Nagroda za odkrycie — przyznawana raz, razem z wydarzeniem odkrycia. */
  rewards: TrainerReward;
  status: LocationStatus;
  /** Oryginalne komunikaty: badanie bez spełnionych wymagań i odkrycie. */
  lockedMessage: string[];
  discoveryMessage: string[];
}

export const HIDDEN_LOCATIONS: readonly HiddenLocationDef[] = [
  {
    id: GROTA_ID,
    regionId: REGION_ID,
    parentLocationId: WZGORZA_ID,
    mapReference: 'grota',
    // Głaz na zachód od ścieżki Wzgórz Wiatru — badany z pola obok (Akcja).
    entranceTrigger: { kind: 'interact', x: 7, y: 8, destinationSpawnPoint: 'z-wzgorz' },
    entryRequirements: { badges: ['odznaka-wiatru'], events: ['static-done:gaj-straznik'] },
    discoveryEventId: 'hidden:grota-echa:discovered',
    visibleAfterDiscovery: true,
    specialEncounterIds: ['grota-absol'],
    rewards: { money: 0, items: { 'capsule-plus': 3 } },
    status: 'IMPLEMENTED',
    lockedMessage: [
      'Spomiędzy głazów dobiega ciche echo — jakby ktoś nawoływał z głębi skały.',
      'Szczelina jest jednak zbyt wąska. Może ktoś, kto zdobył Odznakę Wiatru i zmierzył się ze Strażnikiem Cichego Gaju, znajdzie tu drogę.',
    ],
    discoveryMessage: [
      'Pod naporem dłoni głaz odsuwa się z chrzęstem. Za nim ciągnie się wąskie przejście!',
      'Odkrywasz ukryte miejsce: Grota Echa.',
    ],
  },
];
