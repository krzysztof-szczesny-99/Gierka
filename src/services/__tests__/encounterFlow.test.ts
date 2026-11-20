// Testy regresji centralnego przepływu spotkania: start → walka → wynik → powrót do eksploracji.
// Dane, zapis, losowość i czas są wstrzyknięte (configureEncounterDeps) — bez sieci i IndexedDB.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENCOUNTER_CONFIG, staticDoneFlag } from '../../config/encounters';
import { chart, growthMedium, makeCreature, makeSpecies, moves } from '../../engine/__tests__/fixtures';
import type { BattleOutcome } from '../../engine/battle/types';
import { createRng, createSequenceRng } from '../../engine/rng';
import type { Creature, MoveData, PokemonData } from '../../engine/types';
import { bus, type BusEvents, type EncounterSource } from '../../game/eventBus';
import { joystick, joystickDown, releaseInput, virtualInput } from '../../game/input';
import { POLANA_ID } from '../../config/world';
import { TEST_MAP } from '../../game/maps/testMap';
import { getLocation, spawnPointOf } from '../../game/world';
import { useBattle } from '../../state/battleStore';
import { useGame } from '../../state/gameStore';
import { isOverworldBlocked, useUi, type EvolutionRequest } from '../../state/uiStore';
import type { WildSpawn } from '../creatureService';
import { cancelEncounter, configureEncounterDeps, finishBattle, startWildEncounter } from '../encounterService';
import type { StepEncounterSource } from '../../game/eventBus';

const rng = createRng(7);
const hero = makeCreature(rng, 'flamy', ['fire'], 12, ['tackle', 'growl']);
const wild = makeCreature(rng, 'leafy', ['grass'], 5, ['tackle']);
const POKEMON: Record<string, PokemonData> = { [hero.pokemon.name]: hero.pokemon, [wild.pokemon.name]: wild.pokemon };
const SPAWN: WildSpawn = {
  creature: wild.creature,
  pokemon: wild.pokemon,
  species: makeSpecies('leafy', 255),
  zoneId: 'meadow',
  zoneName: 'Łąka',
};
/** Źródło: widoczne stworzenie specjalne (kontakt) — jak na mapie. */
const staticSource = (actorId: string, staticId = 'test-static'): EncounterSource => ({ kind: 'static', actorId, staticId, spawn: SPAWN });

let now = 10_000;
let saves = 0;
let moveDelayMs = 0;
let failTypeChart = false;
let restoreDeps: () => void = () => undefined;
let battleEnds: BusEvents['battle-end'][] = [];
let travels: BusEvents['travel'][] = [];
let offs: (() => void)[] = [];
let evolutionCalls: { party: string[]; leveled: string[] }[] = [];
let evolutionAnswer: (leveled: string[]) => EvolutionRequest[] = () => [];

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  now = 10_000;
  saves = 0;
  evolutionCalls = [];
  evolutionAnswer = () => [];
  moveDelayMs = 0;
  failTypeChart = false;
  restoreDeps = configureEncounterDeps({
    getPokemon: async (name) => {
      const p = POKEMON[name];
      if (!p) throw new Error(`brak danych ${name}`);
      return p;
    },
    getMove: async (name) => {
      if (moveDelayMs) await delay(moveDelayMs);
      const m = moves[name];
      if (!m) throw new Error(`brak ruchu ${name}`);
      return m;
    },
    getTypeChart: async () => {
      if (failTypeChart) throw new Error('Nie udało się pobrać danych (test).');
      return chart;
    },
    getGrowthTables: async (names) => Object.fromEntries(names.map((n) => [n, growthMedium])),
    loadMoves: async (names) => {
      const out: Record<string, MoveData> = {};
      for (const n of names) if (moves[n]) out[n] = moves[n];
      return out;
    },
    saveNow: async () => {
      saves += 1;
    },
    rng: createRng(123),
    now: () => now,
    minTransitionMs: 0,
    collectEvolutions: async (party, leveled) => {
      evolutionCalls.push({ party: party.map((c) => c.uid), leveled: [...leveled] });
      return evolutionAnswer(leveled);
    },
  });

  useGame.getState().resetGame();
  useGame.setState({ party: [structuredClone(hero.creature)], storage: [], started: true });
  useBattle.getState().clear();
  useUi.setState({
    mode: 'overworld',
    modal: null,
    dialog: null,
    toast: null,
    transition: false,
    learnQueue: [],
    evolutionQueue: [],
    gameMode: 'EXPLORATION',
    activeEncounterId: null,
    sourceEntityId: null,
    inputLocked: false,
    encounterCooldown: 0,
    encounterStepProgress: 0,
    encounterRollCount: 0,
    lastStepDecision: null,
    lastEncounter: null,
  });
  releaseInput('reset');
  battleEnds = [];
  travels = [];
  offs = [bus.on('battle-end', (p) => battleEnds.push(p)), bus.on('travel', (p) => travels.push(p))];
});

afterEach(() => {
  offs.forEach((off) => off());
  useBattle.getState().clear();
  restoreDeps();
});

/** Kontakt ze stworzeniem: centralna blokada + inicjalizacja walki (jak po zdarzeniu „encounter” z mapy). */
async function startBattle(source = 'wild-1'): Promise<string> {
  const id = useUi.getState().tryStartEncounter(source);
  expect(id).not.toBeNull();
  const ok = await startWildEncounter({ encounterId: id!, source: staticSource(source) });
  expect(ok).toBe(true);
  return id!;
}

/** Ustawia wynik walki w silniku (jak po ostatniej turze). */
function setOutcome(outcome: BattleOutcome, patch: (party: Creature[]) => void = () => undefined) {
  const b = useBattle.getState();
  const engine = structuredClone(b.engine!);
  engine.outcome = outcome;
  patch(engine.sides[0].party);
  if (outcome === 'caught') engine.caught = { ...structuredClone(engine.sides[1].party[0]), uid: 'caught-1' };
  useBattle.setState({ engine, phase: 'ended' });
}

function expectBackToExploration(id: string, outcome: string) {
  const u = useUi.getState();
  expect(u.gameMode).toBe('EXPLORATION');
  expect(u.activeEncounterId).toBeNull();
  expect(u.sourceEntityId).toBeNull();
  expect(u.inputLocked).toBe(false);
  expect(u.mode).toBe('overworld');
  expect(u.transition).toBe(false);
  expect(u.encounterCooldown).toBe(ENCOUNTER_CONFIG.cooldownSteps);
  expect(u.lastEncounter?.id).toBe(id);
  expect(u.lastEncounter?.outcome).toBe(outcome);
  expect(useBattle.getState().engine).toBeNull();
  expect(battleEnds).toHaveLength(1);
  expect(battleEnds[0]).toEqual({ encounterId: id, actorId: 'wild-1', outcome });
}

function closeDialogs() {
  for (let i = 0; i < 20 && useUi.getState().dialog; i++) useUi.getState().advanceDialog();
}

describe('rozpoczęcie spotkania', () => {
  it('inicjalizacja: ENCOUNTER_STARTING → BATTLE, walka w Reakcie, wejście zablokowane', async () => {
    const id = await startBattle();
    const u = useUi.getState();
    expect(u.gameMode).toBe('BATTLE');
    expect(u.mode).toBe('battle');
    expect(u.inputLocked).toBe(true);
    expect(u.transition).toBe(false);
    expect(useBattle.getState().meta.encounterId).toBe(id);
    expect(useBattle.getState().meta.actorId).toBe('wild-1');
    expect(useGame.getState().stats.encounters).toBe(1);
    expect(isOverworldBlocked()).toBe(true);
  });

  it('zdarzenie bez przejętej blokady (obce lub powtórzone) jest ignorowane', async () => {
    const ok = await startWildEncounter({ encounterId: 'enc-obce', source: staticSource('wild-9') });
    expect(ok).toBe(false);
    expect(useUi.getState().gameMode).toBe('EXPLORATION');
    expect(battleEnds).toHaveLength(0);
    expect(useBattle.getState().engine).toBeNull();
  });

  it('drugie spotkanie w trakcie pierwszego: brak blokady, obce zdarzenie nie przerywa trwającego', async () => {
    const id = await startBattle('wild-1');
    expect(useUi.getState().tryStartEncounter('wild-2')).toBeNull();
    const ok = await startWildEncounter({ encounterId: 'enc-obce', source: staticSource('wild-2') });
    expect(ok).toBe(false);
    expect(useUi.getState().activeEncounterId).toBe(id);
    expect(useUi.getState().gameMode).toBe('BATTLE');
    expect(battleEnds).toHaveLength(0);
  });

  it('błąd inicjalizacji: komunikat, spotkanie anulowane raz, powrót do eksploracji', async () => {
    failTypeChart = true;
    const id = useUi.getState().tryStartEncounter('wild-1')!;
    const ok = await startWildEncounter({ encounterId: id, source: staticSource('wild-1') });
    expect(ok).toBe(false);
    expectBackToExploration(id, 'cancel');
    expect(useUi.getState().lastEncounter?.reason).toBe('init-error');
    expect(useUi.getState().toast?.text).toContain('Nie udało się');
    expect(useGame.getState().stats.encounters).toBe(0);
  });

  it('wyczerpana drużyna: błąd rozpoczęcia obsłużony centralnie', async () => {
    useGame.setState((s) => ({ party: s.party.map((c) => ({ ...c, hp: 0 })) }));
    const id = useUi.getState().tryStartEncounter('wild-1')!;
    expect(await startWildEncounter({ encounterId: id, source: staticSource('wild-1') })).toBe(false);
    expectBackToExploration(id, 'cancel');
  });
});

describe('zakończenie spotkania — każdy wynik przetwarzany dokładnie raz', () => {
  it('zwycięstwo: licznik i nagroda raz, nawet przy podwójnym „Dalej”', async () => {
    const id = await startBattle();
    const before = useGame.getState();
    setOutcome('win');
    const results = await Promise.all([finishBattle(), finishBattle()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const after = useGame.getState();
    expect(after.stats.battlesWon).toBe(before.stats.battlesWon + 1);
    expect(after.player.money).toBeGreaterThan(before.player.money);
    expect(saves).toBe(1);
    expectBackToExploration(id, 'win');
    expect(await finishBattle()).toBe(false);
  });

  it('zwycięstwo z nauką ruchu (wolne pobieranie danych): podwójne „Dalej” nie dubluje nagród ani ruchu', async () => {
    moveDelayMs = 30;
    const id = await startBattle();
    const before = useGame.getState();
    const lead = before.party[0];
    const engine = structuredClone(useBattle.getState().engine!);
    engine.pendingLearns = [{ uid: lead.uid, move: 'ember' }];
    useBattle.setState({ engine });
    setOutcome('win');
    const first = finishBattle();
    // Drugie dotknięcie, gdy pierwsze czeka na dane ruchu.
    await delay(5);
    expect(useUi.getState().gameMode).toBe('ENCOUNTER_ENDING');
    expect(await finishBattle()).toBe(false);
    expect(await first).toBe(true);
    const after = useGame.getState();
    expect(after.stats.battlesWon).toBe(before.stats.battlesWon + 1);
    expect(after.party[0].moves.filter((m) => m.name === 'ember')).toHaveLength(1);
    expectBackToExploration(id, 'win');
  });

  it('złapanie: stworzenie dodane raz, Atlas i licznik zaktualizowane', async () => {
    const id = await startBattle();
    setOutcome('caught');
    const results = await Promise.all([finishBattle(), finishBattle(), finishBattle()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const g = useGame.getState();
    expect(g.party).toHaveLength(2);
    expect(g.party.filter((c) => c.uid === 'caught-1')).toHaveLength(1);
    expect(g.stats.caught).toBe(1);
    expect(Object.values(g.dex).some((d) => d.caught)).toBe(true);
    expectBackToExploration(id, 'caught');
  });

  it('ucieczka: licznik raz, bez nagrody', async () => {
    const id = await startBattle();
    const money = useGame.getState().player.money;
    setOutcome('fled');
    expect(await finishBattle()).toBe(true);
    expect(await finishBattle()).toBe(false);
    expect(useGame.getState().stats.fled).toBe(1);
    expect(useGame.getState().player.money).toBe(money);
    expectBackToExploration(id, 'fled');
  });

  it('przegrana: leczenie, utrata żetonów i powrót do Stacji Opieki — raz', async () => {
    const id = await startBattle();
    useGame.setState((s) => ({ player: { ...s.player, x: 20, y: 20, money: 1000 } }));
    setOutcome('lose', (party) => party.forEach((c) => (c.hp = 0)));
    const results = await Promise.all([finishBattle(), finishBattle()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const g = useGame.getState();
    expect(g.stats.blackouts).toBe(1);
    expect(g.player.money).toBe(900);
    expect(g.party.every((c) => c.hp === c.stats.hp)).toBe(true);
    const heal = spawnPointOf(getLocation(POLANA_ID)!, 'stacja-opieki')!;
    expect([g.player.x, g.player.y]).toEqual([heal.x, heal.y]);
    expect(g.player.locationId).toBe(POLANA_ID);
    expect(travels).toHaveLength(1);
    expect(travels[0]).toMatchObject({ locationId: POLANA_ID, spawnPointId: 'stacja-opieki', x: heal.x, y: heal.y });
    expectBackToExploration(id, 'lose');
  });

  it('zamknięcie interfejsu walki: anulowanie bez wyniku, drużyna i liczniki bez zmian', async () => {
    const id = await startBattle();
    const before = useGame.getState();
    expect(cancelEncounter(id, 'ui-closed')).toBe(true);
    expect(cancelEncounter(id, 'ui-closed')).toBe(false);
    expect(await finishBattle()).toBe(false);
    const after = useGame.getState();
    expect(after.stats).toEqual(before.stats);
    expect(after.party).toEqual(before.party);
    expect(after.player.money).toBe(before.player.money);
    expectBackToExploration(id, 'cancel');
    expect(useUi.getState().lastEncounter?.reason).toBe('ui-closed');
  });
});

describe('powrót do eksploracji', () => {
  it('sterowanie wraca po dialogu, joystick jest wyzerowany, odnowienie mija', async () => {
    joystickDown(1, 40, 0); // palec trzymany w chwili kontaktu
    const id = useUi.getState().tryStartEncounter('wild-1')!;
    releaseInput('lock'); // jak w scenie po przejęciu blokady
    await startWildEncounter({ encounterId: id, source: staticSource('wild-1') });
    expect(virtualInput.dir).toBeNull();
    setOutcome('win');
    await finishBattle();
    expect(virtualInput.dir).toBeNull();
    expect(joystick.pointerId).toBeNull();
    expect(isOverworldBlocked()).toBe(true); // dialog z nagrodą
    closeDialogs();
    expect(isOverworldBlocked()).toBe(false);
    // Odnowienie w krokach: tuż po walce nowe spotkanie jest odrzucane; każdy krok zmniejsza odnowienie o 1.
    expect(useUi.getState().tryStartEncounter('wild-2')).toBeNull();
    const never = createRng(1);
    for (let i = ENCOUNTER_CONFIG.cooldownSteps; i > 0; i--) {
      expect(useUi.getState().encounterCooldown).toBe(i);
      const r = useUi.getState().registerEncounterStep({ movedToNewTile: true, zone: TEST_MAP.zones[0] }, never);
      expect(r.decision.reason).toBe('cooldown');
      expect(r.decision.rolled).toBe(false);
    }
    expect(useUi.getState().encounterCooldown).toBe(0);
    expect(useUi.getState().tryStartEncounter('wild-2')).not.toBeNull();
  });

  it('kolejne spotkania po sobie działają (blokada nie „wisi”)', async () => {
    for (let i = 0; i < 3; i++) {
      const id = await startBattle(`wild-${i}`);
      setOutcome('fled');
      expect(await finishBattle()).toBe(true);
      expect(useUi.getState().lastEncounter?.id).toBe(id);
      closeDialogs();
      useUi.getState().setEncounterCooldown(0); // jak po przejściu kroków odnowienia
      battleEnds = [];
    }
    expect(useGame.getState().stats.fled).toBe(3);
  });
});

describe('losowe spotkanie po kroku (Sprint 2)', () => {
  const MEADOW = TEST_MAP.zones.find((z) => z.id === 'meadow')!;
  const stepSource = (): StepEncounterSource => ({
    kind: 'step',
    locationId: MEADOW.locationId,
    zoneId: MEADOW.id,
    zoneName: MEADOW.name,
    terrainType: MEADOW.terrainType,
    encounterTableId: MEADOW.encounterTableId,
  });

  it('trafienie po kroku przejmuje blokadę, a walka obsługuje wylosowanego przeciwnika', async () => {
    let built = 0;
    const restore = configureEncounterDeps({
      buildStepSpawn: async (source) => {
        built += 1;
        expect(source.encounterTableId).toBe('meadow');
        return { ...SPAWN, zoneId: source.zoneId, zoneName: source.zoneName };
      },
    });
    const { decision, encounterId } = useUi.getState().registerEncounterStep({ movedToNewTile: true, zone: MEADOW }, createSequenceRng([0]));
    expect(decision.hit).toBe(true);
    expect(encounterId).not.toBeNull();
    expect(useUi.getState().gameMode).toBe('ENCOUNTER_STARTING');
    expect(useUi.getState().sourceEntityId).toBe(`${MEADOW.locationId}:TALL_GRASS`);
    // Kolejny krok/trigger w tej samej klatce nie losuje i nie startuje drugiego spotkania.
    const again = useUi.getState().registerEncounterStep({ movedToNewTile: true, zone: MEADOW }, createSequenceRng([0]));
    expect(again.decision.rolled).toBe(false);
    expect(again.encounterId).toBeNull();

    expect(await startWildEncounter({ encounterId: encounterId!, source: stepSource() })).toBe(true);
    expect(built).toBe(1);
    expect(useUi.getState().gameMode).toBe('BATTLE');
    expect(useBattle.getState().meta).toMatchObject({ encounterId, actorId: null, staticId: null, zoneId: 'meadow' });
    setOutcome('win');
    expect(await finishBattle()).toBe(true);
    expect(useGame.getState().stats.battlesWon).toBe(1);
    expect(battleEnds).toEqual([{ encounterId, actorId: null, outcome: 'win' }]);
    expect(useUi.getState().gameMode).toBe('EXPLORATION');
    expect(useUi.getState().encounterCooldown).toBe(ENCOUNTER_CONFIG.cooldownSteps);
    restore();
  });

  it('chybienie po kroku nie zmienia stanu eksploracji', () => {
    const { decision, encounterId } = useUi.getState().registerEncounterStep({ movedToNewTile: true, zone: MEADOW }, createSequenceRng([0.99]));
    expect(decision).toMatchObject({ rolled: true, hit: false, reason: 'miss' });
    expect(encounterId).toBeNull();
    expect(useUi.getState().gameMode).toBe('EXPLORATION');
    expect(useUi.getState().encounterRollCount).toBe(1);
  });

  it('brak losowania przy otwartym oknie lub dialogu', () => {
    useUi.setState({ modal: 'bag' });
    const r = useUi.getState().registerEncounterStep({ movedToNewTile: true, zone: MEADOW }, createSequenceRng([0]));
    expect(r.decision.rolled).toBe(false);
    expect(r.encounterId).toBeNull();
    useUi.setState({ modal: null, dialog: { lines: ['x'], index: 0 } });
    expect(useUi.getState().registerEncounterStep({ movedToNewTile: true, zone: MEADOW }, createSequenceRng([0])).decision.rolled).toBe(false);
    expect(useUi.getState().encounterRollCount).toBe(0);
  });

  it('brak losowania podczas walki (stan BATTLE), odnowienie bez zmian', async () => {
    await startBattle();
    useUi.setState({ encounterCooldown: 2 });
    const r = useUi.getState().registerEncounterStep({ movedToNewTile: true, zone: MEADOW }, createSequenceRng([0]));
    expect(r.decision).toMatchObject({ rolled: false, reason: 'blocked' });
    expect(useUi.getState().encounterCooldown).toBe(2);
    expect(useUi.getState().encounterRollCount).toBe(0);
  });

  it('błąd przygotowania wylosowanego stworzenia: spotkanie anulowane centralnie', async () => {
    const restore = configureEncounterDeps({
      buildStepSpawn: async () => {
        throw new Error('Offline: brak zapisanych danych stworzeń z tego miejsca.');
      },
    });
    const { encounterId } = useUi.getState().registerEncounterStep({ movedToNewTile: true, zone: MEADOW }, createSequenceRng([0]));
    expect(await startWildEncounter({ encounterId: encounterId!, source: stepSource() })).toBe(false);
    const u = useUi.getState();
    expect(u.gameMode).toBe('EXPLORATION');
    expect(u.inputLocked).toBe(false);
    expect(u.lastEncounter).toMatchObject({ id: encounterId, outcome: 'cancel', reason: 'init-error' });
    expect(u.toast?.text).toContain('Offline');
    expect(battleEnds).toHaveLength(1);
    restore();
  });
});

describe('spotkanie specjalne (Sprint 2)', () => {
  it('wygrana ustawia flagę zapisu — stworzenie nie wraca', async () => {
    const id = useUi.getState().tryStartEncounter('static:gaj-straznik')!;
    expect(await startWildEncounter({ encounterId: id, source: staticSource('static:gaj-straznik', 'gaj-straznik') })).toBe(true);
    expect(useBattle.getState().meta.staticId).toBe('gaj-straznik');
    setOutcome('win');
    await finishBattle();
    expect(useGame.getState().flags[staticDoneFlag('gaj-straznik')]).toBe(true);
    expect(battleEnds[0]).toEqual({ encounterId: id, actorId: 'static:gaj-straznik', outcome: 'win' });
  });

  it('złapanie także ustawia flagę; ucieczka i przegrana — nie', async () => {
    for (const [outcome, expected] of [
      ['fled', false],
      ['lose', false],
      ['caught', true],
    ] as const) {
      useGame.setState({ flags: {} });
      useUi.getState().setEncounterCooldown(0);
      closeDialogs();
      const id = useUi.getState().tryStartEncounter('static:gaj-straznik')!;
      await startWildEncounter({ encounterId: id, source: staticSource('static:gaj-straznik', 'gaj-straznik') });
      setOutcome(outcome, outcome === 'lose' ? (party) => party.forEach((c) => (c.hp = 0)) : undefined);
      await finishBattle();
      expect(!!useGame.getState().flags[staticDoneFlag('gaj-straznik')]).toBe(expected);
    }
  });
});

describe('ewolucja po walce (Sprint 4)', () => {
  it('awans w walce → propozycja ewolucji w kolejce; ruch po mapie zablokowany, dopóki okno jest otwarte', async () => {
    evolutionAnswer = (leveled) => leveled.map((uid) => ({ uid, toSpecies: 'flamier', toSpeciesId: 2, method: 'LEVEL' as const, itemId: null, condition: 'poziom 13' }));
    await startBattle();
    setOutcome('win', (party) => {
      party[0].level += 1;
    });
    await finishBattle();
    await delay(0);
    expect(evolutionCalls).toEqual([{ party: [hero.creature.uid], leveled: [hero.creature.uid] }]);
    expect(useUi.getState().evolutionQueue).toHaveLength(1);
    closeDialogs();
    expect(isOverworldBlocked()).toBe(true);
    useUi.getState().shiftEvolution();
    expect(isOverworldBlocked()).toBe(false);
  });

  it('bez awansu albo po przegranej — brak propozycji', async () => {
    evolutionAnswer = (leveled) => leveled.map((uid) => ({ uid, toSpecies: 'flamier', toSpeciesId: 2, method: 'LEVEL' as const, itemId: null, condition: 'poziom 13' }));
    await startBattle();
    setOutcome('win');
    await finishBattle();
    await delay(0);
    expect(evolutionCalls).toEqual([]);
    closeDialogs();
    useUi.setState({ encounterCooldown: 0 }); // odnowienie po pierwszej walce minęło
    await startBattle('wild-1');
    setOutcome('lose', (party) => {
      party[0].level += 1;
      party[0].hp = 0;
    });
    await finishBattle();
    await delay(0);
    expect(evolutionCalls).toEqual([]);
    expect(useUi.getState().evolutionQueue).toHaveLength(0);
  });
});
