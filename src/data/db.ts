import Dexie, { type EntityTable } from 'dexie';

export interface CacheRow {
  key: string;
  kind: string;
  data: unknown;
  fetchedAt: number;
}

export interface SaveRow {
  id: string;
  data: unknown;
  version: number;
  updatedAt: number;
}

export type GameDB = Dexie & {
  cache: EntityTable<CacheRow, 'key'>;
  saves: EntityTable<SaveRow, 'id'>;
};

export const db = new Dexie('szlaki-dziczy') as GameDB;

db.version(1).stores({
  cache: 'key, kind, fetchedAt',
  saves: 'id, updatedAt',
});

/** Prośba o trwałe przechowywanie (zmniejsza ryzyko automatycznego czyszczenia danych). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* np. kontekst niezabezpieczony (http w sieci LAN) */
  }
  return false;
}
