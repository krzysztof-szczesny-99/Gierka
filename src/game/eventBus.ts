// Lekka, typowana szyna zdarzeń między Phaserem (mapa) a Reactem/serwisami.

import type { TerrainType } from '../config/encounters';
import type { Dir } from '../engine/types';
import type { WildSpawn } from '../services/creatureService';
import type { WorldPosition } from './world';

export type EncounterOutcome = 'win' | 'lose' | 'fled' | 'caught' | 'cancel';

/** Źródło spotkania: widoczne stworzenie specjalne albo losowanie po kroku w strefie. */
export type EncounterSource =
  | { kind: 'static'; actorId: string; staticId: string; spawn: WildSpawn }
  | { kind: 'step'; locationId: string; zoneId: string; zoneName: string; terrainType: TerrainType; encounterTableId: string }
  /** Walka z trenerem (Sprint 5) — po dialogu przed walką; `rematch` — rewanż bez nagrody. */
  | { kind: 'trainer'; actorId: string; trainerId: string; rematch: boolean };

/** Sposób, w jaki trener zaczął interakcję. */
export type TrainerTrigger = 'talk' | 'sight' | 'event';

export type StepEncounterSource = Extract<EncounterSource, { kind: 'step' }>;

export interface BusEvents {
  /** Wysyłane wyłącznie po przejęciu centralnej blokady (useUi.tryStartEncounter) — z jej identyfikatorem. */
  encounter: { encounterId: string; source: EncounterSource };
  'battle-start': undefined;
  /** Wynik spotkania dla obiektu źródłowego na mapie (usunięcie stworzenia albo odnowienie). */
  'battle-end': { encounterId: string; actorId: string | null; outcome: EncounterOutcome };
  dialog: { lines: string[] };
  door: { kind: 'care' | 'shop' };
  teleport: { x: number; y: number; facing: Dir };
  /** Przeniesienie do pozycji w świecie (ta sama lokacja — teleport; inna — przeładowanie sceny z nową mapą). */
  travel: WorldPosition;
  'follower-refresh': undefined;
  /** Wydarzenie wyzwalające trenera (np. skrypt lokacji) — ta sama ścieżka co wzrok i rozmowa. */
  'trainer-event': { trainerId: string };
}

type Handler<T> = (payload: T) => void;

class EventBus {
  private handlers = new Map<keyof BusEvents, Set<Handler<never>>>();

  on<K extends keyof BusEvents>(event: K, fn: Handler<BusEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(event, fn);
  }

  off<K extends keyof BusEvents>(event: K, fn: Handler<BusEvents[K]>): void {
    this.handlers.get(event)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Handler<BusEvents[K]>)(payload);
      } catch (e) {
        console.error(`Błąd w obsłudze zdarzenia „${String(event)}”`, e);
      }
    }
  }
}

export const bus = new EventBus();
