// AI trenerów (Sprint 5): profile BASIC / BALANCED / AGGRESSIVE, ruchy bez PP, skuteczność typów,
// zmiana stworzenia, brak zaglądania w przyszłe losowania; walka z trenerem w tym samym silniku.

import { describe, expect, it } from 'vitest';
import { AI_PROFILES, chooseMove, chooseSwitch, expectedDamageScore, type AiMode } from '../battle/ai';
import { createTrainerBattle, getActive, resolveTurn } from '../battle/battleEngine';
import { createRng, createSequenceRng, type Rng } from '../rng';
import type { Creature, PokemonData } from '../types';
import { MOVES } from './battleKit';
import { chart, growthMedium, makeCreature } from './fixtures';

const slots = (names: string[], pp = 30) => names.map((name) => ({ name, pp, maxPp: 30 }));

function mk(name: string, types: PokemonData['types'], moves: string[], patch: Partial<Creature> = {}, seed = 1, base = 60) {
  const m = makeCreature(createRng(seed), name, types, 20, [], base);
  return { creature: { ...m.creature, moves: slots(moves), ...patch } as Creature, pokemon: m.pokemon };
}

/** Licznik losowań — sprawdza, czy AI nie zużywa (ani nie podgląda) wartości losowych ponad swój wybór. */
function countingRng(seed = 7): Rng & { calls: number } {
  const base = createRng(seed);
  const r = {
    calls: 0,
    next: () => (r.calls++, base.next()),
    int: (a: number, b: number) => (r.calls++, base.int(a, b)),
    chance: (p: number) => (r.calls++, base.chance(p)),
    pick: <T>(arr: readonly T[]) => (r.calls++, base.pick(arr)),
  };
  return r as unknown as Rng & { calls: number };
}

const user = mk('user', ['fire'], ['tackle', 'ember', 'water-gun', 'vine-whip']).creature;
const grassFoe = mk('grassy', ['grass'], ['tackle'], {}, 2).creature;
const ghostFoe = mk('ghosty', ['ghost'] as never, ['tackle'], {}, 3).creature;

describe('AI: ruchy bez PP', () => {
  it('żaden profil nie wybiera ruchu bez PP (także gdy to najlepszy ruch); brak PP we wszystkich → ruch awaryjny', () => {
    const noEmber = { ...user, moves: user.moves.map((m) => (m.name === 'ember' ? { ...m, pp: 0 } : m)) };
    const allEmpty = { ...user, moves: user.moves.map((m) => ({ ...m, pp: 0 })) };
    for (const mode of ['random', ...AI_PROFILES] as AiMode[]) {
      for (let seed = 1; seed <= 25; seed++) {
        const idx = chooseMove(noEmber, grassFoe, MOVES, chart, createRng(seed), mode);
        expect(noEmber.moves[idx].pp).toBeGreaterThan(0);
      }
      expect(chooseMove(allEmpty, grassFoe, MOVES, chart, createRng(1), mode)).toBe(-1);
    }
  });
});

describe('AI: skuteczność typu i ruch zadający obrażenia', () => {
  it('BALANCED i AGGRESSIVE wybierają ruch skuteczny (ogień na trawę), a nie nieskuteczny (woda/trawa na trawę)', () => {
    expect(expectedDamageScore(user, grassFoe, MOVES.ember, chart)).toBeGreaterThan(expectedDamageScore(user, grassFoe, MOVES['water-gun'], chart));
    for (const mode of ['BALANCED', 'AGGRESSIVE'] as const) {
      expect(user.moves[chooseMove(user, grassFoe, MOVES, chart, createRng(1), mode)].name).toBe('ember');
    }
  });

  it('BASIC nigdy nie wybiera ruchu bez efektu (normalny na ducha), ale losuje spośród pozostałych', () => {
    const normalAndFire = { ...user, moves: slots(['tackle', 'ember']) };
    const picked = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) picked.add(normalAndFire.moves[chooseMove(normalAndFire, ghostFoe, MOVES, chart, createRng(seed), 'BASIC')].name);
    expect([...picked]).toEqual(['ember']);
    // Bez celu odpornego BASIC losuje spośród obu.
    const both = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) both.add(normalAndFire.moves[chooseMove(normalAndFire, grassFoe, MOVES, chart, createRng(seed), 'BASIC')].name);
    expect(both.size).toBe(2);
  });

  it('ruch zadający obrażenia zamiast bezużytecznego statusu (cel już sparaliżowany)', () => {
    const c = { ...user, moves: slots(['thunder-wave', 'tackle']) };
    const paralyzed = { ...grassFoe, status: 'par' as const };
    for (const mode of AI_PROFILES) expect(c.moves[chooseMove(c, paralyzed, MOVES, chart, createRng(3), mode)].name).toBe('tackle');
    // AGGRESSIVE zawsze atakuje, nawet gdy status miałby sens.
    expect(c.moves[chooseMove(c, grassFoe, MOVES, chart, createRng(3), 'AGGRESSIVE')].name).toBe('tackle');
  });
});

describe('AI: bez zaglądania w przyszłe losowania', () => {
  it('BALANCED i AGGRESSIVE nie zużywają losowań i wybierają tak samo przy każdym strumieniu; BASIC zużywa dokładnie jedno', () => {
    for (const mode of ['BALANCED', 'AGGRESSIVE'] as const) {
      const choices = new Set<number>();
      for (let seed = 1; seed <= 10; seed++) {
        const r = countingRng(seed);
        choices.add(chooseMove(user, grassFoe, MOVES, chart, r, mode));
        expect(r.calls).toBe(0);
      }
      expect(choices.size).toBe(1);
    }
    const r = countingRng(1);
    chooseMove(user, grassFoe, MOVES, chart, r, 'BASIC');
    expect(r.calls).toBe(1);
    const wild = countingRng(1);
    chooseMove(user, grassFoe, MOVES, chart, wild, 'random');
    expect(wild.calls).toBe(1); // dzikie — bez zmian względem wcześniejszych wersji
  });
});

describe('AI: zmiana stworzenia', () => {
  const electricUser = mk('sparky', ['electric'], ['thunder-shock'], {}, 4).creature;
  const fireBench = mk('flamy', ['fire'], ['ember'], {}, 5).creature;
  const groundFoe = mk('mole', ['ground'] as never, ['tackle'], {}, 6).creature;

  it('aktywne stworzenie nie może zaszkodzić celowi (prąd na ziemię), w drużynie jest lepsze → zmiana', () => {
    expect(chooseSwitch(electricUser, [electricUser, fireBench], 0, groundFoe, MOVES, chart)).toBe(1);
  });

  it('bez zmiany: aktywne radzi sobie, zastępca omdlał albo nie ma lepszego', () => {
    expect(chooseSwitch(fireBench, [fireBench, electricUser], 0, grassFoe, MOVES, chart)).toBeNull();
    expect(chooseSwitch(electricUser, [electricUser, { ...fireBench, hp: 0 }], 0, groundFoe, MOVES, chart)).toBeNull();
    expect(chooseSwitch(electricUser, [electricUser], 0, groundFoe, MOVES, chart)).toBeNull();
  });
});

describe('walka z trenerem w istniejącym silniku', () => {
  function trainerBattle(ai: 'BASIC' | 'BALANCED' | 'AGGRESSIVE', enemies: { creature: Creature; pokemon: PokemonData }[], player = mk('hero', ['ground'] as never, ['tackle'], {}, 9, 80)) {
    const pokemon: Record<string, PokemonData> = { [player.pokemon.name]: player.pokemon };
    for (const e of enemies) pokemon[e.pokemon.name] = e.pokemon;
    return createTrainerBattle({
      playerName: 'Gracz',
      party: [player.creature],
      enemies: enemies.map((e) => e.creature),
      pokemon,
      moves: MOVES,
      growth: { medium: growthMedium },
      typeChart: chart,
      trainerName: 'Tropiciel Test',
      ai,
    });
  }

  it('wyzwanie, bez ucieczki i łapania; po omdleniu wchodzi kolejne stworzenie; wygrana po pokonaniu całej drużyny', () => {
    const a = mk('first', ['normal'], ['tackle'], { hp: 1 }, 11);
    const b = mk('second', ['normal'], ['tackle'], { hp: 1 }, 12);
    const { state, events } = trainerBattle('BASIC', [a, b]);
    expect(state.sides[1]).toMatchObject({ kind: 'trainer', name: 'Tropiciel Test', ai: 'BASIC' });
    expect(events.some((e) => e.t === 'msg' && e.text.includes('wyzywa Cię do walki'))).toBe(true);
    const run = resolveTurn(state, { kind: 'run' }, createSequenceRng([0.5]));
    expect(run.state.outcome).toBeNull();
    expect(run.events.some((e) => e.t === 'msg' && e.text.includes('nie można uciec'))).toBe(true);
    const t1 = resolveTurn(run.state, { kind: 'move', moveIndex: 0 }, createSequenceRng([0.5]));
    expect(getActive(t1.state, 1)?.uid).toBe(b.creature.uid);
    expect(t1.state.outcome).toBeNull();
    const t2 = resolveTurn(t1.state, { kind: 'move', moveIndex: 0 }, createSequenceRng([0.5]));
    expect(t2.state.outcome).toBe('win');
  });

  it('BALANCED zmienia stworzenie, gdy aktywne nie może zaszkodzić — ale nie dwie tury z rzędu; BASIC nie zmienia', () => {
    const spark = mk('sparky', ['electric'], ['thunder-shock'], {}, 4);
    const flame = mk('flamy', ['fire'], ['ember'], {}, 5);
    const balanced = trainerBattle('BALANCED', [spark, flame]);
    const t1 = resolveTurn(balanced.state, { kind: 'move', moveIndex: 0 }, createSequenceRng([0.5]));
    expect(getActive(t1.state, 1)?.uid).toBe(flame.creature.uid);
    expect(t1.events.some((e) => e.t === 'withdraw' && e.side === 1)).toBe(true);
    expect(t1.events.some((e) => e.t === 'useMove' && e.side === 1)).toBe(false); // zmiana zajęła turę
    // Gdyby teraz to nowe stworzenie było bezradne, a poprzednie silne — w następnej turze AI i tak nie wraca.
    const swapped = structuredClone(t1.state);
    swapped.sides[1].party[1].moves = slots(['thunder-shock']);
    swapped.sides[1].party[0].moves = slots(['ember']);
    const t2 = resolveTurn(swapped, { kind: 'move', moveIndex: 0 }, createSequenceRng([0.5]));
    expect(getActive(t2.state, 1)?.uid).toBe(flame.creature.uid);
    const t3 = resolveTurn(t2.state, { kind: 'move', moveIndex: 0 }, createSequenceRng([0.5]));
    expect(getActive(t3.state, 1)?.uid).toBe(spark.creature.uid);
    const basic = trainerBattle('BASIC', [spark, flame]);
    const b1 = resolveTurn(basic.state, { kind: 'move', moveIndex: 0 }, createSequenceRng([0.5]));
    expect(getActive(b1.state, 1)?.uid).toBe(spark.creature.uid);
  });
});
