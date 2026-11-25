// Przebieg specjalnego spotkania (Sprint 7) w prawdziwym encounterService: centralna blokada (inne spotkanie
// nie może się zacząć), złapanie, pokonanie, ucieczka i przegrana — zapis wyniku i ukończenia zgodnie z danymi
// spotkania; brak ponownego pojawienia po ukończeniu, także po zapisie i ponownym wczytaniu.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GROTA_ID } from '../../config/world';
import { migrateSave } from '../../data/migrations';
import { chart, growthMedium, makeCreature, makeSpecies, moves } from '../../engine/__tests__/fixtures';
import type { BattleOutcome } from '../../engine/battle/types';
import { createRng } from '../../engine/rng';
import type { Creature, MoveData, PokemonData } from '../../engine/types';
import { bus, type BusEvents } from '../../game/eventBus';
import { releaseInput } from '../../game/input';
import { activeSpecialEncounters, getSpecialEncounter } from '../../game/specialEncounters';
import { useBattle } from '../../state/battleStore';
import { SAVE_VERSION, useGame } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import type { WildSpawn } from '../creatureService';
import { configureEncounterDeps, finishBattle, startWildEncounter } from '../encounterService';

const rng = createRng(31);
const hero = makeCreature(rng, 'flamy', ['fire'], 18, ['tackle', 'growl']);
const foe = makeCreature(rng, 'shadey', ['dark'], 16, ['tackle']);
const POKEMON: Record<string, PokemonData> = { [hero.pokemon.name]: hero.pokemon, [foe.pokemon.name]: foe.pokemon };
const SPAWN: WildSpawn = { creature: foe.creature, pokemon: foe.pokemon, species: makeSpecies('shadey', 30), zoneId: GROTA_ID, zoneName: 'Grota Echa' };
const ABSOL = getSpecialEncounter('grota-absol')!;
const ACTOR = 'static:grota-absol';
let restore = () => undefined as void;
let offs: (() => void)[] = [];
let battleEnds: BusEvents['battle-end'][] = [];
let travels: BusEvents['travel'][] = [];

beforeEach(() => {
  restore = configureEncounterDeps({
    getPokemon: async (n) => POKEMON[n],
    getMove: async (n) => moves[n],
    getTypeChart: async () => chart,
    getGrowthTables: async (names) => Object.fromEntries(names.map((n) => [n, growthMedium])),
    loadMoves: async (names) => Object.fromEntries(names.filter((n) => moves[n]).map((n) => [n, moves[n]])) as Record<string, MoveData>,
    saveNow: async () => undefined,
    rng: createRng(3),
    now: () => 0,
    minTransitionMs: 0,
    collectEvolutions: async () => [],
  });
  useGame.getState().resetGame();
  useGame.setState({ party: [structuredClone(hero.creature)], storage: [], started: true, bag: {} });
  useGame.setState((s) => ({ player: { ...s.player, money: 1000, locationId: GROTA_ID, x: 7, y: 3 } }));
  useBattle.getState().clear();
  useUi.setState({
    mode: 'overworld', modal: null, dialog: null, toast: null, transition: false, learnQueue: [], evolutionQueue: [],
    gameMode: 'EXPLORATION', activeEncounterId: null, sourceEntityId: null, inputLocked: false,
    encounterCooldown: 0, encounterStepProgress: 0, encounterRollCount: 0, lastStepDecision: null, lastEncounter: null,
  });
  releaseInput('reset');
  battleEnds = [];
  travels = [];
  offs = [bus.on('battle-end', (p) => battleEnds.push(p)), bus.on('travel', (p) => travels.push(p))];
});
afterEach(() => {
  offs.forEach((o) => o());
  useBattle.getState().clear();
  restore();
});

async function startSpecial() {
  const id = useUi.getState().tryStartEncounter(ACTOR);
  expect(id).not.toBeNull();
  const ok = await startWildEncounter({ encounterId: id!, source: { kind: 'static', actorId: ACTOR, staticId: ABSOL.id, spawn: structuredClone(SPAWN) } });
  return { id: id!, ok };
}

function setOutcome(outcome: BattleOutcome) {
  const B = useBattle.getState();
  const engine = structuredClone(B.engine!);
  engine.outcome = outcome;
  if (outcome === 'win') engine.sides[1].party.forEach((c) => (c.hp = 0));
  if (outcome === 'caught') engine.caught = { ...engine.sides[1].party[0] } as Creature;
  if (outcome === 'lose') engine.sides[0].party.forEach((c) => (c.hp = 0));
  useBattle.setState({ engine });
}

const closeDialogs = () => {
  for (let i = 0; i < 20 && useUi.getState().dialog; i++) useUi.getState().advanceDialog();
};
const state = () => {
  const g = useGame.getState();
  return { record: g.specialEncounters[ABSOL.id] ?? null, done: !!g.flags[ABSOL.completionEventId], onMap: activeSpecialEncounters(GROTA_ID, g).map((s) => s.id) };
};

describe('rozpoczęcie specjalnego spotkania', () => {
  it('kontakt przejmuje centralną blokadę: walka z dzikim stworzeniem; inne spotkanie w tym czasie odrzucone; start raz', async () => {
    const { id, ok } = await startSpecial();
    expect(ok).toBe(true);
    expect(useBattle.getState().meta).toMatchObject({ encounterId: id, actorId: ACTOR, staticId: ABSOL.id });
    expect(useUi.getState()).toMatchObject({ mode: 'battle', gameMode: 'BATTLE', sourceEntityId: ACTOR });
    expect(useUi.getState().tryStartEncounter('static:gaj-straznik')).toBeNull();
    expect(useUi.getState().tryStartEncounter('trainer:zagajnik-iga', { explicit: true })).toBeNull();
    expect(await startWildEncounter({ encounterId: id, source: { kind: 'static', actorId: ACTOR, staticId: ABSOL.id, spawn: SPAWN } })).toBe(false);
  });
});

describe('wynik specjalnego spotkania', () => {
  it('złapanie: stworzenie w drużynie, wynik CAUGHT i ukończenie zapisane; nie wraca na mapę', async () => {
    await startSpecial();
    setOutcome('caught');
    expect(await finishBattle()).toBe(true);
    expect(state()).toMatchObject({ record: { result: 'CAUGHT', attempts: 1 }, done: true, onMap: [] });
    expect(useGame.getState().party).toHaveLength(2);
    expect(battleEnds).toHaveLength(1);
    expect(battleEnds[0]).toMatchObject({ actorId: ACTOR, outcome: 'caught' });
    expect(await finishBattle()).toBe(false); // podwójne „Dalej”
    expect(state().record?.attempts).toBe(1);
  });

  it('pokonanie: wynik DEFEATED i ukończenie zapisane; nie wraca na mapę', async () => {
    await startSpecial();
    setOutcome('win');
    await finishBattle();
    expect(state()).toMatchObject({ record: { result: 'DEFEATED', attempts: 1 }, done: true, onMap: [] });
    expect(state().record?.completedAt).not.toBeNull();
  });

  it('ucieczka (UNTIL_RESOLVED): wynik ESCAPED, bez ukończenia — spotkanie wraca po ponownym wejściu; potem pokonanie', async () => {
    await startSpecial();
    setOutcome('fled');
    await finishBattle();
    expect(state()).toEqual({ record: { result: 'ESCAPED', attempts: 1, completedAt: null }, done: false, onMap: ['grota-absol'] });
    closeDialogs();
    useUi.setState({ encounterCooldown: 0 });
    await startSpecial();
    setOutcome('win');
    await finishBattle();
    expect(state()).toMatchObject({ record: { result: 'DEFEATED', attempts: 2 }, done: true, onMap: [] });
  });

  it('przegrana gracza: wynik LOST, bez ukończenia, istniejący powrót do Stacji Opieki', async () => {
    await startSpecial();
    setOutcome('lose');
    await finishBattle();
    expect(state()).toMatchObject({ record: { result: 'LOST', attempts: 1, completedAt: null }, done: false });
    expect(travels).toHaveLength(1);
    expect(travels[0]).toMatchObject({ spawnPointId: 'stacja-opieki' });
  });

  it('zapis i ponowne wczytanie: ukończone spotkanie nie pojawia się ponownie; wynik zostaje w zapisie', async () => {
    await startSpecial();
    setOutcome('caught');
    await finishBattle();
    const saved = JSON.parse(JSON.stringify(useGame.getState().snapshot()));
    expect(saved).toMatchObject({ version: SAVE_VERSION, specialEncounters: { 'grota-absol': { result: 'CAUGHT', attempts: 1 } } });
    useGame.getState().resetGame();
    expect(activeSpecialEncounters(GROTA_ID, useGame.getState()).map((s) => s.id)).toEqual(['grota-absol']);
    useGame.getState().loadData(migrateSave(saved));
    expect(state()).toMatchObject({ record: { result: 'CAUGHT' }, done: true, onMap: [] });
    // Ponowny wynik (np. wymuszone zdarzenie) nie nadpisuje ukończonego spotkania.
    expect(useGame.getState().recordSpecialEncounter(ABSOL.id, 'fled')).toBeNull();
    expect(state().record?.result).toBe('CAUGHT');
  });
});
