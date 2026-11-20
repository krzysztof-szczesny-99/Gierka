// Natury (Sprint 4): +10% / −10% albo neutralna; wpływ na statystyki przy tworzeniu, przeliczaniu i awansie.

import { describe, expect, it } from 'vitest';
import { NATURE_IDS, NATURES, NEUTRAL_NATURES, natureMultiplier, neutralNatureFor } from '../../config/natures';
import { resolveTurn, getActive } from '../battle/battleEngine';
import { createCreature, recalcStats } from '../creature';
import { createRng, createSequenceRng } from '../rng';
import { calcStat, calcStats } from '../stats';
import { STAT_KEYS } from '../types';
import { duel } from './battleKit';
import { growthMedium, makePokemon, makeSpecies, moves } from './fixtures';

describe('tabela natur', () => {
  it('25 natur: 5 neutralnych, 20 z różnymi parami (+, −) bez PŻ', () => {
    expect(NATURE_IDS).toHaveLength(25);
    expect([...NEUTRAL_NATURES].sort()).toEqual(['bashful', 'docile', 'hardy', 'quirky', 'serious']);
    const pairs = new Set<string>();
    for (const id of NATURE_IDS) {
      const n = NATURES[id];
      if (n.increased === null) {
        expect(n.decreased).toBeNull();
        continue;
      }
      expect(n.increased).not.toBe(n.decreased);
      expect(n.increased).not.toBe('hp' as never);
      pairs.add(`${n.increased}/${n.decreased}`);
    }
    expect(pairs.size).toBe(20);
  });

  it('mnożniki: 1,1 / 0,9 / 1; PŻ zawsze bez zmian', () => {
    expect(natureMultiplier('modest', 'spa')).toBe(1.1);
    expect(natureMultiplier('modest', 'atk')).toBe(0.9);
    expect(natureMultiplier('modest', 'spe')).toBe(1);
    expect(natureMultiplier('modest', 'hp')).toBe(1);
    for (const k of STAT_KEYS) expect(natureMultiplier('hardy', k)).toBe(1);
  });
});

describe('statystyki z naturą', () => {
  it('natura neutralna = wzór bez natury', () => {
    for (const k of STAT_KEYS) expect(calcStat(k, 80, 20, 40, 50, 'serious')).toBe(calcStat(k, 80, 20, 40, 50));
  });

  it('natura modyfikująca: +10% i −10% z zaokrągleniem w dół', () => {
    const plainSpa = calcStat('spa', 80, 31, 0, 50);
    const plainAtk = calcStat('atk', 80, 31, 0, 50);
    expect(calcStat('spa', 80, 31, 0, 50, 'modest')).toBe(Math.floor(plainSpa * 1.1));
    expect(calcStat('atk', 80, 31, 0, 50, 'modest')).toBe(Math.floor(plainAtk * 0.9));
    expect(calcStat('hp', 80, 31, 0, 50, 'modest')).toBe(calcStat('hp', 80, 31, 0, 50));
    expect(calcStat('spe', 80, 31, 0, 50, 'modest')).toBe(calcStat('spe', 80, 31, 0, 50));
  });

  it('nowe stworzenie ma naturę z listy, a jego statystyki ją uwzględniają (powtarzalnie z ziarnem)', () => {
    const pokemon = makePokemon('natty', ['normal'], 70);
    const make = (seed: number, nature?: 'adamant') =>
      createCreature({ pokemon, species: makeSpecies('natty'), growth: growthMedium, level: 30, moves: [moves.tackle], rng: createRng(seed), metAt: 't', nature });
    const c = make(11);
    expect(NATURE_IDS).toContain(c.nature);
    expect(c.stats).toEqual(calcStats(pokemon.baseStats, c.ivs, c.evs, 30, c.nature));
    expect(make(11).nature).toBe(c.nature); // to samo ziarno — ta sama natura
    const forced = make(11, 'adamant');
    expect(forced.stats.atk).toBe(calcStat('atk', 70, forced.ivs.atk, 0, 30, 'adamant'));
    expect(forced.stats.spa).toBe(calcStat('spa', 70, forced.ivs.spa, 0, 30, 'adamant'));
    expect(forced.stats.atk).toBeGreaterThan(calcStat('atk', 70, forced.ivs.atk, 0, 30));
  });

  it('przeliczenie statystyk i awans w walce zachowują wpływ natury', () => {
    const pokemon = makePokemon('natty', ['normal'], 70);
    const c = createCreature({ pokemon, species: makeSpecies('natty'), growth: growthMedium, level: 30, moves: [moves.tackle], rng: createRng(4), metAt: 't', nature: 'timid' });
    const up = recalcStats({ ...c, level: 31 }, pokemon);
    expect(up.stats).toEqual(calcStats(pokemon.baseStats, c.ivs, c.evs, 31, 'timid'));

    const d = duel(createRng(2), { moves: ['tackle'], level: 10, patch: { nature: 'brave', exp: 1330 } }, { moves: ['splash'], level: 30 });
    getActive(d.state, 1)!.hp = 1;
    const r = resolveTurn(d.state, { kind: 'move', moveIndex: 0 }, createSequenceRng([0.5]));
    const lead = getActive(r.state, 0)!;
    expect(lead.level).toBeGreaterThan(10);
    expect(lead.stats).toEqual(calcStats(d.pokemon.hero.baseStats, lead.ivs, lead.evs, lead.level, 'brave'));
  });

  it('natura dla starych zapisów: neutralna i stała dla danego uid', () => {
    for (const uid of ['c-1', 'c-abc', 'xyz-123']) {
      expect(NEUTRAL_NATURES).toContain(neutralNatureFor(uid));
      expect(neutralNatureFor(uid)).toBe(neutralNatureFor(uid));
    }
  });
});
