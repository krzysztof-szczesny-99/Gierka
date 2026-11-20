import { describe, expect, it } from 'vitest';
import { attemptCatch, catchProbability } from '../battle/catch';
import { calcDamage } from '../battle/damage';
import { createWildBattle, forceSwitch, getActive, resolveTurn } from '../battle/battleEngine';
import { EMPTY_BOOSTS } from '../battle/types';
import { expForLevel, expYield, levelFromExp } from '../experience';
import { movesForLevel } from '../moves';
import { createRng } from '../rng';
import { calcStat, stageMultiplier } from '../stats';
import { effectiveness } from '../typeChart';
import { chart, growthMedium, makeCreature, moves } from './fixtures';

describe('statystyki', () => {
  it('liczy HP i statystyki wg standardowego wzoru', () => {
    // baza 45, IV 31, EV 0, poziom 50 → HP 120, statystyka 65
    expect(calcStat('hp', 45, 31, 0, 50)).toBe(120);
    expect(calcStat('atk', 45, 31, 0, 50)).toBe(65);
  });
  it('mnożniki etapów', () => {
    expect(stageMultiplier(0)).toBe(1);
    expect(stageMultiplier(2)).toBe(2);
    expect(stageMultiplier(-1)).toBeCloseTo(2 / 3);
    expect(stageMultiplier(9)).toBe(4);
  });
});

describe('typy', () => {
  it('skuteczność łączy się multiplikatywnie', () => {
    expect(effectiveness(chart, 'fire', ['grass'])).toBe(2);
    expect(effectiveness(chart, 'fire', ['grass', 'steel'])).toBe(4);
    expect(effectiveness(chart, 'electric', ['water', 'ground'])).toBe(0);
    expect(effectiveness(chart, 'normal', ['fire'])).toBe(1);
  });
});

describe('obrażenia', () => {
  it('STAB, skuteczność i krytyk zwiększają obrażenia', () => {
    const rng = createRng(1);
    const a = makeCreature(rng, 'flamy', ['fire'], 20, ['ember']).creature;
    const d = makeCreature(rng, 'leafy', ['grass'], 20, ['tackle']).creature;
    const base = calcDamage({
      attacker: a,
      defender: d,
      attackerBoosts: { ...EMPTY_BOOSTS },
      defenderBoosts: { ...EMPTY_BOOSTS },
      move: moves.tackle,
      chart,
      rng,
      forceCrit: false,
      forceRandom: 100,
    });
    const stabSuper = calcDamage({
      attacker: a,
      defender: d,
      attackerBoosts: { ...EMPTY_BOOSTS },
      defenderBoosts: { ...EMPTY_BOOSTS },
      move: moves.ember,
      chart,
      rng,
      forceCrit: false,
      forceRandom: 100,
    });
    expect(stabSuper.effectiveness).toBe(2);
    expect(stabSuper.damage).toBeGreaterThan(base.damage * 2);
    const crit = calcDamage({
      attacker: a,
      defender: d,
      attackerBoosts: { ...EMPTY_BOOSTS },
      defenderBoosts: { ...EMPTY_BOOSTS },
      move: moves.tackle,
      chart,
      rng,
      forceCrit: true,
      forceRandom: 100,
    });
    expect(crit.damage).toBeGreaterThan(base.damage);
  });
});

describe('łapanie', () => {
  it('bardzo wysoka wartość łapania łapie zawsze', () => {
    const rng = createRng(2);
    const r = attemptCatch({ maxHp: 100, hp: 1, captureRate: 255, catchBonus: 2, status: 'slp' }, rng);
    expect(r.caught).toBe(true);
  });
  it('niższe HP = większa szansa', () => {
    const full = catchProbability({ maxHp: 100, hp: 100, captureRate: 45, catchBonus: 1, status: null });
    const low = catchProbability({ maxHp: 100, hp: 5, captureRate: 45, catchBonus: 1, status: null });
    expect(low).toBeGreaterThan(full);
    expect(full).toBeGreaterThan(0);
  });
});

describe('doświadczenie', () => {
  it('poziom z doświadczenia i odwrotnie', () => {
    expect(expForLevel(growthMedium, 10)).toBe(1000);
    expect(levelFromExp(growthMedium, 999)).toBe(9);
    expect(levelFromExp(growthMedium, 1000)).toBe(10);
    expect(expYield(64, 5, { trainer: false, participants: 1 })).toBe(45);
    expect(expYield(64, 5, { trainer: true, participants: 2 })).toBe(34);
  });
  it('wybiera ostatnie 4 ruchy do poziomu', () => {
    const lm = [
      { name: 'a', level: 1 },
      { name: 'b', level: 3 },
      { name: 'c', level: 5 },
      { name: 'd', level: 7 },
      { name: 'e', level: 9 },
    ];
    expect(movesForLevel(lm, 8)).toEqual(['a', 'b', 'c', 'd']);
    expect(movesForLevel(lm, 9)).toEqual(['b', 'c', 'd', 'e']);
    expect(movesForLevel(lm, 2)).toEqual(['a']);
  });
});

describe('walka', () => {
  function setup(seed: number, playerLevel = 12, enemyLevel = 5) {
    const rng = createRng(seed);
    const p = makeCreature(rng, 'flamy', ['fire'], playerLevel, ['ember', 'tackle', 'growl', 'swords-dance']);
    const e = makeCreature(rng, 'leafy', ['grass'], enemyLevel, ['tackle', 'growl']);
    const { state, events } = createWildBattle({
      playerName: 'Test',
      party: [p.creature],
      enemy: e.creature,
      pokemon: { flamy: p.pokemon, leafy: e.pokemon },
      moves,
      growth: { medium: growthMedium },
      typeChart: chart,
      captureRate: 255,
    });
    return { rng, state, events, player: p.creature, enemy: e.creature };
  }

  it('walka kończy się zwycięstwem i daje EXP', () => {
    const { rng, state: s0, events: intro } = setup(42);
    expect(intro.some((e) => e.t === 'sendOut')).toBe(true);
    let state = s0;
    let guard = 0;
    const all = [];
    while (!state.outcome && guard++ < 50) {
      const r = resolveTurn(state, { kind: 'move', moveIndex: 0 }, rng);
      state = r.state;
      all.push(...r.events);
    }
    expect(state.outcome).toBe('win');
    expect(all.some((e) => e.t === 'exp')).toBe(true);
    expect(all.filter((e) => e.t === 'end')).toHaveLength(1);
    const lead = getActive(state, 0)!;
    expect(lead.exp).toBeGreaterThan(expForLevel(growthMedium, 12));
  });

  it('stan wejściowy nie jest modyfikowany (czyste funkcje)', () => {
    const { rng, state } = setup(7);
    const before = JSON.stringify(state.sides);
    resolveTurn(state, { kind: 'move', moveIndex: 0 }, rng);
    expect(JSON.stringify(state.sides)).toBe(before);
  });

  it('ruch statusowy zmienia etap statystyki', () => {
    const { rng, state } = setup(9);
    const r = resolveTurn(state, { kind: 'move', moveIndex: 3 }, rng); // swords-dance
    const lead = getActive(r.state, 0)!;
    // Taniec mieczy: +2 do ataku; przeciwnik w tej samej turze może użyć Growl (−1) — liczymy wszystkie zmiany.
    const atk = r.events.filter((e): e is Extract<typeof e, { t: 'boost' }> => e.t === 'boost' && e.uid === lead.uid && e.stat === 'atk');
    expect(atk.some((e) => e.change === 2)).toBe(true);
    expect(r.state.boosts[lead.uid].atk).toBe(atk.reduce((sum, e) => sum + e.change, 0));
  });

  it('łapanie przy captureRate 255 i niskim HP kończy walkę', () => {
    const { rng, state } = setup(11);
    const enemy = getActive(state, 1)!;
    enemy.hp = 1;
    const r = resolveTurn(state, { kind: 'item', item: 'capsule-plus' }, rng);
    expect(r.events.some((e) => e.t === 'capsule')).toBe(true);
    expect(r.state.outcome).toBe('caught');
    expect(r.state.caught?.uid).toBe(enemy.uid);
  });

  it('ucieczka szybszym stworzeniem zawsze się udaje', () => {
    const { rng, state } = setup(13, 30, 2);
    const r = resolveTurn(state, { kind: 'run' }, rng);
    expect(r.state.outcome).toBe('fled');
  });

  it('po omdleniu wymagana jest zmiana, a gdy brak stworzeń — porażka', () => {
    const rng = createRng(5);
    const weak = makeCreature(rng, 'tiny', ['normal'], 2, ['growl']);
    const weak2 = makeCreature(rng, 'tiny', ['normal'], 2, ['growl']);
    const boss = makeCreature(rng, 'boss', ['normal'], 40, ['tackle'], 100);
    let { state } = createWildBattle({
      playerName: 'Test',
      party: [weak.creature, weak2.creature],
      enemy: boss.creature,
      pokemon: { tiny: weak.pokemon, boss: boss.pokemon },
      moves,
      growth: { medium: growthMedium },
      typeChart: chart,
      captureRate: 3,
    });
    let guard = 0;
    while (!state.outcome && guard++ < 30) {
      if (state.awaitingSwitch) {
        const idx = state.sides[0].party.findIndex((c) => c.hp > 0);
        state = forceSwitch(state, idx).state;
        expect(state.awaitingSwitch).toBe(false);
        continue;
      }
      state = resolveTurn(state, { kind: 'move', moveIndex: 0 }, rng).state;
    }
    expect(state.outcome).toBe('lose');
  });
});
