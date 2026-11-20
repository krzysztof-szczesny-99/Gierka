// Silnik walki turowej: czyste funkcje (stan + akcja + RNG → nowy stan + lista zdarzeń).
// UI odtwarza zdarzenia jedno po drugim, więc logika nie zależy od animacji.

import { ITEMS, type ItemId } from '../../config/items';
import { RULES } from '../../config/rules';
import { displayName } from '../creature';
import { expForLevel, expYield } from '../experience';
import { newMovesAtLevel, statChangeHitsUser, targetsUser } from '../moves';
import type { Rng } from '../rng';
import { accuracyStageMultiplier, addEvs, calcStats, stageMultiplier } from '../stats';
import { effectiveness, effectivenessText } from '../typeChart';
import type { BoostKey, Creature, GrowthTable, MajorStatus, MoveData, PokemonData, TypeChart } from '../types';
import { chooseMove } from './ai';
import { attemptCatch } from './catch';
import { calcDamage } from './damage';
import {
  abilityBlocksFoeDrop,
  abilityBlocksStatus,
  abilityEffect,
  abilityName,
  heldEffect,
  heldEvMultiplier,
  heldName,
  heldSpeedMultiplier,
} from './effects';
import { AILMENT_TO_STATUS, canReceiveStatus, STATUS_INFLICT_TEXT } from './status';
import {
  EMPTY_BOOSTS,
  type BattleEvent,
  type BattleOutcome,
  type BattleState,
  type Boosts,
  type PlayerAction,
  type SideIndex,
  type Volatile,
} from './types';

export interface TurnResult {
  state: BattleState;
  events: BattleEvent[];
}

const baseMeta = {
  ailment: 'none',
  ailmentChance: 0,
  category: 'damage',
  minHits: null,
  maxHits: null,
  minTurns: null,
  maxTurns: null,
  drain: 0,
  healing: 0,
  critRate: 0,
  flinchChance: 0,
  statChance: 0,
};

/** Ruch awaryjny, gdy stworzeniu skończą się PP (bez typu, z odrzutem). */
export const STRUGGLE: MoveData = {
  name: 'struggle',
  displayName: 'Szamotanina',
  type: 'normal',
  power: RULES.strugglePower,
  accuracy: null,
  pp: 1,
  priority: 0,
  damageClass: 'physical',
  target: 'selected-pokemon',
  effectChance: null,
  meta: { ...baseMeta, drain: -25 },
  statChanges: [],
};

const CONFUSION_HIT: MoveData = { ...STRUGGLE, name: 'confusion-hit', displayName: 'Zamroczenie', power: RULES.confusionSelfHitPower, meta: { ...baseMeta } };

function unknownMove(name: string): MoveData {
  return { ...STRUGGLE, name, displayName: name, power: 40, meta: { ...baseMeta } };
}

const STATUS_NAME: Record<MajorStatus, string> = {
  par: 'paraliżem',
  slp: 'snem',
  frz: 'zamrożeniem',
  brn: 'oparzeniem',
  psn: 'zatruciem',
};

const STAT_NAME: Record<BoostKey, string> = {
  atk: 'Atak',
  def: 'Obrona',
  spa: 'Sp. atak',
  spd: 'Sp. obrona',
  spe: 'Szybkość',
  acc: 'Celność',
  eva: 'Unik',
};

const msg = (text: string): BattleEvent => ({ t: 'msg', text });
const other = (side: SideIndex): SideIndex => (side === 0 ? 1 : 0);

// ───────────────────────────── pomocnicze ─────────────────────────────

export function getActive(state: BattleState, side: SideIndex): Creature | null {
  const s = state.sides[side];
  const idx = s.active[0];
  return idx === undefined ? null : (s.party[idx] ?? null);
}

function boostsOf(state: BattleState, uid: string): Boosts {
  if (!state.boosts[uid]) state.boosts[uid] = { ...EMPTY_BOOSTS };
  return state.boosts[uid];
}

function volOf(state: BattleState, uid: string): Volatile {
  if (!state.volatiles[uid]) state.volatiles[uid] = { confusion: 0, flinch: false, faintHandled: false };
  return state.volatiles[uid];
}

export function battleLabel(state: BattleState, side: SideIndex, c: Creature): string {
  const n = displayName(c);
  if (side === 0) return n;
  return state.sides[1].kind === 'wild' ? `Dziki ${n}` : `${n} przeciwnika`;
}

function effectiveSpeed(state: BattleState, c: Creature): number {
  const par = c.status === 'par' ? RULES.paralysisSpeedMultiplier : 1;
  return Math.floor(c.stats.spe * stageMultiplier(boostsOf(state, c.uid).spe) * par * heldSpeedMultiplier(c));
}

function cloneState(s: BattleState): BattleState {
  return {
    ...s,
    sides: structuredClone(s.sides),
    boosts: structuredClone(s.boosts),
    volatiles: structuredClone(s.volatiles),
    participants: [...s.participants],
    pendingLearns: s.pendingLearns.map((p) => ({ ...p })),
    caught: s.caught ? structuredClone(s.caught) : null,
  };
}

function setOutcome(state: BattleState, outcome: BattleOutcome, events: BattleEvent[]): void {
  if (state.outcome) return;
  state.outcome = outcome;
  events.push({ t: 'end', outcome });
}

function applyDamage(
  state: BattleState,
  side: SideIndex,
  c: Creature,
  amount: number,
  events: BattleEvent[],
  extra: { crit?: boolean; eff?: number } = {},
): number {
  const dealt = Math.min(c.hp, Math.max(0, Math.floor(amount)));
  c.hp -= dealt;
  events.push({ t: 'hp', side, uid: c.uid, hp: c.hp, maxHp: c.stats.hp, delta: -dealt, crit: extra.crit, eff: extra.eff });
  if (dealt > 0) pinchBerry(state, side, c, events);
  return dealt;
}

/** Jagoda leczy, gdy PŻ spadną do progu (jednorazowo — przedmiot znika). */
function pinchBerry(state: BattleState, side: SideIndex, c: Creature, events: BattleEvent[]): void {
  const berry = heldEffect(c, 'pinch-berry');
  if (!berry || c.hp <= 0 || c.hp > Math.floor(c.stats.hp * berry.threshold)) return;
  const item = heldName(c);
  c.heldItemId = null;
  const healed = healBy(state, side, c, berry.amount, events);
  events.push(msg(`${battleLabel(state, side, c)} zjada: ${item} i odzyskuje ${healed} PŻ!`));
}

/** Jagoda leczy nałożony status albo dezorientację (jednorazowo). */
function statusBerry(state: BattleState, side: SideIndex, c: Creature, events: BattleEvent[]): void {
  if (!heldEffect(c, 'status-berry')) return;
  const v = volOf(state, c.uid);
  if (!c.status && v.confusion <= 0) return;
  const item = heldName(c);
  c.heldItemId = null;
  if (c.status) {
    c.status = null;
    c.sleepTurns = 0;
    events.push({ t: 'status', side, uid: c.uid, status: null });
  }
  v.confusion = 0;
  events.push(msg(`${battleLabel(state, side, c)} zjada: ${item} i od razu czuje się lepiej!`));
}

function healBy(state: BattleState, side: SideIndex, c: Creature, amount: number, events: BattleEvent[]): number {
  const before = c.hp;
  c.hp = Math.min(c.stats.hp, c.hp + Math.max(0, Math.floor(amount)));
  events.push({ t: 'hp', side, uid: c.uid, hp: c.hp, maxHp: c.stats.hp, delta: c.hp - before });
  return c.hp - before;
}

function inflictStatus(
  state: BattleState,
  side: SideIndex,
  c: Creature,
  status: MajorStatus,
  rng: Rng,
  events: BattleEvent[],
): boolean {
  if (!canReceiveStatus(c, status)) return false;
  if (abilityBlocksStatus(c, status)) {
    events.push(msg(`${battleLabel(state, side, c)}: zdolność ${abilityName(c)} chroni przed ${STATUS_NAME[status]}!`));
    return false;
  }
  c.status = status;
  c.sleepTurns = status === 'slp' ? rng.int(RULES.sleepTurns[0], RULES.sleepTurns[1]) : 0;
  events.push({ t: 'status', side, uid: c.uid, status });
  events.push(msg(`${battleLabel(state, side, c)} ${STATUS_INFLICT_TEXT[status]}`));
  statusBerry(state, side, c, events);
  return true;
}

function confuse(state: BattleState, side: SideIndex, c: Creature, rng: Rng, events: BattleEvent[]): boolean {
  const v = volOf(state, c.uid);
  if (c.hp <= 0 || v.confusion > 0) return false;
  if (abilityEffect(c, 'confusion-immunity')) {
    events.push(msg(`${battleLabel(state, side, c)}: zdolność ${abilityName(c)} chroni przed dezorientacją!`));
    return false;
  }
  v.confusion = rng.int(RULES.confusionTurns[0], RULES.confusionTurns[1]) + 1;
  events.push(msg(`${battleLabel(state, side, c)} jest zdezorientowany!`));
  statusBerry(state, side, c, events);
  return true;
}

/**
 * Zwraca true, jeśli coś wypisano (zmiana, informacja o limicie albo o ochronie zdolnością).
 * `fromFoe` — zmianę wywołuje przeciwnik (zdolności chroniące działają tylko wtedy).
 */
function applyBoost(
  state: BattleState,
  side: SideIndex,
  c: Creature,
  stat: BoostKey,
  change: number,
  events: BattleEvent[],
  silentFail: boolean,
  fromFoe = false,
): boolean {
  const b = boostsOf(state, c.uid);
  const before = b[stat];
  const after = Math.max(-6, Math.min(6, before + change));
  const who = battleLabel(state, side, c);
  if (change < 0 && fromFoe && abilityBlocksFoeDrop(c, stat)) {
    events.push(msg(`${who}: zdolność ${abilityName(c)} nie pozwala obniżyć statystyki ${STAT_NAME[stat].toLowerCase()}!`));
    return true;
  }
  if (after === before) {
    if (silentFail) return false;
    events.push(msg(`${who}: ${STAT_NAME[stat].toLowerCase()} nie może już bardziej ${change > 0 ? 'wzrosnąć' : 'spaść'}!`));
    return true;
  }
  b[stat] = after;
  const d = after - before;
  events.push({ t: 'boost', side, uid: c.uid, stat, change: d });
  const verb = d >= 2 ? 'mocno rośnie' : d > 0 ? 'rośnie' : d <= -2 ? 'mocno spada' : 'spada';
  events.push(msg(`${who}: ${STAT_NAME[stat].toLowerCase()} ${verb}!`));
  return true;
}

function rollHits(move: MoveData, rng: Rng): number {
  const min = move.meta?.minHits;
  const max = move.meta?.maxHits;
  if (!min || !max || max <= 1) return 1;
  if (min === 2 && max === 5) {
    // rozkład 2–5 trafień ważony jak w nowszych zasadach gatunku
    const r = rng.next();
    return r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5;
  }
  return rng.int(min, max);
}

function findPlayerCreature(state: BattleState, uid: string): Creature | undefined {
  return state.sides[0].party.find((c) => c.uid === uid);
}

// ───────────────────────────── tworzenie walki ─────────────────────────────

export interface WildBattleParams {
  playerName: string;
  party: Creature[];
  enemy: Creature;
  pokemon: Record<string, PokemonData>;
  moves: Record<string, MoveData>;
  growth: Record<string, GrowthTable>;
  typeChart: TypeChart;
  captureRate: number;
}

export function createWildBattle(p: WildBattleParams): TurnResult {
  const party = structuredClone(p.party);
  const lead = party.findIndex((c) => c.hp > 0);
  if (lead < 0) throw new Error('Brak sprawnych stworzeń w drużynie.');
  const enemy = structuredClone(p.enemy);
  const state: BattleState = {
    format: 'single',
    turn: 0,
    sides: [
      { kind: 'player', name: p.playerName, party, active: [lead] },
      { kind: 'wild', name: 'Dzikie', party: [enemy], active: [0] },
    ],
    boosts: {},
    volatiles: {},
    pokemon: p.pokemon,
    moves: p.moves,
    growth: p.growth,
    typeChart: p.typeChart,
    captureRate: p.captureRate,
    participants: [party[lead].uid],
    escapeAttempts: 0,
    awaitingSwitch: false,
    outcome: null,
    caught: null,
    pendingLearns: [],
  };
  const events: BattleEvent[] = [];
  const en = displayName(enemy);
  events.push({ t: 'sendOut', side: 1, uid: enemy.uid });
  events.push(msg(enemy.mighty ? `Potężny dziki ${en} zagradza drogę!` : `Dziki ${en} wyskakuje z zarośli!`));
  if (enemy.shiny) events.push(msg('Jego barwy lśnią niezwykłym blaskiem!'));
  events.push({ t: 'sendOut', side: 0, uid: party[lead].uid });
  events.push(msg(`Naprzód, ${displayName(party[lead])}!`));
  // Zdolności działające przy wejściu (np. „Groźne spojrzenie”): najpierw dzikie, potem stworzenie gracza.
  onEntry(state, 1, enemy, events);
  onEntry(state, 0, party[lead], events);
  return { state, events };
}

/** Zdolność działająca przy wejściu do walki: obniżenie statystyki aktywnego przeciwnika. */
function onEntry(state: BattleState, side: SideIndex, c: Creature, events: BattleEvent[]): void {
  const e = abilityEffect(c, 'entry-lower-foe');
  if (!e || c.hp <= 0) return;
  const foeSide = other(side);
  const foe = getActive(state, foeSide);
  if (!foe || foe.hp <= 0) return;
  events.push(msg(`${battleLabel(state, side, c)}: ${abilityName(c)}!`));
  applyBoost(state, foeSide, foe, e.stat, e.change, events, false, true);
}

// ───────────────────────────── przebieg tury ─────────────────────────────

interface QueuedMove {
  side: SideIndex;
  uid: string;
  moveIndex: number;
  priority: number;
  /** Przedmiot „pierwszeństwa” zadziałał w tej turze (w obrębie priorytetu przed szybkością). */
  first: boolean;
  speed: number;
  tie: number;
}

function queueEntry(state: BattleState, side: SideIndex, c: Creature, moveIndex: number, rng: Rng): QueuedMove {
  const slot = moveIndex >= 0 ? c.moves[moveIndex] : undefined;
  const priority = slot ? (state.moves[slot.name]?.priority ?? 0) : 0;
  const claw = heldEffect(c, 'move-first');
  const first = claw ? rng.chance(claw.chance) : false;
  return { side, uid: c.uid, moveIndex, priority, first, speed: effectiveSpeed(state, c), tie: rng.next() };
}

export function resolveTurn(input: BattleState, action: PlayerAction, rng: Rng): TurnResult {
  const state = cloneState(input);
  const events: BattleEvent[] = [];
  if (state.outcome || state.awaitingSwitch) return { state, events };
  if (!getActive(state, 0) || !getActive(state, 1)) return { state, events };

  state.turn += 1;
  for (const v of Object.values(state.volatiles)) v.flinch = false;

  // 1) Akcje wykonywane przed ruchami: ucieczka, zmiana, przedmiot.
  if (action.kind === 'run') {
    if (tryRun(state, rng, events)) return { state, events };
  } else if (action.kind === 'switch') {
    switchIn(state, 0, action.partyIndex, events);
  } else if (action.kind === 'item') {
    useItem(state, action.item, action.targetUid, rng, events);
    if (state.outcome) return { state, events };
  }

  // 2) Ruchy w kolejności: priorytet → szybkość → losowo.
  const player = getActive(state, 0)!;
  const enemy = getActive(state, 1)!;
  const queue: QueuedMove[] = [];
  if (action.kind === 'move') {
    const slot = player.moves[action.moveIndex];
    const idx = slot && slot.pp > 0 ? action.moveIndex : -1;
    queue.push(queueEntry(state, 0, player, idx, rng));
  }
  const aiMode = state.sides[1].kind === 'trainer' ? 'smart' : 'random';
  const enemyMove = chooseMove(enemy, player, state.moves, state.typeChart, rng, aiMode);
  queue.push(queueEntry(state, 1, enemy, enemyMove, rng));
  queue.sort((a, b) => b.priority - a.priority || Number(b.first) - Number(a.first) || b.speed - a.speed || a.tie - b.tie);

  for (const q of queue) {
    if (state.outcome || state.awaitingSwitch) break;
    const user = getActive(state, q.side);
    if (!user || user.uid !== q.uid || user.hp <= 0) continue;
    const target = getActive(state, other(q.side));
    if (!target || target.hp <= 0) continue;
    if (q.first) events.push(msg(`${battleLabel(state, q.side, user)} rusza błyskawicznie dzięki: ${heldName(user)}!`));
    executeMove(state, q.side, user, target, q.moveIndex, rng, events);
    handleFaints(state, events);
  }

  // 3) Efekty końca tury (zdolności, oparzenie, trucizna, przedmioty leczące).
  if (!state.outcome) {
    endOfTurn(state, rng, events);
    handleFaints(state, events);
  }
  return { state, events };
}

/** Wymuszona zmiana po omdleniu aktywnego stworzenia gracza (nie zużywa tury). */
export function forceSwitch(input: BattleState, partyIndex: number): TurnResult {
  const state = cloneState(input);
  const events: BattleEvent[] = [];
  if (!state.awaitingSwitch) return { state, events };
  if (switchIn(state, 0, partyIndex, events)) state.awaitingSwitch = false;
  return { state, events };
}

function tryRun(state: BattleState, rng: Rng, events: BattleEvent[]): boolean {
  if (state.sides[1].kind !== 'wild') {
    events.push(msg('Z walki z tropicielem nie można uciec!'));
    return false;
  }
  state.escapeAttempts += 1;
  const runner = getActive(state, 0)!;
  if (abilityEffect(runner, 'sure-escape')) {
    events.push(msg(`${displayName(runner)}: zdolność ${abilityName(runner)} — ucieczka zawsze się udaje!`));
    events.push(msg('Udało się bezpiecznie uciec!'));
    setOutcome(state, 'fled', events);
    return true;
  }
  const ps = effectiveSpeed(state, runner);
  const es = effectiveSpeed(state, getActive(state, 1)!);
  let ok = ps >= es;
  if (!ok) {
    const f = Math.floor((ps * 128) / Math.max(1, es)) + 30 * state.escapeAttempts;
    ok = f > 255 || rng.int(0, 255) < f;
  }
  if (ok) {
    events.push(msg('Udało się bezpiecznie uciec!'));
    setOutcome(state, 'fled', events);
    return true;
  }
  events.push(msg('Nie udało się uciec!'));
  return false;
}

function switchIn(state: BattleState, side: SideIndex, idx: number, events: BattleEvent[]): boolean {
  const s = state.sides[side];
  const incoming = s.party[idx];
  if (!incoming || incoming.hp <= 0) return false;
  const current = getActive(state, side);
  if (current && current.uid === incoming.uid) return false;
  if (current) {
    state.boosts[current.uid] = { ...EMPTY_BOOSTS };
    const v = volOf(state, current.uid);
    v.confusion = 0;
    v.flinch = false;
    if (current.hp > 0) {
      events.push(msg(side === 0 ? `Wróć, ${displayName(current)}!` : `${s.name} wycofuje: ${displayName(current)}.`));
      events.push({ t: 'withdraw', side, uid: current.uid });
    }
  }
  s.active[0] = idx;
  volOf(state, incoming.uid).faintHandled = false;
  events.push({ t: 'sendOut', side, uid: incoming.uid });
  events.push(msg(side === 0 ? `Naprzód, ${displayName(incoming)}!` : `${s.name} wysyła: ${displayName(incoming)}!`));
  if (side === 0 && !state.participants.includes(incoming.uid)) state.participants.push(incoming.uid);
  onEntry(state, side, incoming, events);
  return true;
}

function useItem(
  state: BattleState,
  itemId: ItemId,
  targetUid: string | undefined,
  rng: Rng,
  events: BattleEvent[],
): void {
  const def = ITEMS[itemId];
  if (!def) return;
  const trainer = state.sides[0].name;

  if (def.kind === 'capture') {
    const enemy = getActive(state, 1)!;
    if (state.sides[1].kind !== 'wild') {
      events.push(msg('Nie można łapać stworzeń innego tropiciela!'));
      return;
    }
    events.push(msg(`${trainer} rzuca: ${def.name}!`));
    const res = attemptCatch(
      {
        maxHp: enemy.stats.hp,
        hp: enemy.hp,
        captureRate: state.captureRate,
        catchBonus: def.catchBonus ?? 1,
        status: enemy.status,
      },
      rng,
    );
    events.push({ t: 'capsule', item: def.id, shakes: res.shakes, caught: res.caught });
    if (res.caught) {
      events.push(msg(`Udało się! ${displayName(enemy)} zostaje złapany!`));
      const caught = structuredClone(enemy);
      caught.caughtAt = Date.now();
      state.caught = caught;
      if (RULES.expOnCatch) awardExp(state, enemy, events);
      setOutcome(state, 'caught', events);
    } else {
      const lines = ['Och! Wyrwał się od razu!', 'Prawie… ale się wyrwał!', 'Tak blisko!', 'Ech! Zabrakło ułamka sekundy!'];
      events.push(msg(lines[res.shakes] ?? 'Wyrwał się!'));
    }
    return;
  }

  const target = (targetUid ? findPlayerCreature(state, targetUid) : undefined) ?? getActive(state, 0)!;
  events.push(msg(`${trainer} używa: ${def.name}.`));
  if (def.kind === 'heal') {
    if (target.hp <= 0) {
      events.push(msg('To nie zadziała na wyczerpane stworzenie.'));
      return;
    }
    const healed = healBy(state, 0, target, def.healAmount ?? 0, events);
    events.push(msg(`${displayName(target)} odzyskuje ${healed} PŻ.`));
  } else if (def.kind === 'cure') {
    const v = volOf(state, target.uid);
    if (target.status || v.confusion > 0) {
      target.status = null;
      target.sleepTurns = 0;
      v.confusion = 0;
      events.push({ t: 'status', side: 0, uid: target.uid, status: null });
      events.push(msg(`${displayName(target)} czuje się znacznie lepiej!`));
    } else {
      events.push(msg('Ale nic się nie zmienia.'));
    }
  }
}

function executeMove(
  state: BattleState,
  side: SideIndex,
  user: Creature,
  target: Creature,
  moveIndex: number,
  rng: Rng,
  events: BattleEvent[],
): void {
  const name = battleLabel(state, side, user);
  const foeSide = other(side);
  const vol = volOf(state, user.uid);

  // — statusy blokujące ruch —
  if (user.status === 'slp') {
    if (user.sleepTurns > 0) {
      // „Ranny ptaszek”: sen mija dwa razy szybciej.
      user.sleepTurns = Math.max(0, user.sleepTurns - (abilityEffect(user, 'fast-wake') ? 2 : 1));
      events.push(msg(`${name} śpi głęboko.`));
      return;
    }
    user.status = null;
    events.push({ t: 'status', side, uid: user.uid, status: null });
    events.push(msg(`${name} budzi się!`));
  }
  if (user.status === 'frz') {
    if (rng.chance(RULES.freezeThawChance)) {
      user.status = null;
      events.push({ t: 'status', side, uid: user.uid, status: null });
      events.push(msg(`${name} odtaja!`));
    } else {
      events.push(msg(`${name} jest zamrożony i nie może się ruszyć!`));
      return;
    }
  }
  if (vol.flinch) {
    vol.flinch = false;
    events.push(msg(`${name} wzdryga się i nie atakuje!`));
    return;
  }
  if (vol.confusion > 0) {
    vol.confusion -= 1;
    if (vol.confusion === 0) {
      events.push(msg(`${name} nie jest już zdezorientowany.`));
    } else {
      events.push(msg(`${name} jest zdezorientowany!`));
      if (rng.chance(RULES.confusionSelfHitChance)) {
        const r = calcDamage({
          attacker: user,
          defender: user,
          attackerBoosts: boostsOf(state, user.uid),
          defenderBoosts: boostsOf(state, user.uid),
          move: CONFUSION_HIT,
          chart: state.typeChart,
          rng,
          typeless: true,
          forceCrit: false,
        });
        applyDamage(state, side, user, r.damage, events);
        events.push(msg('Rani sam siebie w zamroczeniu!'));
        return;
      }
    }
  }
  if (user.status === 'par' && rng.chance(RULES.paralysisSkipChance)) {
    events.push(msg(`${name} jest sparaliżowany i nie może się ruszyć!`));
    return;
  }

  // — wybór ruchu i zużycie PP —
  let move: MoveData;
  const slot = moveIndex >= 0 ? user.moves[moveIndex] : undefined;
  if (!slot || slot.pp <= 0) {
    move = STRUGGLE;
    events.push(msg(`${name} nie ma już PP na żaden ruch!`));
  } else {
    slot.pp -= 1;
    move = state.moves[slot.name] ?? unknownMove(slot.name);
  }
  events.push({ t: 'useMove', side, uid: user.uid, move: move.name, moveType: move.type });
  events.push(msg(`${name} używa: ${move.displayName}!`));

  // — celność —
  const selfTarget = targetsUser(move);
  if (!selfTarget && move.accuracy !== null) {
    const stage = boostsOf(state, user.uid).acc - boostsOf(state, target.uid).eva;
    const chance = (move.accuracy / 100) * accuracyStageMultiplier(stage);
    if (!rng.chance(chance)) {
      events.push({ t: 'miss', side, uid: user.uid });
      events.push(msg('Atak chybia!'));
      return;
    }
  }

  if (move.damageClass === 'status') {
    applyStatusMove(state, side, user, target, move, rng, events);
    return;
  }

  const typeless = move === STRUGGLE;
  // „Chłonięcie wody”: ruch danego typu leczy cel zamiast zadawać obrażenia.
  const absorb = typeless ? null : abilityEffect(target, 'absorb-type');
  if (absorb && move.type === absorb.type) {
    const healed = target.hp < target.stats.hp ? healBy(state, foeSide, target, Math.max(1, Math.floor(target.stats.hp * absorb.healFraction)), events) : 0;
    events.push(
      msg(
        healed > 0
          ? `${battleLabel(state, foeSide, target)}: zdolność ${abilityName(target)} — odzyskuje ${healed} PŻ!`
          : `${battleLabel(state, foeSide, target)}: zdolność ${abilityName(target)} — ruch nie działa!`,
      ),
    );
    return;
  }
  const eff = typeless ? 1 : effectiveness(state.typeChart, move.type, target.types);
  if (eff === 0) {
    events.push(msg('Ten ruch nie działa na cel…'));
    return;
  }

  if (move.meta?.category === 'ohko') {
    if (user.level < target.level) {
      events.push(msg('Ale nic się nie dzieje…'));
      return;
    }
    applyDamage(state, foeSide, target, target.hp, events, { eff: 1 });
    events.push(msg('Nokaut jednym ciosem!'));
    return;
  }

  // — obrażenia (z obsługą wielokrotnych trafień) —
  const hits = rollHits(move, rng);
  let total = 0;
  let landed = 0;
  for (let i = 0; i < hits; i++) {
    if (target.hp <= 0 || user.hp <= 0) break;
    const r = calcDamage({
      attacker: user,
      defender: target,
      attackerBoosts: boostsOf(state, user.uid),
      defenderBoosts: boostsOf(state, target.uid),
      move,
      chart: state.typeChart,
      rng,
      typeless,
    });
    total += applyDamage(state, foeSide, target, r.damage, events, { crit: r.crit, eff: r.effectiveness });
    landed += 1;
    if (r.crit) events.push(msg('Trafienie krytyczne!'));
  }
  if (hits > 1) events.push(msg(`Liczba trafień: ${landed}.`));
  const effText = effectivenessText(eff);
  if (effText) events.push(msg(effText));

  const meta = move.meta;
  // — drenaż i odrzut —
  if (meta && total > 0 && user.hp > 0) {
    if (meta.drain > 0 && user.hp < user.stats.hp) {
      healBy(state, side, user, Math.max(1, Math.floor((total * meta.drain) / 100)), events);
      events.push(msg(`${name} wysysa energię z celu!`));
    } else if (meta.drain < 0) {
      applyDamage(state, side, user, Math.max(1, Math.floor((total * -meta.drain) / 100)), events);
      events.push(msg(`${name} otrzymuje obrażenia zwrotne!`));
    }
  }

  // — efekty dodatkowe („Pyłek osłonny” celu je blokuje) —
  const shielded = !!abilityEffect(target, 'block-secondary');
  if (meta && target.hp > 0 && !shielded) {
    if (meta.ailmentChance > 0 && rng.chance(meta.ailmentChance / 100)) {
      const st = AILMENT_TO_STATUS[meta.ailment];
      if (st) inflictStatus(state, foeSide, target, st, rng, events);
      else if (meta.ailment === 'confusion') confuse(state, foeSide, target, rng, events);
    }
    if (meta.flinchChance > 0 && rng.chance(meta.flinchChance / 100)) volOf(state, target.uid).flinch = true;
  }
  if (move.statChanges.length) {
    const toUser = statChangeHitsUser(move);
    if (toUser || !shielded) {
      const chance = meta && meta.statChance > 0 ? meta.statChance : 100;
      if (rng.chance(chance / 100)) {
        const recipient = toUser ? user : target;
        const rSide = toUser ? side : foeSide;
        if (recipient.hp > 0) {
          for (const sc of move.statChanges) applyBoost(state, rSide, recipient, sc.stat, sc.change, events, true, !toUser);
        }
      }
    }
  }
}

function applyStatusMove(
  state: BattleState,
  side: SideIndex,
  user: Creature,
  target: Creature,
  move: MoveData,
  rng: Rng,
  events: BattleEvent[],
): void {
  const meta = move.meta;
  const name = battleLabel(state, side, user);
  const foeSide = other(side);
  let did = false;

  // Odpoczynek: pełne leczenie + sen (ogólny opis działania).
  if (move.name === 'rest') {
    if (user.hp >= user.stats.hp) {
      events.push(msg(`${name} ma już pełne PŻ!`));
      return;
    }
    if (abilityBlocksStatus(user, 'slp')) {
      events.push(msg(`${name}: zdolność ${abilityName(user)} nie pozwala zasnąć!`));
      return;
    }
    healBy(state, side, user, user.stats.hp, events);
    user.status = 'slp';
    user.sleepTurns = 2;
    events.push({ t: 'status', side, uid: user.uid, status: 'slp' });
    events.push(msg(`${name} zasypia i odzyskuje siły!`));
    return;
  }

  if (meta && meta.healing > 0 && (meta.category === 'heal' || targetsUser(move))) {
    if (user.hp >= user.stats.hp) {
      events.push(msg(`${name} ma już pełne PŻ!`));
      return;
    }
    healBy(state, side, user, Math.max(1, Math.floor((user.stats.hp * meta.healing) / 100)), events);
    events.push(msg(`${name} odzyskuje siły!`));
    did = true;
  }

  if (meta) {
    const st = AILMENT_TO_STATUS[meta.ailment];
    const self = targetsUser(move);
    const victim = self ? user : target;
    const vSide = self ? side : foeSide;
    if (st) {
      if (st === 'par' && move.type === 'electric' && effectiveness(state.typeChart, 'electric', victim.types) === 0) {
        events.push(msg('Ten ruch nie działa na cel…'));
        return;
      }
      did = inflictStatus(state, vSide, victim, st, rng, events) || did;
      // Ochrona zdolnością już wypisała komunikat.
      if (canReceiveStatus(victim, st) && abilityBlocksStatus(victim, st)) did = true;
    } else if (meta.ailment === 'confusion') {
      did = confuse(state, vSide, victim, rng, events) || did;
      if (abilityEffect(victim, 'confusion-immunity') && victim.hp > 0) did = true;
    }
  }

  if (move.statChanges.length) {
    const toUser = statChangeHitsUser(move);
    const recipient = toUser ? user : target;
    const rSide = toUser ? side : foeSide;
    for (const sc of move.statChanges) did = applyBoost(state, rSide, recipient, sc.stat, sc.change, events, false, !toUser) || did;
  }

  if (!did) events.push(msg('Ale nic się nie dzieje…'));
}

function endOfTurn(state: BattleState, rng: Rng, events: BattleEvent[]): void {
  for (const side of [0, 1] as SideIndex[]) {
    const c = getActive(state, side);
    if (!c || c.hp <= 0) continue;
    // „Zrzucanie skóry”: szansa na wyleczenie statusu.
    const cure = abilityEffect(c, 'end-turn-cure');
    if (cure && c.status && rng.chance(cure.chance)) {
      c.status = null;
      c.sleepTurns = 0;
      events.push({ t: 'status', side, uid: c.uid, status: null });
      events.push(msg(`${battleLabel(state, side, c)}: zdolność ${abilityName(c)} leczy status!`));
    }
    if (c.status === 'brn' || c.status === 'psn') {
      const frac = c.status === 'brn' ? RULES.burnDamage : RULES.poisonDamage;
      const kind = c.status === 'brn' ? 'oparzenia' : 'trucizny';
      applyDamage(state, side, c, Math.max(1, Math.floor(c.stats.hp * frac)), events);
      events.push(msg(`${battleLabel(state, side, c)} cierpi z powodu ${kind}!`));
    }
    // Przedmiot leczący co turę.
    const leftovers = heldEffect(c, 'end-turn-heal');
    if (leftovers && c.hp > 0 && c.hp < c.stats.hp) {
      const healed = healBy(state, side, c, Math.max(1, Math.floor(c.stats.hp * leftovers.fraction)), events);
      events.push(msg(`${battleLabel(state, side, c)} odzyskuje ${healed} PŻ dzięki: ${heldName(c)}.`));
    }
  }
}

function handleFaints(state: BattleState, events: BattleEvent[]): void {
  const enemy = getActive(state, 1);
  if (enemy && enemy.hp <= 0 && !volOf(state, enemy.uid).faintHandled) {
    volOf(state, enemy.uid).faintHandled = true;
    events.push({ t: 'faint', side: 1, uid: enemy.uid });
    events.push(msg(`${battleLabel(state, 1, enemy)} mdleje!`));
    awardExp(state, enemy, events);
    const next = state.sides[1].party.findIndex((c) => c.hp > 0);
    if (next >= 0) {
      // Tropiciele z wieloma stworzeniami — etap 2.
      switchIn(state, 1, next, events);
      const lead = getActive(state, 0);
      state.participants = lead && lead.hp > 0 ? [lead.uid] : [];
    } else {
      setOutcome(state, 'win', events);
    }
  }

  const player = getActive(state, 0);
  if (player && player.hp <= 0 && !volOf(state, player.uid).faintHandled) {
    volOf(state, player.uid).faintHandled = true;
    events.push({ t: 'faint', side: 0, uid: player.uid });
    events.push(msg(`${displayName(player)} mdleje!`));
    state.participants = state.participants.filter((u) => u !== player.uid);
    if (!state.outcome) {
      if (state.sides[0].party.some((c) => c.hp > 0)) {
        state.awaitingSwitch = true;
        events.push({ t: 'needSwitch' });
      } else {
        events.push(msg('Nie masz już sprawnych stworzeń…'));
        setOutcome(state, 'lose', events);
      }
    }
  }
}

function awardExp(state: BattleState, defeated: Creature, events: BattleEvent[]): void {
  if (state.sides[0].kind !== 'player') return;
  const data = state.pokemon[defeated.pokemon];
  const alive = state.participants
    .map((uid) => findPlayerCreature(state, uid))
    .filter((c): c is Creature => !!c && c.hp > 0);
  if (!alive.length) return;
  const each = expYield(data?.baseExp ?? 50, defeated.level, {
    trainer: state.sides[1].kind === 'trainer',
    participants: alive.length,
  });
  for (const c of alive) {
    if (data) {
      const mult = heldEvMultiplier(c);
      const gain = mult === 1 ? data.evYield : (Object.fromEntries(Object.entries(data.evYield).map(([k, v]) => [k, v * mult])) as typeof data.evYield);
      c.evs = addEvs(c.evs, gain);
    }
    gainExp(state, c, each, events);
  }
}

function gainExp(state: BattleState, c: Creature, amount: number, events: BattleEvent[]): void {
  if (c.level >= RULES.maxLevel) return;
  const table = state.growth[c.growthRate];
  if (!table) return;
  c.exp += amount;
  events.push(msg(`${displayName(c)} zdobywa ${amount} pkt. doświadczenia!`));
  events.push({ t: 'exp', uid: c.uid, exp: c.exp, level: c.level, gained: amount });
  const data = state.pokemon[c.pokemon];
  while (c.level < RULES.maxLevel && c.exp >= expForLevel(table, c.level + 1)) {
    const oldMax = c.stats.hp;
    c.level += 1;
    if (data) {
      c.stats = calcStats(data.baseStats, c.ivs, c.evs, c.level, c.nature);
      if (c.hp > 0) c.hp = Math.min(c.stats.hp, c.hp + Math.max(0, c.stats.hp - oldMax));
    }
    events.push({ t: 'levelUp', uid: c.uid, level: c.level, hp: c.hp, maxHp: c.stats.hp });
    events.push(msg(`${displayName(c)} osiąga poziom ${c.level}!`));
    events.push({ t: 'exp', uid: c.uid, exp: c.exp, level: c.level, gained: 0 });
    if (data) {
      for (const m of newMovesAtLevel(data.levelMoves, c.level)) {
        const known = c.moves.some((s) => s.name === m);
        const queued = state.pendingLearns.some((p) => p.uid === c.uid && p.move === m);
        if (!known && !queued) state.pendingLearns.push({ uid: c.uid, move: m });
      }
    }
  }
}
