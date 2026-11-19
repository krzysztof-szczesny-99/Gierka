// Orkiestracja: przejście eksploracja → walka → powrót, leczenie w Stacji Opieki, obsługa drzwi.
// Spotkanie zaczyna się wyłącznie przez useUi.tryStartEncounter (centralna blokada), a kończy wyłącznie
// przez finishBattle (wynik walki) albo cancelEncounter (błąd rozpoczęcia, zamknięcie interfejsu walki).
// Wspólne zakończenie (concludeEncounter) wykonuje się dokładnie raz dla każdego spotkania.

import { ENCOUNTER_COOLDOWN_MS } from '../config/encounters';
import { CURRENCY } from '../config/text';
import { RULES } from '../config/rules';
import { getMove, getPokemon, getTypeChart, getGrowthTables } from '../data/repository';
import { saveNow } from '../data/saveGame';
import { createWildBattle } from '../engine/battle/battleEngine';
import type { BattleEvent, BattleState } from '../engine/battle/types';
import { displayName } from '../engine/creature';
import { gameRng, type Rng } from '../engine/rng';
import type { Dir, GrowthTable, MoveData, PokemonData, TypeChart } from '../engine/types';
import { bus, type BusEvents, type EncounterOutcome } from '../game/eventBus';
import { releaseInput } from '../game/input';
import { MAPS, TEST_MAP } from '../game/maps/testMap';
import { useBattle } from '../state/battleStore';
import { useGame } from '../state/gameStore';
import { encounterClock, useUi, type EncounterEndReason, type LearnRequest } from '../state/uiStore';
import { dexInfo, errorMessage, loadMovesSafe } from './creatureService';

/** Zależności zewnętrzne (dane, zapis, losowość, czas) — podmienialne w testach jednostkowych. */
export interface EncounterDeps {
  getPokemon(name: string): Promise<PokemonData>;
  getMove(name: string): Promise<MoveData>;
  getTypeChart(): Promise<TypeChart>;
  getGrowthTables(names: string[]): Promise<Record<string, GrowthTable>>;
  loadMoves(names: string[]): Promise<Record<string, MoveData>>;
  saveNow(): Promise<void>;
  rng: Rng;
  now(): number;
  /** Minimalny czas animacji przejścia do walki. */
  minTransitionMs: number;
}

const DEFAULT_DEPS: EncounterDeps = {
  getPokemon,
  getMove,
  getTypeChart,
  getGrowthTables,
  loadMoves: loadMovesSafe,
  saveNow,
  rng: gameRng,
  now: encounterClock,
  minTransitionMs: 750,
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

  let built: { state: BattleState; events: BattleEvent[] };
  try {
    const game = useGame.getState();
    const party = game.party;
    if (!party.some((c) => c.hp > 0)) throw new Error('Twoja drużyna jest wyczerpana. Odwiedź Stację Opieki!');
    const enemy = payload.spawn.creature;
    const [typeChart, partyData] = await Promise.all([deps.getTypeChart(), Promise.all(party.map((c) => deps.getPokemon(c.pokemon)))]);
    const pokemon: Record<string, PokemonData> = { [payload.spawn.pokemon.name]: payload.spawn.pokemon };
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
      captureRate: payload.spawn.species.captureRate,
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
  game.markSeen(dexInfo(payload.spawn.pokemon, payload.spawn.species));
  game.incStat('encounters');
  useBattle.getState().begin(built.state, built.events, {
    encounterId: id,
    actorId: payload.actorId,
    zoneId: payload.spawn.zoneId,
    enemySpecies: payload.spawn.species,
  });
  const ui = useUi.getState();
  ui.confirmBattle(id);
  ui.setMode('battle');
  ui.setTransition(false);
  return true;
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
  let teleportTo: { x: number; y: number; facing: Dir } | null = null;

  try {
    // 2) Przetworzenie wyniku.
    const game = useGame.getState();
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
    if ((outcome === 'win' || outcome === 'caught') && meta.zoneId === 'grove') game.setFlag('grove-done');

    // Porażka: powrót do Stacji Opieki.
    const map = MAPS[useGame.getState().player.mapId] ?? TEST_MAP;
    const allFainted = !useGame.getState().party.some((c) => c.hp > 0);
    if (outcome === 'lose' || allFainted) {
      const loss = Math.floor(useGame.getState().player.money * RULES.blackoutMoneyLoss);
      game.addMoney(-loss);
      game.healAll();
      game.incStat('blackouts');
      game.setPosition(map.healReturn.x, map.healReturn.y, map.healReturn.facing);
      teleportTo = { ...map.healReturn };
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
  concludeEncounter(id, meta.actorId, outcome, 'result', teleportTo);

  const ui = useUi.getState();
  const pushLearns = () => {
    if (requests.length) useUi.getState().pushLearn(requests);
  };
  if (notes.length) ui.showDialog(notes, pushLearns);
  else pushLearns();
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
  teleportTo: { x: number; y: number; facing: Dir } | null,
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
  if (teleportTo) bus.emit('teleport', teleportTo);
  // 6) Odnowienie — chwila bez nowych spotkań.
  ui.setEncounterCooldown(deps.now() + ENCOUNTER_COOLDOWN_MS);
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
  return TEST_MAP.name;
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
