// Trenerzy na mapie (Sprint 5): dane, pole widzenia, podejście, wydarzenia, rozmowa i walidacja.

import { describe, expect, it } from 'vitest';
import { TRAINERS, type TrainerDef } from '../../config/trainers';
import { POLANA_ID, ZAGAJNIK_ID } from '../../config/world';
import { MAPS } from '../maps';
import { isWalkable } from '../movement';
import { approachPath, eventTriggerAt, getTrainer, seesPlayer, sightLine, talkKind, trainersIn, validateTrainers } from '../trainers';

const gridOf = (mapId: string) => MAPS[mapId].layout.map((r) => r.split(''));
const bartek = getTrainer('polana-bartek')!;
const iga = getTrainer('zagajnik-iga')!;
const clone = (): TrainerDef[] => structuredClone(TRAINERS) as TrainerDef[];
const codes = (list: TrainerDef[]) => validateTrainers(list).map((i) => i.code);

describe('dane trenerów', () => {
  it('co najmniej dwóch trenerów na istniejących mapach; dane bez błędów walidacji', () => {
    expect(validateTrainers()).toEqual([]);
    expect(trainersIn(POLANA_ID).map((t) => t.id)).toEqual(['polana-bartek']);
    expect(trainersIn(ZAGAJNIK_ID).map((t) => t.id)).toEqual(['zagajnik-iga']);
  });

  it('pełny model trenera i członka drużyny', () => {
    for (const t of TRAINERS) {
      for (const k of ['id', 'name', 'locationId', 'position', 'direction', 'sightRange', 'dialogueBefore', 'dialogueAfter', 'team', 'aiProfile', 'reward', 'defeatedEventId', 'repeatPolicy']) {
        expect(k in t).toBe(true);
      }
      for (const m of t.team) for (const k of ['pokemonId', 'level', 'moves', 'nature', 'abilityId']) expect(k in m).toBe(true);
    }
    expect(new Set(TRAINERS.map((t) => t.aiProfile)).size).toBeGreaterThan(1);
  });
});

describe('pole widzenia', () => {
  const open = (grid: string[][]) => (x: number, y: number) => isWalkable(grid, x, y);

  it('Bartek patrzy w dół na 3 pola: widzi gracza na ścieżce, dalej już nie', () => {
    const g = gridOf('polana');
    const from = bartek.position;
    expect(sightLine(from, 'down', 3, open(g))).toEqual([{ x: 24, y: 14 }, { x: 24, y: 15 }, { x: 24, y: 16 }]);
    expect(seesPlayer(from, 'down', 3, { x: 24, y: 16 }, open(g))).toBe(3);
    expect(seesPlayer(from, 'down', 3, { x: 24, y: 14 }, open(g))).toBe(1);
    expect(seesPlayer(from, 'down', 3, { x: 24, y: 17 }, open(g))).toBeNull();
    expect(seesPlayer(from, 'down', 3, { x: 25, y: 15 }, open(g))).toBeNull(); // obok linii
    expect(seesPlayer(from, 'up', 3, { x: 24, y: 15 }, open(g))).toBeNull(); // patrzy w drugą stronę
  });

  it('przeszkoda albo inna postać zasłania widok', () => {
    const g = ['.....', '..T..', '.....'].map((r) => r.split(''));
    expect(seesPlayer({ x: 0, y: 1 }, 'right', 4, { x: 3, y: 1 }, (x, y) => isWalkable(g, x, y))).toBeNull();
    const occupied = (x: number, y: number) => isWalkable(g, x, y) && !(x === 1 && y === 0);
    expect(seesPlayer({ x: 0, y: 0 }, 'right', 4, { x: 3, y: 0 }, occupied)).toBeNull();
    expect(seesPlayer({ x: 0, y: 0 }, 'right', 4, { x: 3, y: 0 }, (x, y) => isWalkable(g, x, y))).toBe(3);
  });
});

describe('podejście trenera i wydarzenia', () => {
  const g = gridOf('zagajnik');
  const free = (x: number, y: number) => isWalkable(g, x, y);

  it('Iga podchodzi najkrótszą ścieżką na pole obok gracza; obok — bez ruchu', () => {
    expect(approachPath(iga.position, { x: 14, y: 12 }, free)).toEqual([{ x: 16, y: 12 }, { x: 15, y: 12 }]);
    expect(approachPath(iga.position, { x: 16, y: 12 }, free)).toEqual([]);
  });

  it('omija zajęte pole (np. towarzysza); bez bezpiecznej ścieżki — null (dialog z miejsca)', () => {
    const blocked = (x: number, y: number) => free(x, y) && !(x === 15 && y === 12);
    const p = approachPath(iga.position, { x: 14, y: 12 }, blocked)!;
    expect(p.some((s) => s.x === 15 && s.y === 12)).toBe(false);
    expect(Math.abs(p[p.length - 1].x - 14) + Math.abs(p[p.length - 1].y - 12)).toBe(1);
    expect(approachPath(iga.position, { x: 14, y: 12 }, () => false)).toBeNull();
    expect(approachPath({ x: 0, y: 0 }, { x: 20, y: 20 }, () => true, 8)).toBeNull(); // za daleko
  });

  it('pole wydarzenia wyzwala tylko niepokonanego trenera', () => {
    expect(eventTriggerAt([bartek, iga], 14, 9, {})?.id).toBe('zagajnik-iga');
    expect(eventTriggerAt([bartek, iga], 14, 9, { [iga.defeatedEventId]: true })).toBeNull();
    expect(eventTriggerAt([bartek, iga], 14, 10, {})).toBeNull();
  });

  it('rozmowa: walka przed pokonaniem; potem dialog (ONCE) albo rewanż (REMATCH)', () => {
    expect(talkKind(bartek, {})).toBe('battle');
    expect(talkKind(bartek, { [bartek.defeatedEventId]: true })).toBe('after');
    expect(talkKind(iga, { [iga.defeatedEventId]: true })).toBe('rematch');
  });
});

describe('walidacja błędnych danych trenerów', () => {
  it('duplikaty, przeszkoda, wyjście, nieznana lokacja, pusta drużyna, zły profil AI, zły przedmiot, złe pole wydarzenia', () => {
    const dup = clone();
    dup.push({ ...dup[0], position: { x: 20, y: 13 } });
    expect(codes(dup)).toContain('DUPLICATE_ID');
    expect(codes(dup)).toContain('DUPLICATE_EVENT');

    const wall = clone();
    wall[0].position = { x: 0, y: 0 };
    expect(codes(wall)).toContain('INVALID_POSITION');
    const exit = clone();
    exit[0].position = { x: 39, y: 14 };
    expect(codes(exit)).toContain('INVALID_POSITION');

    const loc = clone();
    loc[0].locationId = 'nie-ma';
    expect(codes(loc)).toContain('MISSING_LOCATION');

    const team = clone();
    team[0].team = [];
    expect(codes(team)).toContain('EMPTY_TEAM');

    const ai = clone();
    (ai[0] as { aiProfile: string }).aiProfile = 'GENIUS';
    expect(codes(ai)).toContain('INVALID_VALUE');

    const item = clone();
    item[1].team[0].heldItemId = 'herb' as never;
    expect(codes(item)).toContain('INVALID_MEMBER');
    const lvl = clone();
    lvl[1].team[0].level = 0;
    expect(codes(lvl)).toContain('INVALID_MEMBER');

    const evt = clone();
    evt[1].eventTriggers = [{ kind: 'tile', x: 0, y: 9 }]; // wyjście z Zagajnika
    expect(codes(evt)).toContain('INVALID_TRIGGER');
  });
});
