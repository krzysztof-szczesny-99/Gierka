// Przedmioty trzymane (Sprint 4): każdy rodzaj działania w walce + zasady zakładania i zdejmowania.

import { beforeEach, describe, expect, it } from 'vitest';
import { HELD_ITEM_IDS, ITEMS } from '../../config/items';
import { useGame } from '../../state/gameStore';
import { getActive, resolveTurn } from '../battle/battleEngine';
import { calcDamage } from '../battle/damage';
import { EMPTY_BOOSTS, type BattleState } from '../battle/types';
import { createRng, createSequenceRng } from '../rng';
import type { Creature, MoveData } from '../types';
import { duel, MOVES, texts } from './battleKit';
import { chart, makeCreature } from './fixtures';

const seq = (v: number) => createSequenceRng([v]);
const player = (s: BattleState) => getActive(s, 0)!;
const move = (i = 0) => ({ kind: 'move' as const, moveIndex: i });

function damage(attacker: Creature, defender: Creature, m: MoveData): number {
  return calcDamage({ attacker, defender, attackerBoosts: { ...EMPTY_BOOSTS }, defenderBoosts: { ...EMPTY_BOOSTS }, move: m, chart, rng: createRng(1), forceCrit: false, forceRandom: 100 }).damage;
}
function pair() {
  const rng = createRng(5);
  return { a: makeCreature(rng, 'a', ['normal'], 40, [], 80).creature, d: makeCreature(rng, 'd', ['normal'], 40, [], 80).creature };
}

describe('lista przedmiotów trzymanych', () => {
  it('10 przedmiotów trzymanych, każdy z działaniem i ceną w Kramie', () => {
    expect(HELD_ITEM_IDS).toHaveLength(10);
    for (const id of HELD_ITEM_IDS) {
      expect(ITEMS[id].kind).toBe('held');
      expect(ITEMS[id].held).toBeDefined();
      expect(ITEMS[id].price).toBeGreaterThan(0);
      expect(ITEMS[id].usableInBattle).toBe(false);
    }
  });
});

describe('modyfikacja obrażeń', () => {
  const typeCases: [string, string][] = [
    ['ember-coal', 'ember'],
    ['spring-drop', 'water-gun'],
    ['wonder-seed', 'vine-whip'],
  ];
  for (const [item, moveName] of typeCases) {
    it(`${item}: ${moveName} ×1,2, inne typy bez zmian`, () => {
      const { a, d } = pair();
      const holder = { ...a, heldItemId: item };
      expect(damage(holder, d, MOVES[moveName])).toBe(Math.floor(damage(a, d, MOVES[moveName]) * 1.2));
      expect(damage(holder, d, MOVES.tackle)).toBe(damage(a, d, MOVES.tackle));
    });
  }

  it('power-band: ruchy fizyczne ×1,1; sage-glasses: ruchy specjalne ×1,1', () => {
    const { a, d } = pair();
    const band = { ...a, heldItemId: 'power-band' };
    const glasses = { ...a, heldItemId: 'sage-glasses' };
    expect(damage(band, d, MOVES.tackle)).toBe(Math.floor(damage(a, d, MOVES.tackle) * 1.1));
    expect(damage(band, d, MOVES['water-gun'])).toBe(damage(a, d, MOVES['water-gun']));
    expect(damage(glasses, d, MOVES['water-gun'])).toBe(Math.floor(damage(a, d, MOVES['water-gun']) * 1.1));
    expect(damage(glasses, d, MOVES.tackle)).toBe(damage(a, d, MOVES.tackle));
  });
});

describe('leczenie', () => {
  it('trail-leftovers: na koniec tury +1/16 maks. PŻ', () => {
    const d = duel(createRng(1), { moves: ['splash'], patch: { heldItemId: 'trail-leftovers' } }, { moves: ['splash'] });
    const max = player(d.state).stats.hp;
    player(d.state).hp = 10;
    const r = resolveTurn(d.state, move(), seq(0.5));
    expect(player(r.state).hp).toBe(10 + Math.max(1, Math.floor(max / 16)));
    expect(player(r.state).heldItemId).toBe('trail-leftovers'); // nie znika
    expect(texts(r.events).some((t) => t.includes('Resztki prowiantu'))).toBe(true);
  });

  it('soothe-berry: po spadku PŻ do połowy +10 PŻ, jagoda znika; powyżej połowy nie działa', () => {
    const d = duel(createRng(1), { moves: ['splash'], patch: { heldItemId: 'soothe-berry' } }, { moves: ['tackle'] });
    const max = player(d.state).stats.hp;
    player(d.state).hp = Math.floor(max / 2) + 1; // każdy cios zbije do połowy
    const r = resolveTurn(d.state, move(), seq(0.5));
    const hpEvents = r.events.filter((e) => e.t === 'hp' && e.side === 0);
    expect(hpEvents.some((e) => e.t === 'hp' && e.delta > 0 && e.delta <= 10)).toBe(true);
    expect(player(r.state).heldItemId).toBeNull();
    expect(texts(r.events).some((t) => t.includes('Jagoda kojąca'))).toBe(true);

    const full = duel(createRng(1), { moves: ['splash'], level: 60, patch: { heldItemId: 'soothe-berry' } }, { moves: ['tackle'], level: 5 });
    const r2 = resolveTurn(full.state, move(), seq(0.5));
    expect(player(r2.state).heldItemId).toBe('soothe-berry');
  });
});

describe('modyfikacja prędkości', () => {
  it('swift-claw: przy trafieniu szansy (20%) wolniejszy właściciel atakuje pierwszy', () => {
    const run = (v: number) => {
      const d = duel(createRng(1), { moves: ['tackle'], base: 30, patch: { heldItemId: 'swift-claw' } }, { moves: ['tackle'], base: 150 });
      return resolveTurn(d.state, move(), seq(v));
    };
    const firstSide = (r: ReturnType<typeof run>) => (r.events.find((e) => e.t === 'useMove') as { side: number } | undefined)?.side;
    const lucky = run(0.1);
    expect(firstSide(lucky)).toBe(0);
    expect(texts(lucky.events).some((t) => t.includes('Bystry pazur'))).toBe(true);
    expect(firstSide(run(0.5))).toBe(1);
  });

  it('training-weight: szybkość ×0,5 (zmienia kolejność) i podwójne punkty wysiłku', () => {
    const order = (item: string | null) => {
      const d = duel(createRng(1), { moves: ['tackle'], patch: { heldItemId: item } }, { moves: ['tackle'] });
      player(d.state).stats = { ...player(d.state).stats, spe: 100 };
      getActive(d.state, 1)!.stats = { ...getActive(d.state, 1)!.stats, spe: 80 };
      return resolveTurn(d.state, move(), seq(0.5));
    };
    const firstSide = (r: ReturnType<typeof order>) => (r.events.find((e) => e.t === 'useMove') as { side: number }).side;
    expect(firstSide(order(null))).toBe(0);
    expect(firstSide(order('training-weight'))).toBe(1);

    const evGain = (item: string | null) => {
      const d = duel(createRng(1), { moves: ['tackle'], level: 40, patch: { heldItemId: item } }, { moves: ['splash'], level: 3 });
      getActive(d.state, 1)!.hp = 1;
      const r = resolveTurn(d.state, move(), seq(0.5));
      expect(r.state.outcome).toBe('win');
      return player(r.state).evs.atk;
    };
    expect(evGain(null)).toBe(1);
    expect(evGain('training-weight')).toBe(2);
  });
});

describe('ochrona przed statusem', () => {
  it('order-berry: nałożony status i dezorientacja znikają od razu; jagoda jest jednorazowa', () => {
    const d = duel(createRng(1), { moves: ['splash'], patch: { heldItemId: 'order-berry' } }, { moves: ['thunder-wave'] });
    const r = resolveTurn(d.state, move(), seq(0.5));
    expect(player(r.state).status).toBeNull();
    expect(player(r.state).heldItemId).toBeNull();
    expect(texts(r.events).some((t) => t.includes('Jagoda ładu'))).toBe(true);
    // Druga tura — jagody już nie ma, status zostaje.
    const r2 = resolveTurn(r.state, move(), seq(0.5));
    expect(player(r2.state).status).toBe('par');

    const c = duel(createRng(1), { moves: ['splash'], patch: { heldItemId: 'order-berry' } }, { moves: ['confuse-ray'] });
    const rc = resolveTurn(c.state, move(), seq(0.5));
    expect(rc.state.volatiles[player(rc.state).uid].confusion).toBe(0);
    expect(player(rc.state).heldItemId).toBeNull();
  });
});

describe('zakładanie i zdejmowanie (torba ↔ stworzenie)', () => {
  const rng = createRng(9);
  const a = makeCreature(rng, 'a', ['normal'], 10, ['tackle']).creature;
  const b = makeCreature(rng, 'b', ['normal'], 10, ['tackle']).creature;

  beforeEach(() => {
    useGame.getState().resetGame();
    useGame.setState({ party: [structuredClone(a), structuredClone(b)], storage: [], bag: { 'trail-leftovers': 1, 'swift-claw': 1, herb: 2 }, started: true });
  });
  const g = () => useGame.getState();
  const held = (uid: string) => g().party.find((c) => c.uid === uid)!.heldItemId;

  it('założenie zabiera sztukę z torby; tej samej sztuki nie da się dać drugiemu stworzeniu', () => {
    expect(g().equipItem(a.uid, 'trail-leftovers')).toBeNull();
    expect(held(a.uid)).toBe('trail-leftovers');
    expect(g().bag['trail-leftovers']).toBe(0);
    expect(g().equipItem(b.uid, 'trail-leftovers')).toContain('Nie masz');
    expect(held(b.uid)).toBeNull();
  });

  it('zamiana przedmiotu oddaje poprzedni do torby; zdjęcie zwraca przedmiot', () => {
    g().equipItem(a.uid, 'trail-leftovers');
    expect(g().equipItem(a.uid, 'swift-claw')).toBeNull();
    expect(held(a.uid)).toBe('swift-claw');
    expect(g().bag['trail-leftovers']).toBe(1);
    expect(g().bag['swift-claw']).toBe(0);
    expect(g().unequipItem(a.uid)).toBe(true);
    expect(held(a.uid)).toBeNull();
    expect(g().bag['swift-claw']).toBe(1);
    expect(g().unequipItem(a.uid)).toBe(false);
  });

  it('przedmiotów innego rodzaju nie można trzymać', () => {
    expect(g().equipItem(a.uid, 'herb')).toContain('nie można');
    expect(g().bag.herb).toBe(2);
    expect(held(a.uid)).toBeNull();
  });
});
