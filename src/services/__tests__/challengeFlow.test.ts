// Przebieg Próby Szlaku (Sprint 6) w prawdziwym encounterService: centralna blokada, wejście bez wymagań,
// zwycięstwo (odznaka dokładnie raz, wydarzenie, odblokowanie przejścia, nagroda), przegrana bez nagrody,
// brak duplikacji przy powtórnej walce/rozmowie, zapis i ponowne wczytanie.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ODZNAKA_WIATRU_ID, PROBA_WIATRU_ID } from '../../config/challenges';
import { trainerActorId } from '../../config/trainers';
import { ZAGAJNIK_ID } from '../../config/world';
import { migrateSave } from '../../data/migrations';
import { chart, growthMedium, makeCreature, makeSpecies, moves } from '../../engine/__tests__/fixtures';
import type { BattleOutcome } from '../../engine/battle/types';
import { createRng } from '../../engine/rng';
import type { Creature, MoveData, PokemonData } from '../../engine/types';
import { challengeState, getChallenge } from '../../game/challenges';
import { bus, type BusEvents } from '../../game/eventBus';
import { releaseInput } from '../../game/input';
import { getTrainer, talkKind } from '../../game/trainers';
import { checkTravel, connectionAt, getLocation } from '../../game/world';
import { useBattle } from '../../state/battleStore';
import { useGame } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import type { CreatureBundle } from '../creatureService';
import { configureEncounterDeps, finishBattle, startWildEncounter } from '../encounterService';

const rng = createRng(23);
const hero = makeCreature(rng, 'flamy', ['fire'], 14, ['tackle', 'growl']);
const foes = [makeCreature(rng, 'birdy', ['normal'], 11, ['tackle']), makeCreature(rng, 'puffy', ['normal'], 11, ['tackle']), makeCreature(rng, 'hawky', ['normal'], 13, ['tackle'])];
const POKEMON: Record<string, PokemonData> = Object.fromEntries([hero, ...foes].map((m) => [m.pokemon.name, m.pokemon]));
const bundle = (m: ReturnType<typeof makeCreature>): CreatureBundle => ({ pokemon: m.pokemon, species: makeSpecies(m.pokemon.name), growth: growthMedium });

const PROBA = getChallenge(PROBA_WIATRU_ID)!;
const WERA = getTrainer(PROBA.leaderId)!;
const IGA_EVENT = 'trainer:zagajnik-iga:defeated';
const LOCKED_CONN = connectionAt(getLocation(ZAGAJNIK_ID)!, 13, 0)!;
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
      return foes.map((f) => ({ creature: structuredClone(f.creature), bundle: bundle(f) }));
    },
  });
  useGame.getState().resetGame();
  useGame.setState({ party: [structuredClone(hero.creature)], storage: [], started: true, bag: {} });
  useGame.setState((s) => ({ player: { ...s.player, money: 1000, locationId: 'wietrzna-straznica', x: 8, y: 8 } }));
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

const meetRequirements = () => useGame.getState().setFlag(IGA_EVENT);
const source = () => ({ kind: 'trainer' as const, actorId: trainerActorId(WERA.id), trainerId: WERA.id, rematch: false });

async function startLeader() {
  const id = useUi.getState().tryStartEncounter(trainerActorId(WERA.id), { explicit: true });
  expect(id).not.toBeNull();
  const ok = await startWildEncounter({ encounterId: id!, source: source() });
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
const progress = () => {
  const g = useGame.getState();
  return { earnedBadges: g.earnedBadges, completedChallenges: g.completedChallenges, unlockedConnections: g.unlockedConnections, done: !!g.flags[PROBA.completionEventId], money: g.player.money, herb: g.bag['herb-strong'] ?? 0 };
};

describe('wejście do Próby', () => {
  it('bez wymagań: walka z liderem nie startuje (błąd rozpoczęcia, blokada zwolniona, drużyna lidera nie jest budowana)', async () => {
    expect(challengeState(PROBA, useGame.getState())).toBe('LOCKED');
    const { ok } = await startLeader();
    expect(ok).toBe(false);
    expect(teamBuilds).toBe(0);
    expect(useBattle.getState().engine).toBeNull();
    expect(useUi.getState()).toMatchObject({ mode: 'overworld', gameMode: 'EXPLORATION', activeEncounterId: null, inputLocked: false });
    expect(useUi.getState().toast?.text).toContain('niedostępna');
    expect(progress()).toMatchObject({ earnedBadges: [], completedChallenges: [], unlockedConnections: [], done: false, money: 1000 });
  });

  it('z wymaganiami: walka w tym samym silniku (strona „trainer”, profil AGGRESSIVE, 3 stworzenia, bez ucieczki)', async () => {
    meetRequirements();
    const { ok, id } = await startLeader();
    expect(ok).toBe(true);
    const B = useBattle.getState();
    expect(B.engine?.sides[1]).toMatchObject({ kind: 'trainer', name: WERA.name, ai: 'AGGRESSIVE' });
    expect(B.engine?.sides[1].party).toHaveLength(3);
    expect(B.meta).toMatchObject({ encounterId: id, trainerId: WERA.id });
    expect(useUi.getState()).toMatchObject({ mode: 'battle', gameMode: 'BATTLE' });
  });

  it('podczas Próby inne interakcje są zablokowane (inny trener, losowe spotkanie), a walka startuje dokładnie raz', async () => {
    meetRequirements();
    const { id } = await startLeader();
    expect(useUi.getState().tryStartEncounter(trainerActorId('zagajnik-iga'), { explicit: true })).toBeNull();
    expect(useUi.getState().tryStartEncounter('static:test')).toBeNull();
    expect(await startWildEncounter({ encounterId: id, source: source() })).toBe(false);
    expect(teamBuilds).toBe(1);
  });
});

describe('wynik Próby', () => {
  it('zwycięstwo: ukończenie, wydarzenie zapisane, Odznaka Wiatru, otwarte przejście, nagroda i dialog lidera', async () => {
    meetRequirements();
    await startLeader();
    setOutcome('win');
    expect(await finishBattle()).toBe(true);
    expect(progress()).toEqual({
      earnedBadges: [ODZNAKA_WIATRU_ID],
      completedChallenges: [PROBA_WIATRU_ID],
      unlockedConnections: ['zagajnik-do-wzgorz'],
      done: true,
      money: 1000 + PROBA.optionalRewards.money,
      herb: 2,
    });
    const lines = useUi.getState().dialog?.lines.join(' ') ?? '';
    expect(lines).toContain('Zdobywasz odznakę: Odznaka Wiatru!');
    expect(lines).toContain('Otwiera się przejście: ścieżka z Szepczącego Zagajnika na Wzgórza Wiatru.');
    expect(lines).toContain(PROBA.dialogue.victory[0]);
    expect(useGame.getState().stats.battlesWon).toBe(1);
    // Przejście z Zagajnika na Wzgórza jest teraz otwarte; gracz zostaje w Strażnicy (bez przeniesienia).
    const g = useGame.getState();
    expect(checkTravel(LOCKED_CONN, g).ok).toBe(true);
    expect(travels).toHaveLength(0);
    expect(challengeState(PROBA, g)).toBe('COMPLETED');
    expect(talkKind(WERA, g.flags)).toBe('after');
  });

  it('przegrana: brak odznaki, ukończenia, odblokowania i nagrody; istniejący powrót do Stacji Opieki', async () => {
    meetRequirements();
    await startLeader();
    setOutcome('lose', (party) => party.forEach((c) => (c.hp = 0)));
    await finishBattle();
    const p = progress();
    expect(p).toMatchObject({ earnedBadges: [], completedChallenges: [], unlockedConnections: [], done: false, herb: 0 });
    expect(p.money).toBeLessThan(1000);
    expect(travels).toHaveLength(1);
    expect(travels[0]).toMatchObject({ spawnPointId: 'stacja-opieki' });
    expect(challengeState(PROBA, useGame.getState())).toBe('AVAILABLE'); // można spróbować ponownie
    expect(checkTravel(LOCKED_CONN, useGame.getState())).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('odznaka dokładnie raz: podwójne zakończenie, ponowna walka i ponowne wywołanie completeChallenge nic nie dodają', async () => {
    meetRequirements();
    await startLeader();
    setOutcome('win');
    await finishBattle();
    expect(await finishBattle()).toBe(false); // podwójne „Dalej”
    closeDialogs();
    const after = progress();
    // Powtórna walka z liderem po ukończeniu jest odrzucana przy rozpoczęciu.
    useUi.setState({ encounterCooldown: 0 });
    const again = await startLeader();
    expect(again.ok).toBe(false);
    expect(useGame.getState().completeChallenge(PROBA_WIATRU_ID)).toBeNull();
    expect(progress()).toEqual(after);
    expect(after.earnedBadges).toEqual([ODZNAKA_WIATRU_ID]);
    expect(after.money).toBe(1000 + PROBA.optionalRewards.money);
  });

  it('zapis i ponowne wczytanie: odznaka, ukończona Próba i otwarte przejście zostają; nagroda nie wraca', async () => {
    meetRequirements();
    await startLeader();
    setOutcome('win');
    await finishBattle();
    const before = progress();
    const saved = JSON.parse(JSON.stringify(useGame.getState().snapshot()));
    expect(saved).toMatchObject({ version: 4, earnedBadges: [ODZNAKA_WIATRU_ID], completedChallenges: [PROBA_WIATRU_ID], unlockedConnections: ['zagajnik-do-wzgorz'] });
    useGame.getState().resetGame();
    expect(useGame.getState().earnedBadges).toEqual([]);
    useGame.getState().loadData(migrateSave(saved));
    expect(progress()).toEqual(before);
    expect(challengeState(PROBA, useGame.getState())).toBe('COMPLETED');
    expect(checkTravel(LOCKED_CONN, useGame.getState()).ok).toBe(true);
    expect(useGame.getState().completeChallenge(PROBA_WIATRU_ID)).toBeNull();
    expect(progress()).toEqual(before);
  });
});
