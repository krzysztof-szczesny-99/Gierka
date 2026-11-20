// Ewolucje w grze (Sprint 4): propozycje po awansie, anulowanie, ewolucja kamieniem, zapis i wczytanie.
// Dane PokéAPI są podstawione (configureEvolutionDeps) — bez sieci.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateSave } from '../../data/migrations';
import { normalizeEvolutionChain } from '../../engine/evolution';
import { CATERPIE_CHAIN, EEVEE_CHAIN } from '../../engine/__tests__/evolutionFixtures';
import { makeCreature, makePokemon, makeSpecies } from '../../engine/__tests__/fixtures';
import { createRng } from '../../engine/rng';
import type { Creature, PokemonData, SpeciesData } from '../../engine/types';
import { useGame } from '../../state/gameStore';
import {
  cancelEvolution,
  configureEvolutionDeps,
  itemEvolutionFor,
  levelEvolutionFor,
  pendingLevelEvolutions,
  performEvolution,
} from '../evolutionService';

const species = (name: string, id: number, chainId: number): SpeciesData => ({ ...makeSpecies(name), id, evolutionChainId: chainId });
const SPECIES: Record<string, SpeciesData> = {
  caterpie: species('caterpie', 10, 4),
  metapod: species('metapod', 11, 4),
  eevee: species('eevee', 133, 67),
  vaporeon: species('vaporeon', 134, 67),
};
const byId = Object.fromEntries(Object.values(SPECIES).map((s) => [String(s.id), s]));
const POKEMON: Record<string, PokemonData> = {
  caterpie: { ...makePokemon('caterpie', ['bug'], 45), speciesId: 10 },
  metapod: { ...makePokemon('metapod', ['bug'], 55), speciesId: 11 },
  eevee: { ...makePokemon('eevee', ['normal'], 55), speciesId: 133 },
  vaporeon: { ...makePokemon('vaporeon', ['water'], 95), speciesId: 134 },
};
const CHAINS = { 4: normalizeEvolutionChain(CATERPIE_CHAIN), 67: normalizeEvolutionChain(EEVEE_CHAIN) };

let restore = () => undefined as void;
const rng = createRng(31);
const mk = (name: string, level: number): Creature => ({
  ...makeCreature(rng, name, POKEMON[name].types, level, ['tackle', 'growl']).creature,
  speciesId: SPECIES[name].id,
  nature: 'modest',
  heldItemId: 'trail-leftovers',
});

let cat: Creature;
let eev: Creature;

beforeEach(() => {
  restore = configureEvolutionDeps({
    getPokemon: async (n) => {
      const p = POKEMON[n];
      if (!p) throw new Error(`brak ${n}`);
      return p;
    },
    getSpecies: async (idOrName) => {
      const s = byId[String(idOrName)] ?? SPECIES[String(idOrName)];
      if (!s) throw new Error(`brak gatunku ${idOrName}`);
      return s;
    },
    getEvolutionChain: async (id) => CHAINS[id as 4 | 67],
  });
  cat = mk('caterpie', 7);
  eev = mk('eevee', 10);
  useGame.getState().resetGame();
  useGame.setState({ party: [structuredClone(cat), structuredClone(eev)], storage: [], bag: {}, dex: {}, started: true });
});
afterEach(() => restore());

const inParty = (uid: string) => useGame.getState().party.find((c) => c.uid === uid)!;

describe('ewolucja przez poziom', () => {
  it('po awansie proponowana jest tylko ewolucja stworzenia, które awansowało i spełnia warunek', async () => {
    const reqs = await pendingLevelEvolutions(useGame.getState().party, [cat.uid, eev.uid]);
    expect(reqs).toEqual([{ uid: cat.uid, toSpecies: 'metapod', toSpeciesId: 11, method: 'LEVEL', itemId: null, condition: 'poziom 7' }]);
    expect(await pendingLevelEvolutions(useGame.getState().party, [eev.uid])).toEqual([]);
    expect(await pendingLevelEvolutions(useGame.getState().party, [])).toEqual([]);
  });

  it('potwierdzenie: nowy gatunek, ruchy, doświadczenie, natura i przedmiot zostają; wpis w Atlasie', async () => {
    const [req] = await pendingLevelEvolutions(useGame.getState().party, [cat.uid]);
    const r = await performEvolution(req);
    expect(r.ok).toBe(true);
    const c = inParty(cat.uid);
    expect(c.pokemon).toBe('metapod');
    expect(c.moves).toEqual(cat.moves);
    expect([c.exp, c.level, c.nature, c.heldItemId]).toEqual([cat.exp, 7, 'modest', 'trail-leftovers']);
    expect(c.evolutionState.evolvedFrom).toBe('caterpie');
    expect(useGame.getState().dex['11']).toMatchObject({ seen: true, caught: true });
  });

  it('anulowanie: brak ponownej propozycji na tym samym poziomie, wraca po kolejnym awansie; przycisk w Drużynie działa zawsze', async () => {
    const [req] = await pendingLevelEvolutions(useGame.getState().party, [cat.uid]);
    expect(cancelEvolution(req)).toContain('nie ewoluuje');
    expect(inParty(cat.uid).pokemon).toBe('caterpie');
    expect(inParty(cat.uid).evolutionState.cancelledAtLevel).toBe(7);
    expect(await pendingLevelEvolutions(useGame.getState().party, [cat.uid])).toEqual([]);
    expect(await levelEvolutionFor(inParty(cat.uid), true)).toMatchObject({ toSpecies: 'metapod' });
    useGame.getState().updateCreatures([{ ...inParty(cat.uid), level: 8 }]);
    expect(await pendingLevelEvolutions(useGame.getState().party, [cat.uid])).toHaveLength(1);
  });
});

describe('ewolucja przez przedmiot', () => {
  it('kamień: propozycja tylko dla pasującego stworzenia; anulowanie nie zużywa kamienia; potwierdzenie — zużywa', async () => {
    useGame.setState({ bag: { 'stone-water': 1 } });
    expect(await itemEvolutionFor(eev, 'stone-fire')).toBeNull(); // brak takiej drogi w łańcuchu testowym
    expect(await itemEvolutionFor(cat, 'stone-water')).toBeNull();
    const req = await itemEvolutionFor(eev, 'stone-water');
    expect(req).toMatchObject({ toSpecies: 'vaporeon', method: 'ITEM', itemId: 'stone-water' });
    cancelEvolution(req!);
    expect(useGame.getState().bag['stone-water']).toBe(1);
    expect(inParty(eev.uid).evolutionState.cancelledAtLevel).toBeNull();
    const r = await performEvolution(req!);
    expect(r.ok).toBe(true);
    expect(inParty(eev.uid).pokemon).toBe('vaporeon');
    expect(inParty(eev.uid).types).toEqual(['water']);
    expect(useGame.getState().bag['stone-water']).toBe(0);
  });

  it('bez kamienia w torbie ewolucja się nie odbywa', async () => {
    useGame.setState({ bag: { 'stone-water': 1 } });
    const req = (await itemEvolutionFor(eev, 'stone-water'))!;
    useGame.setState({ bag: { 'stone-water': 0 } });
    const r = await performEvolution(req);
    expect(r.ok).toBe(false);
    expect(inParty(eev.uid).pokemon).toBe('eevee');
  });
});

describe('zapis i wczytanie nowych pól', () => {
  it('natura, zdolność, przedmiot i stan ewolucji przechodzą przez zapis (JSON) i wczytanie', async () => {
    const [req] = await pendingLevelEvolutions(useGame.getState().party, [cat.uid]);
    await performEvolution(req);
    cancelEvolution({ ...req, uid: eev.uid, method: 'LEVEL' });
    const saved = JSON.parse(JSON.stringify(useGame.getState().snapshot()));
    useGame.getState().resetGame();
    useGame.getState().loadData(migrateSave(saved));
    const c = inParty(cat.uid);
    const e = inParty(eev.uid);
    expect(c).toMatchObject({ pokemon: 'metapod', nature: 'modest', abilityId: cat.abilityId, heldItemId: 'trail-leftovers', evolutionState: { evolvedFrom: 'caterpie', cancelledAtLevel: null } });
    expect(e.evolutionState).toEqual({ cancelledAtLevel: 10, evolvedFrom: null });
  });
});
