// Przebieg walki z trenerem (Sprint 5): centralna blokada, dokładnie jedna walka, dwa wyzwalacze naraz,
// zwycięstwo (flaga, nagroda raz, dialog po walce), rewanż, przegrana (Stacja Opieki, bez flagi), zapis.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTrainer, talkKind } from '../../game/trainers';
import { trainerActorId } from '../../config/trainers';
import { migrateSave } from '../../data/migrations';
import { chart, growthMedium, makeCreature, makeSpecies, moves } from '../../engine/__tests__/fixtures';
import type { BattleOutcome } from '../../engine/battle/types';
import { createRng, createSequenceRng } from '../../engine/rng';
import type { Creature, MoveData, PokemonData } from '../../engine/types';
import { bus, type BusEvents } from '../../game/eventBus';
import { releaseInput } from '../../game/input';
import { useBattle } from '../../state/battleStore';
import { useGame } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import { configureEncounterDeps, finishBattle, startWildEncounter } from '../encounterService';
import type { CreatureBundle } from '../creatureService';

const rng = createRng(17);
const hero = makeCreature(rng, 'flamy', ['fire'], 12, ['tackle', 'growl']);
const foeA = makeCreature(rng, 'birdy', ['normal'], 4, ['tackle']);
const foeB = makeCreature(rng, 'ratty', ['normal'], 5, ['tackle']);
const POKEMON: Record<string, PokemonData> = { [hero.pokemon.name]: hero.pokemon, [foeA.pokemon.name]: foeA.pokemon, [foeB.pokemon.name]: foeB.pokemon };
const bundle = (m: ReturnType<typeof makeCreature>): CreatureBundle => ({ pokemon: m.pokemon, species: makeSpecies(m.pokemon.name), growth: growthMedium });

const BARTEK = getTrainer('polana-bartek')!;
const IGA = getTrainer('zagajnik-iga')!;
let teamBuilds = 0;
let restore = () => undefined as void;
let offs: (() => void)[] = [];
let travels: BusEvents['travel'][] = [];

beforeEach(() => {
  teamBuilds = 0;
  restore = configureEncounterDeps({
    getPokemon: async (n) => POKEMON[n],
    getMove: async (n) => moves[n],
    getTypeChart: async () => chart,
    getGrowthTables: async (names) => Object.fromEntries(names.map((n) => [n, growthMedium])),
    loadMoves: async (names) => Object.fromEntries(names.filter((n) => moves[n]).map((n) => [n, moves[n]])) as Record<string, MoveData>,
    saveNow: async () => undefined,
    rng: createRng(5),
    now: () => 0,
    minTransitionMs: 0,
    collectEvolutions: async () => [],
    buildTrainerTeam: async () => {
      teamBuilds += 1;
      return [
        { creature: structuredClone(foeA.creature), bundle: bundle(foeA) },
        { creature: structuredClone(foeB.creature), bundle: bundle(foeB) },
      ];
    },
  });
  useGame.getState().resetGame();
  useGame.setState({ party: [structuredClone(hero.creature)], storage: [], started: true, bag: {} });
  useGame.setState((s) => ({ player: { ...s.player, money: 1000 } }));
  useBattle.getState().clear();
  useUi.setState({
    mode: 'overworld', modal: null, dialog: null, toast: null, transition: false, learnQueue: [], evolutionQueue: [],
    gameMode: 'EXPLORATION', activeEncounterId: null, sourceEntityId: null, inputLocked: false,
    encounterCooldown: 0, encounterStepProgress: 0, encounterRollCount: 0, lastStepDecision: null, lastEncounter: null,
  });
  releaseInput('reset');
  travels = [];
  offs = [bus.on('travel', (p) => travels.push(p))];
});
afterEach(() => {
  offs.forEach((o) => o());
  useBattle.getState().clear();
  restore();
});

const source = (trainerId: string, rematch = false) => ({ kind: 'trainer' as const, actorId: trainerActorId(trainerId), trainerId, rematch });

async function startTrainer(trainerId = 'polana-bartek', rematch = false) {
  const id = useUi.getState().tryStartEncounter(trainerActorId(trainerId));
  expect(id).not.toBeNull();
  const ok = await startWildEncounter({ encounterId: id!, source: source(trainerId, rematch) });
  return { id: id!, ok };
}

function setOutcome(outcome: BattleOutcome, patch?: (party: Creature[]) => void) {
  const B = useBattle.getState();
  const engine = structuredClone(B.engine!);
  engine.outcome = outcome;
  if (outcome === 'win') engine.sides[1].party.forEach((c) => (c.hp = 0));
  patch?.(engine.sides[0].party);
  useBattle.setState({ engine });
}

const closeDialogs = () => {
  for (let i = 0; i < 20 && useUi.getState().dialog; i++) useUi.getState().advanceDialog();
};
const money = () => useGame.getState().player.money;

describe('rozpoczęcie walki z trenerem', () => {
  it('centralna blokada → walka z trenerem w tym samym silniku (strona „trainer”, drużyna 2 stworzeń)', async () => {
    const { ok, id } = await startTrainer();
    expect(ok).toBe(true);
    const B = useBattle.getState();
    expect(B.engine?.sides[1]).toMatchObject({ kind: 'trainer', name: BARTEK.name, ai: BARTEK.aiProfile });
    expect(B.engine?.sides[1].party).toHaveLength(2);
    expect(B.meta).toMatchObject({ encounterId: id, actorId: trainerActorId(BARTEK.id), trainerId: BARTEK.id, rematch: false });
    expect(useUi.getState()).toMatchObject({ mode: 'battle', gameMode: 'BATTLE' });
  });

  it('walka rozpoczyna się dokładnie raz (powtórzone zdarzenie jest ignorowane)', async () => {
    const { id } = await startTrainer();
    expect(await startWildEncounter({ encounterId: id, source: source('polana-bartek') })).toBe(false);
    expect(teamBuilds).toBe(1);
  });

  it('dwa wyzwalacze jednocześnie: drugi trener i losowe spotkanie są odrzucane, dopóki trwa pierwsza interakcja', () => {
    const first = useUi.getState().tryStartEncounter(trainerActorId('polana-bartek'));
    expect(first).not.toBeNull();
    expect(useUi.getState().tryStartEncounter(trainerActorId('zagajnik-iga'))).toBeNull();
    expect(useUi.getState().tryStartEncounter(trainerActorId('zagajnik-iga'), { explicit: true })).toBeNull();
    const step = useUi.getState().registerEncounterStep(
      { movedToNewTile: true, zone: { id: 'meadow', name: 'Łąka', locationId: 'polana-startowa', rect: { x: 0, y: 0, w: 1, h: 1 }, terrainType: 'TALL_GRASS', encounterTableId: 'meadow' } as never },
      createSequenceRng([0]),
    );
    expect(step.encounterId).toBeNull();
    expect(useUi.getState()).toMatchObject({ activeEncounterId: first, gameMode: 'ENCOUNTER_STARTING', inputLocked: true });
  });

  it('rozmowa (explicit) pomija tylko odnowienie po walce; wzrok i wydarzenie — nie', () => {
    useUi.setState({ encounterCooldown: 3 });
    expect(useUi.getState().tryStartEncounter(trainerActorId('polana-bartek'))).toBeNull();
    expect(useUi.getState().tryStartEncounter(trainerActorId('polana-bartek'), { explicit: true })).not.toBeNull();
  });
});

describe('po walce', () => {
  it('zwycięstwo: flaga w zapisie, nagroda dokładnie raz, dialog po walce; kolejne zakończenie nic nie daje', async () => {
    await startTrainer();
    setOutcome('win');
    expect(await finishBattle()).toBe(true);
    expect(useGame.getState().flags[BARTEK.defeatedEventId]).toBe(true);
    expect(money()).toBe(1000 + BARTEK.reward.money);
    expect(useGame.getState().bag.herb).toBe(1);
    const lines = useUi.getState().dialog?.lines.join(' ') ?? '';
    expect(lines).toContain(`Pokonujesz: ${BARTEK.name}`);
    expect(lines).toContain(BARTEK.dialogueAfter[0]);
    expect(await finishBattle()).toBe(false);
    expect(money()).toBe(1000 + BARTEK.reward.money);
    expect(useUi.getState().gameMode).toBe('EXPLORATION');
    expect(talkKind(BARTEK, useGame.getState().flags)).toBe('after');
  });

  it('nagroda tylko za pierwsze zwycięstwo — rewanż (REMATCH) nie daje drugiej', async () => {
    await startTrainer('zagajnik-iga');
    setOutcome('win');
    await finishBattle();
    closeDialogs();
    const afterFirst = money();
    expect(afterFirst).toBe(1000 + IGA.reward.money);
    expect(useGame.getState().bag['soothe-berry']).toBe(1);
    expect(talkKind(IGA, useGame.getState().flags)).toBe('rematch');
    useUi.setState({ encounterCooldown: 0 });
    await startTrainer('zagajnik-iga', true);
    setOutcome('win');
    await finishBattle();
    expect(money()).toBe(afterFirst);
    expect(useGame.getState().bag['soothe-berry']).toBe(1);
    expect(useUi.getState().dialog?.lines.join(' ')).toContain('rewanż');
  });

  it('przegrana: powrót do Stacji Opieki (istniejący system), trener NIE jest oznaczony, bez nagrody', async () => {
    await startTrainer();
    setOutcome('lose', (party) => party.forEach((c) => (c.hp = 0)));
    await finishBattle();
    expect(useGame.getState().flags[BARTEK.defeatedEventId]).toBeUndefined();
    expect(money()).toBeLessThan(1000);
    expect(useGame.getState().party.every((c) => c.hp === c.stats.hp)).toBe(true);
    expect(travels).toHaveLength(1);
    expect(travels[0]).toMatchObject({ spawnPointId: 'stacja-opieki' });
    expect(talkKind(BARTEK, useGame.getState().flags)).toBe('battle');
  });

  it('zapis pokonanego trenera przetrwa zapis i wczytanie gry', async () => {
    await startTrainer();
    setOutcome('win');
    await finishBattle();
    const saved = JSON.parse(JSON.stringify(useGame.getState().snapshot()));
    useGame.getState().resetGame();
    expect(useGame.getState().flags[BARTEK.defeatedEventId]).toBeUndefined();
    useGame.getState().loadData(migrateSave(saved));
    expect(useGame.getState().flags[BARTEK.defeatedEventId]).toBe(true);
    expect(talkKind(BARTEK, useGame.getState().flags)).toBe('after');
  });
});
