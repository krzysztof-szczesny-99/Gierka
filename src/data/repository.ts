// Dostęp do danych gry z buforowaniem: pamięć → IndexedDB → PokéAPI.
// Przy braku sieci zwracamy przeterminowane dane z IndexedDB, jeśli istnieją.

import { normalizeGrowth, normalizeMove, normalizePokemon, normalizeSpecies, normalizeType } from '../api/normalize';
import { fetchJson, isOnline } from '../api/pokeapi';
import type { RawGrowthRate, RawList, RawMove, RawPokemon, RawSpecies, RawType } from '../api/raw';
import { normalizeEvolutionChain, type EvolutionChainData, type RawEvolutionChain } from '../engine/evolution';
import { buildTypeChart } from '../engine/typeChart';
import { TYPE_NAMES, type GrowthTable, type MoveData, type PokemonData, type SpeciesData, type TypeChart } from '../engine/types';
import { db } from './db';

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TTL = 30 * DAY;
const CACHE_SCHEMA = 1; // zwiększ przy zmianie formatu znormalizowanych rekordów

const memory = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

const k = (key: string) => `v${CACHE_SCHEMA}:${key}`;

async function cached<T>(key: string, kind: string, loader: () => Promise<T>, ttl = DEFAULT_TTL): Promise<T> {
  const fullKey = k(key);
  if (memory.has(fullKey)) return memory.get(fullKey) as T;
  const pending = inflight.get(fullKey);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    const row = await db.cache.get(fullKey).catch(() => undefined);
    const fresh = row !== undefined && Date.now() - row.fetchedAt < ttl;
    if (row && (fresh || !isOnline())) {
      memory.set(fullKey, row.data);
      return row.data as T;
    }
    try {
      const data = await loader();
      memory.set(fullKey, data);
      db.cache.put({ key: fullKey, kind, data, fetchedAt: Date.now() }).catch((e) => console.warn('cache put', e));
      return data;
    } catch (err) {
      if (row) {
        memory.set(fullKey, row.data);
        return row.data as T;
      }
      throw err;
    }
  })().finally(() => inflight.delete(fullKey));

  inflight.set(fullKey, promise);
  return promise;
}

export function getPokemon(name: string): Promise<PokemonData> {
  const n = name.toLowerCase();
  return cached(`pokemon:${n}`, 'pokemon', async () => normalizePokemon(await fetchJson<RawPokemon>(`pokemon/${n}`)));
}

export function getSpecies(idOrName: number | string): Promise<SpeciesData> {
  const id = String(idOrName).toLowerCase();
  return cached(`species:${id}`, 'species', async () =>
    normalizeSpecies(await fetchJson<RawSpecies>(`pokemon-species/${id}`)),
  );
}

export function getMove(name: string): Promise<MoveData> {
  const n = name.toLowerCase();
  return cached(`move:${n}`, 'move', async () => normalizeMove(await fetchJson<RawMove>(`move/${n}`)));
}

export async function getMoves(names: string[]): Promise<Record<string, MoveData>> {
  const unique = [...new Set(names)];
  const list = await Promise.all(unique.map((n) => getMove(n)));
  const out: Record<string, MoveData> = {};
  for (const m of list) out[m.name] = m;
  return out;
}

/** Łańcuch ewolucji (przetworzony do lokalnego modelu — src/engine/evolution.ts), z buforem. */
export function getEvolutionChain(id: number): Promise<EvolutionChainData> {
  return cached(`evolution:${id}`, 'evolution', async () =>
    normalizeEvolutionChain(await fetchJson<RawEvolutionChain>(`evolution-chain/${id}`)),
  );
}

export function getGrowth(name: string): Promise<GrowthTable> {
  return cached(`growth:${name}`, 'growth', async () => normalizeGrowth(await fetchJson<RawGrowthRate>(`growth-rate/${name}`)));
}

export const GROWTH_RATES = ['slow', 'medium', 'fast', 'medium-slow', 'slow-then-very-fast', 'fast-then-very-slow'];

export function getTypeChart(): Promise<TypeChart> {
  return cached(
    'typechart',
    'meta',
    async () => {
      const raws = await Promise.all(TYPE_NAMES.map((t) => fetchJson<RawType>(`type/${t}`)));
      return buildTypeChart(raws.map(normalizeType));
    },
    90 * DAY,
  );
}

export function getSpeciesCount(): Promise<number> {
  return cached('species-count', 'meta', async () => (await fetchJson<RawList>('pokemon-species?limit=1')).count, 7 * DAY);
}

/** Czy dane wariantu i gatunku są już w lokalnym buforze (dla trybu offline). */
export async function isPokemonCached(name: string): Promise<boolean> {
  const key = k(`pokemon:${name.toLowerCase()}`);
  if (memory.has(key)) return true;
  return (await db.cache.get(key).catch(() => undefined)) !== undefined;
}

/** Dane niezbędne do rozpoczęcia gry: tabela typów i krzywe doświadczenia (24 zapytania, raz). */
export async function preloadCore(onProgress?: (done: number, total: number) => void): Promise<void> {
  const tasks: (() => Promise<unknown>)[] = [() => getTypeChart(), ...GROWTH_RATES.map((g) => () => getGrowth(g))];
  let done = 0;
  onProgress?.(0, tasks.length);
  await Promise.all(
    tasks.map(async (t) => {
      await t();
      done += 1;
      onProgress?.(done, tasks.length);
    }),
  );
}

export async function getGrowthTables(names: string[]): Promise<Record<string, GrowthTable>> {
  const unique = [...new Set(names)];
  const out: Record<string, GrowthTable> = {};
  await Promise.all(
    unique.map(async (n) => {
      out[n] = await getGrowth(n);
    }),
  );
  return out;
}

export async function clearApiCache(): Promise<void> {
  memory.clear();
  await db.cache.clear();
}

export async function cacheStats(): Promise<{ entries: number }> {
  return { entries: await db.cache.count() };
}
