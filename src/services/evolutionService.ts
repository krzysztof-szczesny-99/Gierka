// Ewolucje w grze: dane łańcucha (PokéAPI przez bufor repozytorium), propozycje po awansie,
// ewolucja kamieniem, potwierdzenie i anulowanie. Logika warunków i przemiany — src/engine/evolution.ts.

import { ITEMS, type ItemId } from '../config/items';
import { getEvolutionChain, getPokemon, getSpecies } from '../data/repository';
import { displayName } from '../engine/creature';
import {
  evaluateEvolutions,
  evolveCreature,
  levelEvolutionToOffer,
  type EvolutionChainData,
  type EvolutionCheck,
} from '../engine/evolution';
import type { Creature, PokemonData, SpeciesData } from '../engine/types';
import { useGame } from '../state/gameStore';
import type { EvolutionRequest } from '../state/uiStore';
import { dexInfo } from './creatureService';

export interface EvolutionDeps {
  getPokemon(name: string): Promise<PokemonData>;
  getSpecies(idOrName: number | string): Promise<SpeciesData>;
  getEvolutionChain(id: number): Promise<EvolutionChainData>;
}

let deps: EvolutionDeps = { getPokemon, getSpecies, getEvolutionChain };

/** Podmienia źródła danych (testy). Zwraca funkcję przywracającą poprzednie. */
export function configureEvolutionDeps(patch: Partial<EvolutionDeps>): () => void {
  const prev = deps;
  deps = { ...deps, ...patch };
  return () => {
    deps = prev;
  };
}

export interface EvolutionInfo {
  speciesName: string;
  checks: EvolutionCheck[];
}

/** Drogi ewolucji stworzenia i stan ich warunków (dane z bufora — bez zapytań przy każdym otwarciu). */
export async function evolutionInfo(c: Creature): Promise<EvolutionInfo> {
  const pokemon = await deps.getPokemon(c.pokemon);
  const species = await deps.getSpecies(c.speciesId);
  if (!species.evolutionChainId) return { speciesName: species.name, checks: [] };
  const chain = await deps.getEvolutionChain(species.evolutionChainId);
  return { speciesName: species.name, checks: evaluateEvolutions(c, species.name, pokemon.isDefault, chain) };
}

const levelRequest = (c: Creature, check: EvolutionCheck): EvolutionRequest => ({
  uid: c.uid,
  toSpecies: check.option.to,
  toSpeciesId: check.option.toSpeciesId,
  method: 'LEVEL',
  itemId: null,
  condition: `poziom ${check.option.minLevel ?? c.level}`,
});

/** Ewolucja przez poziom do zaproponowania (np. przycisk „Ewoluuj” w Drużynie — także po anulowaniu). */
export async function levelEvolutionFor(c: Creature, ignoreCancel = false): Promise<EvolutionRequest | null> {
  const info = await evolutionInfo(c);
  const subject = ignoreCancel ? { ...c, evolutionState: { ...c.evolutionState, cancelledAtLevel: null } } : c;
  const check = levelEvolutionToOffer(subject, info.checks);
  return check ? levelRequest(c, check) : null;
}

/**
 * Propozycje ewolucji po walce: tylko stworzenia, które awansowały (uids), są sprawne i spełniają warunek
 * poziomu (anulowana ewolucja wraca dopiero po kolejnym awansie). Błędy danych (offline) są pomijane.
 */
export async function pendingLevelEvolutions(party: Creature[], leveledUids: Iterable<string>): Promise<EvolutionRequest[]> {
  const wanted = new Set(leveledUids);
  const out: EvolutionRequest[] = [];
  for (const c of party) {
    if (!wanted.has(c.uid)) continue;
    try {
      const req = await levelEvolutionFor(c);
      if (req) out.push(req);
    } catch {
      /* brak danych (offline) — propozycja wróci przy kolejnym awansie albo z Drużyny */
    }
  }
  return out;
}

/** Ewolucja kamieniem: propozycja, jeśli stworzenie ma drogę ewolucji przez ten przedmiot. */
export async function itemEvolutionFor(c: Creature, itemId: ItemId): Promise<EvolutionRequest | null> {
  const info = await evolutionInfo(c);
  const check = info.checks.find((x) => x.status === 'NEEDS_ITEM' && x.itemId === itemId);
  if (!check) return null;
  return {
    uid: c.uid,
    toSpecies: check.option.to,
    toSpeciesId: check.option.toSpeciesId,
    method: 'ITEM',
    itemId,
    condition: ITEMS[itemId].name,
  };
}

function findCreature(uid: string): Creature | null {
  const g = useGame.getState();
  return g.party.find((c) => c.uid === uid) ?? g.storage.find((c) => c.uid === uid) ?? null;
}

export interface EvolutionResult {
  ok: boolean;
  message: string;
  creature?: Creature;
}

/**
 * Potwierdzona ewolucja: przemiana stworzenia (ruchy, doświadczenie i poziom zostają), wpis w Atlasie,
 * zużycie kamienia (tylko teraz — anulowanie go nie zużywa). Warunek sprawdzany ponownie.
 */
export async function performEvolution(req: EvolutionRequest): Promise<EvolutionResult> {
  const c = findCreature(req.uid);
  if (!c) return { ok: false, message: 'Tego stworzenia nie ma już w drużynie.' };
  const info = await evolutionInfo(c);
  const check = info.checks.find((x) => x.option.to === req.toSpecies);
  const stillOk =
    !!check &&
    (req.method === 'LEVEL'
      ? check.option.method === 'LEVEL' && check.status === 'READY'
      : check.status === 'NEEDS_ITEM' && check.itemId === req.itemId && (useGame.getState().bag[req.itemId as ItemId] ?? 0) > 0);
  if (!stillOk) return { ok: false, message: `${displayName(c)} nie spełnia już warunku ewolucji.` };

  const from = await deps.getPokemon(c.pokemon);
  const toSpecies = await deps.getSpecies(req.toSpeciesId || req.toSpecies);
  const variety = toSpecies.varieties.find((v) => v.isDefault)?.name ?? toSpecies.name;
  const to = await deps.getPokemon(variety);
  const evolved = evolveCreature(c, from, to, toSpecies);

  const game = useGame.getState();
  if (req.method === 'ITEM' && req.itemId && !game.removeItem(req.itemId as ItemId, 1)) {
    return { ok: false, message: 'Brak kamienia w torbie.' };
  }
  game.updateCreatures([evolved]);
  game.markCaught(dexInfo(to, toSpecies));
  return { ok: true, message: `Gratulacje! ${displayName(c)} ewoluuje w: ${evolved.name}!`, creature: evolved };
}

/** Anulowanie: ewolucja przez poziom wróci dopiero po kolejnym awansie; kamień nie jest zużywany. */
export function cancelEvolution(req: EvolutionRequest): string {
  const c = findCreature(req.uid);
  if (!c) return '';
  if (req.method === 'LEVEL') useGame.getState().setEvolutionCancelled(req.uid, c.level);
  return `${displayName(c)} nie ewoluuje.`;
}
