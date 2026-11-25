// Orkiestracja: przejście eksploracja → walka → powrót, leczenie w Stacji Opieki, obsługa drzwi.
// Spotkanie zaczyna się wyłącznie przez centralną blokadę (useUi.tryStartEncounter — bezpośrednio przy kontakcie
// ze stworzeniem specjalnym albo przez useUi.registerEncounterStep po kroku w trawie), a kończy wyłącznie
// przez finishBattle (wynik walki) albo cancelEncounter (błąd rozpoczęcia, zamknięcie interfejsu walki).
// Wspólne zakończenie (concludeEncounter) wykonuje się dokładnie raz dla każdego spotkania.

import { isOnline } from '../api/pokeapi';
import { ENCOUNTER_CONFIG, staticDoneFlag } from '../config/encounters';
import { CURRENCY } from '../config/text';
import { RULES } from '../config/rules';
import { getMove, getPokemon, getTypeChart, getGrowthTables, isPokemonCached } from '../data/repository';
import { saveNow } from '../data/saveGame';
import { ITEMS, type ItemId } from '../config/items';
import type { TrainerDef } from '../config/trainers';
import { createTrainerBattle, createWildBattle } from '../engine/battle/battleEngine';
import type { BattleEvent, BattleState } from '../engine/battle/types';
import { displayName } from '../engine/creature';
import { gameRng, type Rng } from '../engine/rng';
import type { GrowthTable, MoveData, PokemonData, SpeciesData, TypeChart } from '../engine/types';
import { eligibleEntries, encounterTable, methodForTerrain, pickEncounterEntry } from '../game/encounterZones';
import { bus, type BusEvents, type EncounterOutcome, type StepEncounterSource } from '../game/eventBus';
import { releaseInput } from '../game/input';
import { MAPS } from '../game/maps';
import type { StaticEncounterDef } from '../game/maps/testMap';
import { getLocation, healingTarget, startLocation, type WorldPosition } from '../game/world';
import { useBattle } from '../state/battleStore';
import { useGame } from '../state/gameStore';
import { encounterClock, useUi, type EncounterEndReason, type EvolutionRequest, type LearnRequest } from '../state/uiStore';
import { buildTrainerCreature, buildWild, dexInfo, errorMessage, loadMovesSafe, type CreatureBundle, type WildSpawn } from './creatureService';
import { getTrainer, isDefeated } from '../game/trainers';
import { pendingLevelEvolutions } from './evolutionService';
import type { Creature } from '../engine/types';

/** Zależności zewnętrzne (dane, zapis, losowość, czas) — podmienialne w testach jednostkowych. */
export interface EncounterDeps {
  getPokemon(name: string): Promise<PokemonData>;
  getMove(name: string): Promise<MoveData>;
  getTypeChart(): Promise<TypeChart>;
  getGrowthTables(names: string[]): Promise<Record<string, GrowthTable>>;
  loadMoves(names: string[]): Promise<Record<string, MoveData>>;
  saveNow(): Promise<void>;
  /** Losowość budowania stworzeń i nagród (w grze: gameRng, w trybie ?debug&seed=N — z ziarnem). */
  rng: Rng;
  /** Źródło rzutu na spotkanie po kroku (osobne, aby testy mogły je kontrolować). */
  stepRng: Rng;
  /** Stworzenie dla spotkania wylosowanego po kroku (tabela strefy, ważony wybór, poziom z zakresu). */
  buildStepSpawn(source: StepEncounterSource, rng: Rng): Promise<WildSpawn>;
  now(): number;
  /** Minimalny czas animacji przejścia do walki. */
  minTransitionMs: number;
  /** Propozycje ewolucji dla stworzeń, które awansowały w walce (dane łańcucha z bufora). */
  collectEvolutions(party: Creature[], leveledUids: string[]): Promise<EvolutionRequest[]>;
  /** Drużyna trenera (dane PokéAPI z bufora; testy podstawiają gotowe stworzenia). */
  buildTrainerTeam(trainer: TrainerDef, rng: Rng): Promise<{ creature: Creature; bundle: CreatureBundle }[]>;
}

async function buildTrainerTeamFromData(trainer: TrainerDef, rng: Rng): Promise<{ creature: Creature; bundle: CreatureBundle }[]> {
  const out: { creature: Creature; bundle: CreatureBundle }[] = [];
  // Kolejno (nie równolegle) — stała kolejność losowań z ziarnem gry.
  for (const m of trainer.team) out.push(await buildTrainerCreature(m, trainer.name, rng));
  return out;
}

const DEFAULT_DEPS: EncounterDeps = {
  getPokemon,
  getMove,
  getTypeChart,
  getGrowthTables,
  loadMoves: loadMovesSafe,
  saveNow,
  rng: gameRng,
  stepRng: gameRng,
  buildStepSpawn: buildStepSpawnFromTable,
  now: encounterClock,
  minTransitionMs: 750,
  collectEvolutions: pendingLevelEvolutions,
  buildTrainerTeam: buildTrainerTeamFromData,
};

let deps: EncounterDeps = DEFAULT_DEPS;

/** Podmienia zależności (testy). Zwraca funkcję przywracającą poprzednie. */
export function configureEncounterDeps(patch: Partial<EncounterDeps>): () => void {
  const prev = deps;
  deps = { ...deps, ...patch };
  return () => {
    deps = prev;
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Źródło rzutu na spotkanie po kroku (używa go scena mapy). */
export function encounterStepRng(): Rng {
  return deps.stepRng;
}

/** Losuje stworzenie z tabeli strefy dla terenu, w którym wykonano krok. Offline: tylko gatunki z bufora. */
export async function buildStepSpawnFromTable(source: StepEncounterSource, rng: Rng): Promise<WildSpawn> {
  const table = encounterTable(source.encounterTableId);
  const method = methodForTerrain(source.terrainType);
  if (!method || method === 'static') throw new Error('Ten teren nie obsługuje losowych spotkań.');
  let entries = eligibleEntries(table, method, useGame.getState().flags);
  if (!isOnline()) {
    const cached = await Promise.all(entries.map((e) => isPokemonCached(e.pokemonId)));
    entries = entries.filter((_, i) => cached[i]);
    if (!entries.length) throw new Error('Offline: brak zapisanych danych stworzeń z tego miejsca.');
  }
  const entry = pickEncounterEntry(entries, rng);
  return buildWild(entry, table, { id: source.zoneId, name: source.zoneName }, rng);
}

/** Stworzenie dla spotkania specjalnego (wpis „static” z jego tabeli). */
export async function buildStaticSpawn(def: StaticEncounterDef, zoneName: string): Promise<WildSpawn> {
  const table = encounterTable(def.encounterTableId);
  const entry = pickEncounterEntry(eligibleEntries(table, 'static', useGame.getState().flags), deps.rng);
  return buildWild(entry, table, { id: def.zoneId, name: zoneName }, deps.rng);
}
function isStarting(encounterId: string): boolean {
  const u = useUi.getState();
  return u.activeEncounterId === encounterId && u.gameMode === 'ENCOUNTER_STARTING';
}

/**
 * Inicjalizacja walki dla spotkania, które już przejęło centralną blokadę.
 * Zdarzenia bez ważnej blokady (obce, przestarzałe, powtórzone) są ignorowane.
 */
export async function startWildEncounter(payload: BusEvents['encounter']): Promise<boolean> {
  const id = payload.encounterId;
  if (!isStarting(id)) return false;
  useUi.getState().setTransition(true);
  bus.emit('battle-start', undefined);
  const t0 = deps.now();

  const source = payload.source;
  if (source.kind === 'trainer') return startTrainerBattle(id, source, t0);
  let built: { state: BattleState; events: BattleEvent[] };
  let spawn: WildSpawn;
  try {
    const game = useGame.getState();
    const party = game.party;
    if (!party.some((c) => c.hp > 0)) throw new Error('Twoja drużyna jest wyczerpana. Odwiedź Stację Opieki!');
    spawn = source.kind === 'static' ? source.spawn : await deps.buildStepSpawn(source, deps.rng);
    const enemy = spawn.creature;
    const [typeChart, partyData] = await Promise.all([deps.getTypeChart(), Promise.all(party.map((c) => deps.getPokemon(c.pokemon)))]);
    const pokemon: Record<string, PokemonData> = { [spawn.pokemon.name]: spawn.pokemon };
    for (const p of partyData) pokemon[p.name] = p;
    const moves = await deps.loadMoves([...party, enemy].flatMap((c) => c.moves.map((m) => m.name)));
    const growth = await deps.getGrowthTables(party.map((c) => c.growthRate));

    built = createWildBattle({
      playerName: game.player.name,
      party,
      enemy,
      pokemon,
      moves,
      growth,
      typeChart,
      captureRate: spawn.species.captureRate,
    });

    const elapsed = deps.now() - t0;
    if (elapsed < deps.minTransitionMs) await sleep(deps.minTransitionMs - elapsed);
  } catch (e) {
    useUi.getState().setTransition(false);
    useUi.getState().showToast(errorMessage(e));
    cancelEncounter(id, 'init-error');
    return false;
  }

  // Spotkanie mogło zostać przerwane w trakcie ładowania — wtedy nie otwieramy walki.
  if (!isStarting(id)) {
    useUi.getState().setTransition(false);
    return false;
  }
  const game = useGame.getState();
  game.markSeen(dexInfo(spawn.pokemon, spawn.species));
  game.incStat('encounters');
  useBattle.getState().begin(built.state, built.events, {
    encounterId: id,
    actorId: source.kind === 'static' ? source.actorId : null,
    staticId: source.kind === 'static' ? source.staticId : null,
    zoneId: spawn.zoneId,
    enemySpecies: spawn.species,
  });
  const ui = useUi.getState();
  ui.confirmBattle(id);
  ui.setMode('battle');
  ui.setTransition(false);
  return true;
}

/**
 * Walka z trenerem (Sprint 5) — ta sama blokada spotkania i ten sam silnik walki (createTrainerBattle).
 * Wywoływana po dialogu przed walką, gdy spotkanie nadal jest w stanie ENCOUNTER_STARTING.
 */
async function startTrainerBattle(id: string, source: Extract<BusEvents['encounter']['source'], { kind: 'trainer' }>, t0: number): Promise<boolean> {
  let built: { state: BattleState; events: BattleEvent[] };
  const trainerSpecies: Record<string, SpeciesData> = {};
  let trainer: TrainerDef | undefined;
  try {
    trainer = getTrainer(source.trainerId);
    if (!trainer) throw new Error(`Nieznany trener: ${source.trainerId}`);
    const game = useGame.getState();
    const party = game.party;
    if (!party.some((c) => c.hp > 0)) throw new Error('Twoja drużyna jest wyczerpana. Odwiedź Stację Opieki!');
    const team = await deps.buildTrainerTeam(trainer, deps.rng);
    const [typeChart, partyData] = await Promise.all([deps.getTypeChart(), Promise.all(party.map((c) => deps.getPokemon(c.pokemon)))]);
    const pokemon: Record<string, PokemonData> = {};
    for (const p of partyData) pokemon[p.name] = p;
    for (const m of team) {
      pokemon[m.bundle.pokemon.name] = m.bundle.pokemon;
      trainerSpecies[m.creature.uid] = m.bundle.species;
    }
    const enemies = team.map((m) => m.creature);
    const moves = await deps.loadMoves([...party, ...enemies].flatMap((c) => c.moves.map((m) => m.name)));
    const growth = await deps.getGrowthTables(party.map((c) => c.growthRate));
    built = createTrainerBattle({ playerName: game.player.name, party, enemies, pokemon, moves, growth, typeChart, trainerName: trainer.name, ai: trainer.aiProfile });
    const elapsed = deps.now() - t0;
    if (elapsed < deps.minTransitionMs) await sleep(deps.minTransitionMs - elapsed);
  } catch (e) {
    useUi.getState().setTransition(false);
    useUi.getState().showToast(errorMessage(e));
    cancelEncounter(id, 'init-error');
    return false;
  }
  if (!isStarting(id)) {
    useUi.getState().setTransition(false);
    return false;
  }
  const first = built.state.sides[1].party[built.state.sides[1].active[0]];
  const firstData = first ? built.state.pokemon[first.pokemon] : undefined;
  if (first && firstData && trainerSpecies[first.uid]) useGame.getState().markSeen(dexInfo(firstData, trainerSpecies[first.uid]));
  useBattle.getState().begin(built.state, built.events, {
    encounterId: id,
    actorId: source.actorId,
    staticId: null,
    zoneId: null,
    enemySpecies: null,
    trainerId: trainer.id,
    rematch: source.rematch,
    trainerSpecies,
  });
  const ui = useUi.getState();
  ui.confirmBattle(id);
  ui.setMode('battle');
  ui.setTransition(false);
  return true;
}

/** Wynik walki z trenerem: flaga pokonania i nagroda tylko przy pierwszej wygranej; dialog po walce. */
function applyTrainerResult(st: BattleState, trainerId: string, rematch: boolean, outcome: EncounterOutcome, species: Record<string, SpeciesData>, notes: string[]): void {
  const game = useGame.getState();
  const trainer = getTrainer(trainerId);
  if (!trainer) return;
  // Atlas: stworzenia trenera, które pojawiły się w walce (aktywne albo pokonane).
  const enemySide = st.sides[1];
  enemySide.party.forEach((c, i) => {
    const data = st.pokemon[c.pokemon];
    if (data && species[c.uid] && (c.hp <= 0 || i === enemySide.active[0])) game.markSeen(dexInfo(data, species[c.uid]));
  });
  if (outcome !== 'win') return; // przegrana: istniejący powrót do Stacji Opieki, trener nie jest oznaczony
  game.incStat('battlesWon');
  const firstWin = !rematch && !isDefeated(trainer, game.flags);
  if (firstWin) {
    // Zapis wydarzenia i nagroda — dokładnie raz (flaga sprawdzana przed przyznaniem).
    game.setFlag(trainer.defeatedEventId);
    notes.push(`Pokonujesz: ${trainer.name}!`);
    if (trainer.reward.money > 0) {
      game.addMoney(trainer.reward.money);
      notes.push(`Otrzymujesz ${trainer.reward.money} ${CURRENCY}.`);
    }
    for (const [item, n] of Object.entries(trainer.reward.items ?? {}) as [ItemId, number][]) {
      if (!(item in ITEMS) || !(n > 0)) continue;
      game.addItem(item, n);
      notes.push(`Otrzymujesz: ${ITEMS[item].name} ×${n}.`);
    }
  } else {
    notes.push(`Wygrywasz rewanż z: ${trainer.name}! (Nagroda była tylko za pierwsze zwycięstwo.)`);
  }
  for (const line of trainer.dialogueAfter) notes.push(`${trainer.name}: „${line}”`);
}

/**
 * Zakończenie walki z wynikiem (zwycięstwo, złapanie, ucieczka, przegrana).
 * Wynik jest przetwarzany dokładnie raz — kolejne wywołania (np. podwójne „Dalej”) zwracają false.
 */
export async function finishBattle(): Promise<boolean> {
  const battle = useBattle.getState();
  const st = battle.engine;
  const meta = battle.meta;
  const id = meta.encounterId;
  if (!st || !id) return false;
  // 1) ENCOUNTER_ENDING — przejęcie zakończenia (tylko raz).
  if (!useUi.getState().beginEncounterEnd(id)) return false;

  const outcome: EncounterOutcome = st.outcome ?? 'fled';
  const notes: string[] = [];
  const requests: LearnRequest[] = [];
  let returnTo: WorldPosition | null = null;
  let leveled: string[] = [];

  try {
    // 2) Przetworzenie wyniku.
    const game = useGame.getState();
    const levelBefore = new Map(game.party.map((c) => [c.uid, c.level]));
    leveled = st.sides[0].party.filter((c) => c.level > (levelBefore.get(c.uid) ?? c.level)).map((c) => c.uid);
    game.updateCreatures(st.sides[0].party);

    if (outcome === 'caught' && st.caught) {
      const caught = { ...st.caught, metAt: zoneName(meta.zoneId) };
      const where = game.addCreature(caught);
      const data = st.pokemon[caught.pokemon];
      if (data && meta.enemySpecies) game.markCaught(dexInfo(data, meta.enemySpecies));
      game.incStat('caught');
      notes.push(
        where === 'party'
          ? `${displayName(caught)} dołącza do Twojej drużyny!`
          : `Drużyna jest pełna — ${displayName(caught)} trafia do magazynu.`,
      );
    } else if (outcome === 'win' && meta.trainerId) {
      applyTrainerResult(st, meta.trainerId, !!meta.rematch, outcome, meta.trainerSpecies ?? {}, notes);
    } else if (outcome === 'win') {
      game.incStat('battlesWon');
      const enemy = st.sides[1].party[0];
      const [lo, hi] = RULES.wildMoneyReward;
      const reward = Math.max(5, Math.floor((deps.rng.int(lo, hi) * Math.max(1, enemy?.level ?? 1)) / 4));
      game.addMoney(reward);
      notes.push(`Znajdujesz ${reward} ${CURRENCY} w trawie po walce.`);
    } else if (outcome === 'fled') {
      game.incStat('fled');
    }
    if (outcome !== 'win' && meta.trainerId) applyTrainerResult(st, meta.trainerId, !!meta.rematch, outcome, meta.trainerSpecies ?? {}, notes);
    if ((outcome === 'win' || outcome === 'caught') && meta.zoneId === 'grove') game.setFlag('grove-done');
    // Spotkanie specjalne po wygranej lub złapaniu nie pojawia się ponownie (flaga w istniejącym polu zapisu).
    if ((outcome === 'win' || outcome === 'caught') && meta.staticId) game.setFlag(staticDoneFlag(meta.staticId));

    // Porażka: powrót do punktu leczenia lokacji (model świata) — także na inną mapę.
    const allFainted = !useGame.getState().party.some((c) => c.hp > 0);
    if (outcome === 'lose' || allFainted) {
      const loss = Math.floor(useGame.getState().player.money * RULES.blackoutMoneyLoss);
      game.addMoney(-loss);
      game.healAll();
      game.incStat('blackouts');
      returnTo = healingTarget(useGame.getState().player.locationId);
      game.setLocation(returnTo);
      notes.push(`Wracasz pospiesznie do Stacji Opieki. Tracisz ${loss} ${CURRENCY}.`, 'Twoje stworzenia odzyskały siły.');
    }

    // Nauka nowych ruchów (automatycznie, jeśli jest wolne miejsce).
    for (const pl of st.pendingLearns) {
      try {
        const move = await deps.getMove(pl.move);
        const c = useGame.getState().party.find((x) => x.uid === pl.uid);
        if (!c || c.moves.some((m) => m.name === move.name)) continue;
        if (c.moves.length < RULES.maxMoves) {
          useGame.getState().learnMove(pl.uid, move, null);
          notes.push(`${displayName(c)} uczy się ruchu ${move.displayName}!`);
        } else {
          requests.push({ uid: pl.uid, move });
        }
      } catch {
        /* brak danych offline — ruch zostanie pominięty */
      }
    }
  } catch (e) {
    // Sterowanie musi wrócić niezależnie od błędu w przetwarzaniu wyniku.
    console.error('Błąd przetwarzania wyniku walki', e);
  }

  // 3–8) Wspólne zakończenie.
  concludeEncounter(id, meta.actorId, outcome, 'result', returnTo);

  const ui = useUi.getState();
  const pushLearns = () => {
    if (requests.length) useUi.getState().pushLearn(requests);
  };
  if (notes.length) ui.showDialog(notes, pushLearns);
  else pushLearns();
  // Ewolucje po awansie: okno pojawi się po komunikatach i nauce ruchów (EvolutionModal czeka na nie).
  // Po przegranej (powrót do Stacji Opieki) ewolucji nie proponujemy.
  if (leveled.length && !returnTo) {
    deps
      .collectEvolutions(useGame.getState().party, leveled)
      .then((reqs) => {
        if (reqs.length) useUi.getState().pushEvolutions(reqs);
      })
      .catch(() => undefined);
  }
  deps.saveNow().catch(() => undefined);
  return true;
}

/**
 * Przerwanie spotkania bez wyniku: błąd rozpoczęcia albo zamknięcie interfejsu walki.
 * Drużyna i nagrody pozostają bez zmian. Zwraca false, jeśli spotkanie już się kończy lub zakończyło.
 */
export function cancelEncounter(encounterId: string, reason: Exclude<EncounterEndReason, 'result'>): boolean {
  const ui = useUi.getState();
  const actorId = ui.sourceEntityId;
  if (!ui.beginEncounterEnd(encounterId)) return false;
  concludeEncounter(encounterId, actorId, 'cancel', reason, null);
  return true;
}

/** Kroki 3–8 zakończenia spotkania — wspólne dla każdej ścieżki. */
function concludeEncounter(
  encounterId: string,
  actorId: string | null,
  outcome: EncounterOutcome,
  reason: EncounterEndReason,
  returnTo: WorldPosition | null,
): void {
  // 3) Aktualizacja obiektu źródłowego na mapie (usunięcie stworzenia albo odnowienie).
  bus.emit('battle-end', { encounterId, actorId, outcome });
  // 4) Zwolnienie spotkania.
  useUi.getState().releaseEncounter(encounterId, outcome, reason);
  // 5) Powrót sceny Phasera (zmiana trybu budzi pętlę gry).
  const battle = useBattle.getState();
  if (battle.engine || battle.meta.encounterId) battle.clear();
  const ui = useUi.getState();
  ui.setTransition(false);
  if (ui.mode === 'battle') ui.setMode('overworld');
  // Powrót po przegranej: scena przenosi gracza (ta sama mapa) albo przeładowuje się z mapą punktu leczenia.
  if (returnTo) bus.emit('travel', returnTo);
  // 6) Odnowienie — kilka poprawnych kroków bez nowych spotkań.
  ui.setEncounterCooldown(ENCOUNTER_CONFIG.cooldownSteps);
  // 7) Joystick od zera (palec trzymany przed walką nie porusza postaci).
  releaseInput('encounter-end');
  // 8) EXPLORATION.
  useUi.getState().enterExploration();
}

function zoneName(zoneId: string | null): string {
  for (const map of Object.values(MAPS)) {
    const z = map.zones.find((x) => x.id === zoneId);
    if (z) return z.name;
  }
  return getLocation(useGame.getState().player.locationId)?.name ?? startLocation().name;
}

export function handleDoor(kind: 'care' | 'shop'): void {
  const ui = useUi.getState();
  if (kind === 'care') {
    useGame.getState().healAll();
    ui.showDialog([
      'Witaj w Stacji Opieki!',
      'Twoje stworzenia odpoczywają na miękkich posłaniach…',
      'Gotowe! Wszystkie są w pełni sił. Zapisano postęp.',
    ]);
    deps.saveNow().catch(() => undefined);
  } else {
    ui.openModal('shop');
  }
}

/** Rejestruje obsługę zdarzeń z mapy. Wywoływane raz przy starcie aplikacji. */
export function installEncounterHandlers(): () => void {
  const offs = [
    bus.on('encounter', (p) => void startWildEncounter(p)),
    bus.on('door', (p) => handleDoor(p.kind)),
    bus.on('dialog', (p) => useUi.getState().showDialog(p.lines)),
  ];
  return () => offs.forEach((off) => off());
}
