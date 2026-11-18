// Lekka, typowana szyna zdarzeń między Phaserem (mapa) a Reactem/serwisami.

import type { Dir } from '../engine/types';
import type { WildSpawn } from '../services/creatureService';

export type EncounterOutcome = 'win' | 'lose' | 'fled' | 'caught' | 'cancel';

export interface BusEvents {
  encounter: { actorId: string; spawn: WildSpawn };
  'battle-start': undefined;
  'battle-end': { actorId: string | null; outcome: EncounterOutcome };
  dialog: { lines: string[] };
  door: { kind: 'care' | 'shop' };
  teleport: { x: number; y: number; facing: Dir };
  'follower-refresh': undefined;
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
