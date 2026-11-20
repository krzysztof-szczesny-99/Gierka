// Zdolności działające w walce (Sprint 4) — każda zdolność z src/config/abilities.ts ma tu test.

import { describe, expect, it } from 'vitest';
import { ABILITIES, IMPLEMENTED_ABILITY_IDS } from '../../config/abilities';
import { getActive, resolveTurn } from '../battle/battleEngine';
import { calcDamage } from '../battle/damage';
import { EMPTY_BOOSTS, type BattleState } from '../battle/types';
import { createRng, createSequenceRng } from '../rng';
import type { Creature, MoveData } from '../types';
import { duel, MOVES, texts } from './battleKit';
import { chart, makeCreature } from './fixtures';

const seq = (v: number) => createSequenceRng([v]);
const player = (s: BattleState) => getActive(s, 0)!;
const enemy = (s: BattleState) => getActive(s, 1)!;
const move = (i = 0) => ({ kind: 'move' as const, moveIndex: i });

function damage(attacker: Creature, defender: Creature, m: MoveData): number {
  return calcDamage({
    attacker,
    defender,
    attackerBoosts: { ...EMPTY_BOOSTS },
    defenderBoosts: { ...EMPTY_BOOSTS },
    move: m,
    chart,
    rng: createRng(1),
    forceCrit: false,
    forceRandom: 100,
  }).damage;
}

function pair(attackerAbility: string, defenderAbility = 'test-ability') {
  const rng = createRng(3);
  const a = { ...makeCreature(rng, 'a', ['normal'], 40, [], 80).creature, abilityId: attackerAbility };
  const d = { ...makeCreature(rng, 'd', ['normal'], 40, [], 80).creature, abilityId: defenderAbility };
  return { a, d };
}

describe('lista zdolności', () => {
  it('działa 20 zdolności — każda ma nazwę, opis i działanie', () => {
    expect(IMPLEMENTED_ABILITY_IDS).toHaveLength(20);
    for (const id of IMPLEMENTED_ABILITY_IDS) {
      expect(ABILITIES[id].id).toBe(id);
      expect(ABILITIES[id].name.length).toBeGreaterThan(2);
      expect(ABILITIES[id].description.length).toBeGreaterThan(10);
    }
  });
});

describe('wzmocnienie typu w opałach (PŻ ≤ 1/3)', () => {
  const cases: [string, string][] = [
    ['overgrow', 'vine-whip'],
    ['blaze', 'ember'],
    ['torrent', 'water-gun'],
    ['swarm', 'bug-bite'],
  ];
  for (const [ability, moveName] of cases) {
    it(`${ability}: ${moveName} ×1,5 przy PŻ ≤ 1/3, bez zmian przy pełnych PŻ i dla innych typów`, () => {
      const { a, d } = pair(ability);
      const full = damage(a, d, MOVES[moveName]);
      const tackleFull = damage(a, d, MOVES.tackle);
      const low = { ...a, hp: Math.floor(a.stats.hp / 3) };
      expect(damage(low, d, MOVES[moveName])).toBe(Math.floor(full * 1.5));
      expect(damage(low, d, MOVES.tackle)).toBe(tackleFull);
      const plain = { ...low, abilityId: 'test-ability' };
      expect(damage(plain, d, MOVES[moveName])).toBe(full);
    });
  }
});

describe('zdolności przy wejściu i ochrona statystyk', () => {
  it('intimidate: przy wejściu obniża atak przeciwnika (obie strony)', () => {
    const a = duel(createRng(1), { moves: ['splash'] }, { moves: ['splash'], patch: { abilityId: 'intimidate' } });
    expect(a.state.boosts[player(a.state).uid].atk).toBe(-1);
    expect(texts(a.events).some((t) => t.includes('Groźne spojrzenie'))).toBe(true);
    const b = duel(createRng(1), { moves: ['splash'], patch: { abilityId: 'intimidate' } }, { moves: ['splash'] });
    expect(b.state.boosts[enemy(b.state).uid].atk).toBe(-1);
  });

  it('hyper-cutter: atak nie spada (Growl, Groźne spojrzenie)', () => {
    const vsGrowl = (ability: string) => {
      const d = duel(createRng(1), { moves: ['splash'], patch: { abilityId: ability } }, { moves: ['growl'] });
      return resolveTurn(d.state, move(), seq(0.5));
    };
    const plain = vsGrowl('test-ability');
    expect(plain.state.boosts[player(plain.state).uid].atk).toBe(-1);
    const r = vsGrowl('hyper-cutter');
    expect(r.state.boosts[player(r.state).uid].atk).toBe(0);
    expect(texts(r.events).some((t) => t.includes('Mocne szczypce'))).toBe(true);
    const intim = duel(createRng(1), { moves: ['splash'], patch: { abilityId: 'hyper-cutter' } }, { moves: ['splash'], patch: { abilityId: 'intimidate' } });
    expect(intim.state.boosts[player(intim.state).uid].atk).toBe(0);
  });

  it('keen-eye: przeciwnik nie obniża celności', () => {
    const run = (ability: string) => {
      const d = duel(createRng(1), { moves: ['splash'], patch: { abilityId: ability } }, { moves: ['sand-attack'] });
      return resolveTurn(d.state, move(), seq(0.5));
    };
    const plain = run('test-ability');
    expect(plain.state.boosts[player(plain.state).uid].acc).toBe(-1);
    const r = run('keen-eye');
    expect(r.state.boosts[player(r.state).uid].acc).toBe(0);
    expect(texts(r.events).some((t) => t.includes('Bystre oko'))).toBe(true);
  });

  it('clear-body: żadna statystyka nie spada przez przeciwnika (ruch statusowy i efekt ruchu ataku)', () => {
    const run = (ability: string, enemyMove: string) => {
      const d = duel(createRng(1), { moves: ['splash'], patch: { abilityId: ability } }, { moves: [enemyMove] });
      return resolveTurn(d.state, move(), seq(0.5));
    };
    const leerPlain = run('test-ability', 'leer');
    expect(leerPlain.state.boosts[player(leerPlain.state).uid].def).toBe(-1);
    const leer = run('clear-body', 'leer');
    expect(leer.state.boosts[player(leer.state).uid].def).toBe(0);
    const acid = run('clear-body', 'acid-strike');
    expect(acid.state.boosts[player(acid.state).uid].spd).toBe(0);
    expect(texts(acid.events).some((t) => t.includes('Czyste ciało'))).toBe(true);
  });
});

describe('odporność na status', () => {
  const cases: [string, string, string][] = [
    ['insomnia', 'sleep-powder', 'slp'],
    ['limber', 'thunder-wave', 'par'],
    ['immunity', 'poison-powder', 'psn'],
    ['water-veil', 'will-o-wisp', 'brn'],
    ['magma-armor', 'freeze-strike', 'frz'],
  ];
  for (const [ability, enemyMove, status] of cases) {
    it(`${ability}: ${enemyMove} nie nakłada statusu ${status}`, () => {
      const run = (ab: string) => {
        const d = duel(createRng(1), { moves: ['splash'], patch: { abilityId: ab } }, { moves: [enemyMove] });
        return resolveTurn(d.state, move(), seq(0.5));
      };
      expect(player(run('test-ability').state).status).toBe(status);
      const r = run(ability);
      expect(player(r.state).status).toBeNull();
      expect(texts(r.events).some((t) => t.includes(ABILITIES[ability].name) && t.includes('chroni'))).toBe(true);
    });
  }

  it('insomnia: także Odpoczynek nie usypia', () => {
    const d = duel(createRng(1), { moves: ['rest'], patch: { abilityId: 'insomnia' } }, { moves: ['splash'] });
    player(d.state).hp = 5;
    const r = resolveTurn(d.state, move(), seq(0.5));
    expect(player(r.state).status).toBeNull();
    expect(player(r.state).hp).toBe(5);
  });

  it('own-tempo: brak dezorientacji', () => {
    const run = (ab: string) => {
      const d = duel(createRng(1), { moves: ['splash'], patch: { abilityId: ab } }, { moves: ['confuse-ray'] });
      return resolveTurn(d.state, move(), seq(0.5));
    };
    const plain = run('test-ability');
    expect(plain.state.volatiles[player(plain.state).uid].confusion).toBeGreaterThan(0);
    const r = run('own-tempo');
    expect(r.state.volatiles[player(r.state).uid]?.confusion ?? 0).toBe(0);
    expect(texts(r.events).some((t) => t.includes('Własne tempo'))).toBe(true);
  });
});

describe('leczenie w warunku', () => {
  it('shed-skin: na koniec tury szansa 1/3 na wyleczenie statusu (kontrolowana losowość)', () => {
    const run = (v: number) => {
      const d = duel(createRng(1), { moves: ['splash'], patch: { abilityId: 'shed-skin', status: 'psn' } }, { moves: ['splash'] });
      return resolveTurn(d.state, move(), seq(v));
    };
    const cured = run(0.1);
    expect(player(cured.state).status).toBeNull();
    expect(player(cured.state).hp).toBe(player(cured.state).stats.hp); // wyleczone przed obrażeniami od trucizny
    expect(texts(cured.events).some((t) => t.includes('Zrzucanie skóry'))).toBe(true);
    const notCured = run(0.5);
    expect(player(notCured.state).status).toBe('psn');
    expect(player(notCured.state).hp).toBeLessThan(player(notCured.state).stats.hp);
  });

  it('water-absorb: ruch wodny leczy o 1/4 maks. PŻ zamiast zadawać obrażenia', () => {
    const d = duel(createRng(1), { moves: ['splash'], patch: { abilityId: 'water-absorb' } }, { moves: ['water-gun'] });
    const max = player(d.state).stats.hp;
    player(d.state).hp = 10;
    const r = resolveTurn(d.state, move(), seq(0.5));
    expect(player(r.state).hp).toBe(Math.min(max, 10 + Math.floor(max / 4)));
    expect(texts(r.events).some((t) => t.includes('Chłonięcie wody'))).toBe(true);
    // Bez zdolności — zwykłe obrażenia.
    const p = duel(createRng(1), { moves: ['splash'] }, { moves: ['water-gun'] });
    player(p.state).hp = 10;
    expect(player(resolveTurn(p.state, move(), seq(0.5)).state).hp).toBeLessThan(10);
  });
});

describe('pozostałe zdolności', () => {
  it('thick-fat: obrażenia od ruchów ognistych i lodowych o połowę mniejsze', () => {
    const { a, d } = pair('test-ability', 'thick-fat');
    const plainD = { ...d, abilityId: 'test-ability' };
    for (const m of ['ember', 'ice-shard']) expect(damage(a, d, MOVES[m])).toBe(Math.floor(damage(a, plainD, MOVES[m]) * 0.5));
    expect(damage(a, d, MOVES.tackle)).toBe(damage(a, plainD, MOVES.tackle));
  });

  it('run-away: ucieczka od szybszego dzikiego stworzenia zawsze się udaje', () => {
    const run = (ab: string) => {
      const d = duel(createRng(1), { moves: ['splash'], base: 20, patch: { abilityId: ab } }, { moves: ['splash'], base: 200 });
      return resolveTurn(d.state, { kind: 'run' }, seq(0.99));
    };
    expect(run('test-ability').state.outcome).toBeNull();
    const r = run('run-away');
    expect(r.state.outcome).toBe('fled');
    expect(texts(r.events).some((t) => t.includes('Ucieczka'))).toBe(true);
  });

  it('shield-dust: brak dodatkowych efektów ruchów przeciwnika (status, spadek statystyki, wzdrygnięcie)', () => {
    const run = (ab: string, enemyMove: string) => {
      const d = duel(createRng(1), { moves: ['tackle'], base: 40, patch: { abilityId: ab } }, { moves: [enemyMove], base: 120 });
      return resolveTurn(d.state, move(), seq(0.5));
    };
    expect(player(run('test-ability', 'burn-strike').state).status).toBe('brn');
    expect(player(run('shield-dust', 'burn-strike').state).status).toBeNull();
    const acidPlain = run('test-ability', 'acid-strike');
    expect(acidPlain.state.boosts[player(acidPlain.state).uid].spd).toBe(-1);
    const acid = run('shield-dust', 'acid-strike');
    expect(acid.state.boosts[player(acid.state).uid].spd).toBe(0);
    // Szybszy przeciwnik wzdryga gracza — z pyłkiem gracz i tak atakuje.
    const flinchPlain = run('test-ability', 'flinch-strike');
    expect(flinchPlain.events.some((e) => e.t === 'useMove' && e.side === 0)).toBe(false);
    const flinch = run('shield-dust', 'flinch-strike');
    expect(flinch.events.some((e) => e.t === 'useMove' && e.side === 0)).toBe(true);
  });

  it('early-bird: sen mija dwa razy szybciej', () => {
    const run = (ab: string) => {
      const d = duel(createRng(1), { moves: ['splash'], patch: { abilityId: ab, status: 'slp', sleepTurns: 2 } }, { moves: ['splash'] });
      return resolveTurn(d.state, move(), seq(0.5));
    };
    expect(player(run('test-ability').state).sleepTurns).toBe(1);
    expect(player(run('early-bird').state).sleepTurns).toBe(0);
  });

  it('zdolność spoza listy niczego nie zmienia (jeszcze nie działa)', () => {
    const { a, d } = pair('gluttony');
    const low = { ...a, hp: 1 };
    expect(damage(low, d, MOVES.tackle)).toBe(damage({ ...low, abilityId: 'test-ability' }, d, MOVES.tackle));
    expect(ABILITIES.gluttony).toBeUndefined();
  });
});
