// Orkiestracja: przejście eksploracja → walka → powrót, leczenie w Stacji Opieki, obsługa drzwi.

import { CURRENCY } from '../config/text';
import { RULES } from '../config/rules';
import { getMove, getPokemon, getTypeChart, getGrowthTables } from '../data/repository';
import { saveNow } from '../data/saveGame';
import { createWildBattle } from '../engine/battle/battleEngine';
import { displayName } from '../engine/creature';
import { gameRng } from '../engine/rng';
import type { PokemonData } from '../engine/types';
import { bus, type EncounterOutcome } from '../game/eventBus';
import { MAPS, TEST_MAP } from '../game/maps/testMap';
import { useBattle } from '../state/battleStore';
import { useGame } from '../state/gameStore';
import { useUi, type LearnRequest } from '../state/uiStore';
import { dexInfo, errorMessage, loadMovesSafe, type WildSpawn } from './creatureService';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MIN_TRANSITION_MS = 750;

export async function startWildEncounter(payload: { actorId: string; spawn: WildSpawn }): Promise<void> {
  const ui = useUi.getState();
  if (ui.mode !== 'overworld' || ui.transition) {
    bus.emit('battle-end', { actorId: payload.actorId, outcome: 'cancel' });
    return;
  }
  ui.setTransition(true);
  bus.emit('battle-start', undefined);
  const t0 = performance.now();
  try {
    const game = useGame.getState();
    const party = game.party;
    if (!party.some((c) => c.hp > 0)) throw new Error('Twoja drużyna jest wyczerpana. Odwiedź Stację Opieki!');
    const enemy = payload.spawn.creature;
    const [typeChart, partyData] = await Promise.all([getTypeChart(), Promise.all(party.map((c) => getPokemon(c.pokemon)))]);
    const pokemon: Record<string, PokemonData> = { [payload.spawn.pokemon.name]: payload.spawn.pokemon };
    for (const p of partyData) pokemon[p.name] = p;
    const moves = await loadMovesSafe([...party, enemy].flatMap((c) => c.moves.map((m) => m.name)));
    const growth = await getGrowthTables(party.map((c) => c.growthRate));

    const { state, events } = createWildBattle({
      playerName: game.player.name,
      party,
      enemy,
      pokemon,
      moves,
      growth,
      typeChart,
      captureRate: payload.spawn.species.captureRate,
    });
    game.markSeen(dexInfo(payload.spawn.pokemon, payload.spawn.species));
    game.incStat('encounters');

    const elapsed = performance.now() - t0;
    if (elapsed < MIN_TRANSITION_MS) await sleep(MIN_TRANSITION_MS - elapsed);
    useBattle.getState().begin(state, events, {
      actorId: payload.actorId,
      zoneId: payload.spawn.zoneId,
      enemySpecies: payload.spawn.species,
    });
    useUi.getState().setMode('battle');
  } catch (e) {
    useUi.getState().showToast(errorMessage(e));
    bus.emit('battle-end', { actorId: payload.actorId, outcome: 'cancel' });
  } finally {
    useUi.getState().setTransition(false);
  }
}

export async function finishBattle(): Promise<void> {
  const battle = useBattle.getState();
  const st = battle.engine;
  if (!st) return;
  const meta = battle.meta;
  const game = useGame.getState();
  const outcome: EncounterOutcome = st.outcome ?? 'fled';
  const notes: string[] = [];

  // 1) Zapisz zmiany drużyny (PŻ, PP, statusy, EXP, poziomy).
  game.updateCreatures(st.sides[0].party);

  // 2) Wynik walki.
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
    const reward = Math.max(5, Math.floor((gameRng.int(lo, hi) * Math.max(1, enemy?.level ?? 1)) / 4));
    game.addMoney(reward);
    notes.push(`Znajdujesz ${reward} ${CURRENCY} w trawie po walce.`);
  } else if (outcome === 'fled') {
    game.incStat('fled');
  }
  if ((outcome === 'win' || outcome === 'caught') && meta.zoneId === 'grove') game.setFlag('grove-done');

  // 3) Porażka: powrót do Stacji Opieki.
  const map = MAPS[useGame.getState().player.mapId] ?? TEST_MAP;
  const allFainted = !useGame.getState().party.some((c) => c.hp > 0);
  let teleported = false;
  if (outcome === 'lose' || allFainted) {
    const loss = Math.floor(useGame.getState().player.money * RULES.blackoutMoneyLoss);
    game.addMoney(-loss);
    game.healAll();
    game.incStat('blackouts');
    game.setPosition(map.healReturn.x, map.healReturn.y, map.healReturn.facing);
    teleported = true;
    notes.push(`Wracasz pospiesznie do Stacji Opieki. Tracisz ${loss} ${CURRENCY}.`, 'Twoje stworzenia odzyskały siły.');
  }

  // 4) Nauka nowych ruchów (automatycznie, jeśli jest wolne miejsce).
  const requests: LearnRequest[] = [];
  for (const pl of st.pendingLearns) {
    try {
      const move = await getMove(pl.move);
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

  // 5) Powrót na mapę.
  battle.clear();
  const ui = useUi.getState();
  ui.setMode('overworld');
  bus.emit('battle-end', { actorId: meta.actorId, outcome });
  if (teleported) bus.emit('teleport', { ...map.healReturn });
  const pushLearns = () => {
    if (requests.length) useUi.getState().pushLearn(requests);
  };
  if (notes.length) ui.showDialog(notes, pushLearns);
  else pushLearns();
  saveNow().catch(() => undefined);
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
    saveNow().catch(() => undefined);
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
