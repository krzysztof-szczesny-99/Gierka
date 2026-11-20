// Ewolucje (Sprint 4): normalizacja evolution-chain z PokéAPI, ocena warunków i przemiana stworzenia.

import { describe, expect, it } from 'vitest';
import {
  abilityAfterEvolution,
  evaluateEvolutions,
  evolveCreature,
  levelEvolutionToOffer,
  normalizeEvolutionChain,
  normalizeEvolutionDetail,
  type RawEvolutionChain,
} from '../evolution';
import { createRng } from '../rng';
import { CATERPIE_CHAIN, detail, EEVEE_CHAIN, LEAFEON_CHAIN, RATTATA_CHAIN, ref, useItem, WOOPER_CHAIN } from './evolutionFixtures';
import { calcStats } from '../stats';
import { makeCreature, makePokemon, makeSpecies } from './fixtures';

const OTHER_CHAIN: RawEvolutionChain = {
  id: 99,
  chain: {
    species: ref('kadabra', 64),
    evolution_details: [],
    evolves_to: [
      { species: ref('alakazam', 65), evolution_details: [detail({ trigger: { name: 'trade', url: '' } })], evolves_to: [] },
      { species: ref('gallade', 475), evolution_details: [detail({ ...useItem('dawn-stone'), gender: 2 })], evolves_to: [] },
      { species: ref('hitmontop', 237), evolution_details: [detail({ min_level: 20, relative_physical_stats: 0 })], evolves_to: [] },
    ],
  },
};

describe('normalizacja łańcucha z PokéAPI', () => {
  it('poziom: caterpie → metapod (7) → butterfree (10)', () => {
    const chain = normalizeEvolutionChain(CATERPIE_CHAIN);
    expect(chain.options.map((o) => [o.from, o.to, o.method, o.minLevel, o.toSpeciesId])).toEqual([
      ['caterpie', 'metapod', 'LEVEL', 7, 11],
      ['metapod', 'butterfree', 'LEVEL', 10, 12],
    ]);
  });

  it('przedmiot: kamienie → ITEM; przyjaźń, pora dnia, miejsce, więź → NOT_IMPLEMENTED z powodem', () => {
    const o = normalizeEvolutionChain(EEVEE_CHAIN).options;
    const by = (to: string) => o.filter((x) => x.to === to);
    expect(by('vaporeon')[0]).toMatchObject({ method: 'ITEM', itemApi: 'water-stone' });
    expect(by('espeon')[0]).toMatchObject({ method: 'NOT_IMPLEMENTED' });
    expect(by('espeon')[0].unsupported).toEqual(['przyjaźń', 'pora dnia']);
    // Jest droga obsługiwana (kamień) — alternatywa „miejsce” nie jest pokazywana.
    expect(by('glaceon').map((x) => x.method)).toEqual(['ITEM']);
    expect(normalizeEvolutionDetail('eevee', ref('glaceon', 471), detail({ location: { name: 'ice-rock', url: '' } }))).toMatchObject({ method: 'NOT_IMPLEMENTED', unsupported: ['miejsce'] });
    expect(by('sylveon')[0].unsupported).toEqual(['typ znanego ruchu', 'więź']);
  });

  it('wymiana i stosunek statystyk (także wartość 0) → NOT_IMPLEMENTED; płeć jest obsługiwana', () => {
    const o = normalizeEvolutionChain(OTHER_CHAIN).options;
    expect(o.find((x) => x.to === 'alakazam')).toMatchObject({ method: 'NOT_IMPLEMENTED', unsupported: ['wymiana'] });
    expect(o.find((x) => x.to === 'hitmontop')).toMatchObject({ method: 'NOT_IMPLEMENTED', unsupported: ['stosunek ataku do obrony'] });
    expect(o.find((x) => x.to === 'gallade')).toMatchObject({ method: 'ITEM', gender: 'M', itemApi: 'dawn-stone' });
  });
});

describe('dane w kształcie bieżącego PokéAPI (wersje gier, formy)', () => {
  it('metadane version_group / is_default / required_pokemon_form nie blokują ewolucji przez poziom', () => {
    const o = normalizeEvolutionChain(CATERPIE_CHAIN).options[0];
    expect(o).toMatchObject({ method: 'LEVEL', minLevel: 7, unsupported: [], preferred: true });
  });

  it('Leafeon: kamień z dwóch wersji gier łączony w jedną drogę; „miejsce” pomijane, bo jest droga obsługiwana', () => {
    const o = normalizeEvolutionChain(LEAFEON_CHAIN).options;
    const leafeon = o.filter((x) => x.to === 'leafeon');
    expect(leafeon).toHaveLength(1);
    expect(leafeon[0]).toMatchObject({ method: 'ITEM', itemApi: 'leaf-stone', requiredForm: 'eevee', preferred: true });
    const umbreon = o.filter((x) => x.to === 'umbreon');
    expect(umbreon).toHaveLength(1);
    expect(umbreon[0]).toMatchObject({ method: 'NOT_IMPLEMENTED', unsupported: ['przyjaźń', 'pora dnia'] });
    const checks = evaluateEvolutions({ level: 10, gender: 'M', pokemon: 'eevee' }, 'eevee', true, normalizeEvolutionChain(LEAFEON_CHAIN));
    expect(checks.find((x) => x.option.to === 'leafeon')).toMatchObject({ status: 'NEEDS_ITEM', itemId: 'stone-leaf' });
  });

  it('formy regionalne: każda forma widzi tylko swoją drogę; forma docelowa regionalna → NOT_IMPLEMENTED', () => {
    const chain = normalizeEvolutionChain(RATTATA_CHAIN);
    const plain = evaluateEvolutions({ level: 20, gender: 'M', pokemon: 'rattata' }, 'rattata', true, chain);
    expect(plain).toHaveLength(1);
    expect(plain[0]).toMatchObject({ status: 'READY' });
    const alola = evaluateEvolutions({ level: 20, gender: 'M', pokemon: 'rattata-alola' }, 'rattata', false, chain);
    expect(alola).toHaveLength(1);
    expect(alola[0].status).toBe('NOT_IMPLEMENTED');
    expect(alola[0].option.unsupported).toEqual(['pora dnia', 'forma docelowa']);
  });

  it('forma regionalna z jawną drogą do innego gatunku ewoluuje normalnie (wooper-paldea → clodsire)', () => {
    const chain = normalizeEvolutionChain(WOOPER_CHAIN);
    const paldea = evaluateEvolutions({ level: 20, gender: 'F', pokemon: 'wooper-paldea' }, 'wooper', false, chain);
    expect(paldea.map((x) => [x.option.to, x.status])).toEqual([['clodsire', 'READY']]);
    const plain = evaluateEvolutions({ level: 20, gender: 'F', pokemon: 'wooper' }, 'wooper', true, chain);
    expect(plain.map((x) => [x.option.to, x.status])).toEqual([['quagsire', 'READY']]);
  });
});

describe('ocena warunków dla stworzenia', () => {
  const caterpie = normalizeEvolutionChain(CATERPIE_CHAIN);
  const eevee = normalizeEvolutionChain(EEVEE_CHAIN);

  it('poziom: przed progiem WAITING, od progu READY; tylko drogi z bieżącego gatunku', () => {
    expect(evaluateEvolutions({ level: 6, gender: 'M', pokemon: 'caterpie' }, 'caterpie', true, caterpie).map((x) => x.status)).toEqual(['WAITING']);
    const ready = evaluateEvolutions({ level: 7, gender: 'M', pokemon: 'caterpie' }, 'caterpie', true, caterpie);
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ status: 'READY', condition: 'poziom 7' });
    expect(ready[0].option.to).toBe('metapod');
    expect(evaluateEvolutions({ level: 50, gender: 'M', pokemon: 'butterfree' }, 'butterfree', true, caterpie)).toEqual([]);
  });

  it('przedmiot: lokalny kamień → NEEDS_ITEM; przedmiot spoza gry → NOT_IMPLEMENTED', () => {
    const checks = evaluateEvolutions({ level: 10, gender: 'F', pokemon: 'eevee' }, 'eevee', true, eevee);
    expect(checks.find((x) => x.option.to === 'vaporeon')).toMatchObject({ status: 'NEEDS_ITEM', itemId: 'stone-water' });
    expect(checks.find((x) => x.option.to === 'jolteon')).toMatchObject({ status: 'NEEDS_ITEM', itemId: 'stone-thunder' });
    expect(checks.filter((x) => x.option.to === 'glaceon').every((x) => x.status === 'NOT_IMPLEMENTED')).toBe(true);
    expect(checks.find((x) => x.option.to === 'espeon')?.status).toBe('NOT_IMPLEMENTED');
  });

  it('forma regionalna i płeć', () => {
    expect(evaluateEvolutions({ level: 30, gender: 'M', pokemon: 'caterpie-x' }, 'caterpie', false, caterpie)[0].status).toBe('NOT_IMPLEMENTED');
    const kadabra = normalizeEvolutionChain(OTHER_CHAIN);
    expect(evaluateEvolutions({ level: 30, gender: 'F', pokemon: 'kadabra' }, 'kadabra', true, kadabra).some((x) => x.option.to === 'gallade')).toBe(false);
    expect(evaluateEvolutions({ level: 30, gender: 'M', pokemon: 'kadabra' }, 'kadabra', true, kadabra).some((x) => x.option.to === 'gallade')).toBe(true);
  });

  it('propozycja po awansie: anulowana na danym poziomie wraca dopiero po kolejnym; wyczerpane — nie', () => {
    const base = { uid: 'c-1', gender: 'M' as const, hp: 10 };
    const at = (level: number, cancelledAtLevel: number | null, hp = 10) =>
      levelEvolutionToOffer({ ...base, hp, level, evolutionState: { cancelledAtLevel, evolvedFrom: null } }, evaluateEvolutions({ level, gender: 'M', pokemon: 'caterpie' }, 'caterpie', true, caterpie));
    expect(at(7, null)?.option.to).toBe('metapod');
    expect(at(7, 7)).toBeNull();
    expect(at(8, 7)?.option.to).toBe('metapod');
    expect(at(7, null, 0)).toBeNull();
    expect(at(6, null)).toBeNull();
  });
});

describe('przemiana', () => {
  const rng = createRng(21);
  const from = { ...makePokemon('caterpie', ['bug'], 45), abilities: [{ name: 'shield-dust', hidden: false }, { name: 'run-away', hidden: true }] };
  const to = { ...makePokemon('metapod', ['bug'], 55), abilities: [{ name: 'shed-skin', hidden: false }] };
  const toSpecies = { ...makeSpecies('metapod'), id: 11 };

  it('zostają ruchy, doświadczenie, poziom, IV/EV, natura, przedmiot, płeć, przezwisko; statystyki z nowej bazy', () => {
    const c = { ...makeCreature(rng, 'caterpie', ['bug'], 7, ['tackle', 'growl']).creature, abilityId: 'shield-dust', nature: 'adamant' as const, heldItemId: 'swift-claw', nickname: 'Gąsienica', exp: 400 };
    c.evs = { ...c.evs, atk: 8 };
    const damaged = { ...c, hp: c.stats.hp - 5 };
    const e = evolveCreature(damaged, from, to, toSpecies);
    expect(e.pokemon).toBe('metapod');
    expect(e.speciesId).toBe(11);
    expect(e.name).toBe('Metapod');
    expect(e.moves).toEqual(c.moves);
    expect([e.level, e.exp, e.nature, e.heldItemId, e.gender, e.nickname, e.uid]).toEqual([7, 400, 'adamant', 'swift-claw', c.gender, 'Gąsienica', c.uid]);
    expect(e.ivs).toEqual(c.ivs);
    expect(e.evs).toEqual(c.evs);
    expect(e.stats).toEqual(calcStats(to.baseStats, c.ivs, c.evs, 7, 'adamant'));
    expect(e.hp).toBe(e.stats.hp - 5);
    expect(e.abilityId).toBe('shed-skin');
    expect(e.evolutionState).toEqual({ cancelledAtLevel: null, evolvedFrom: 'caterpie' });
  });

  it('zdolność po ewolucji: ten sam slot, ukryta → ukryta, brak → pierwsza zwykła', () => {
    const f = { ...from, abilities: [{ name: 'a1', hidden: false }, { name: 'a2', hidden: false }, { name: 'h1', hidden: true }] };
    const t = { ...to, abilities: [{ name: 'b1', hidden: false }, { name: 'b2', hidden: false }, { name: 'h2', hidden: true }] };
    expect(abilityAfterEvolution('a2', f, t)).toBe('b2');
    expect(abilityAfterEvolution('h1', f, t)).toBe('h2');
    expect(abilityAfterEvolution('zzz', f, t)).toBe('b1');
  });
});
