// Próby Szlaku (Sprint 6): stan Próby dla gracza, wymagania, zwycięstwo przyznające odznakę dokładnie raz,
// efekty odznak (odblokowanie przejść), naprawa spójności zapisu i walidacja danych. Czyste funkcje —
// stan gry zmienia gameStore.completeChallenge, a walkę prowadzi encounterService (ten sam silnik co trenerzy).

import { BADGES, CHALLENGES, LEADERS, type BadgeDef, type ChallengeDef } from '../config/challenges';
import { ITEMS, type ItemId } from '../config/items';
import { TRAINERS } from '../config/trainers';
import { WORLD, type WorldDef } from '../config/world';
import { TYPE_NAMES } from '../engine/types';
import { getLocation, getRegion, requirementsMet, type ProgressState } from './world';

/** Postęp potrzebny do Prób: flagi, torba i trzy listy z zapisu v4. */
export interface ChallengeProgress extends ProgressState {
  earnedBadges: readonly string[];
  completedChallenges: readonly string[];
  unlockedConnections: readonly string[];
}

/**
 * Stan Próby dla gracza:
 * UNAVAILABLE — Próba nie jest wdrożona (brak lidera na mapie);
 * LOCKED — wymagania (odznaki, wydarzenia) niespełnione: lider odmawia, walki nie ma;
 * AVAILABLE — można podjąć walkę;
 * COMPLETED — ukończona: rozmowa bez walki i bez nagrody.
 */
export type ChallengeState = 'UNAVAILABLE' | 'LOCKED' | 'AVAILABLE' | 'COMPLETED';

export function getChallenge(id: string | undefined | null, list: readonly ChallengeDef[] = CHALLENGES): ChallengeDef | undefined {
  return id ? list.find((c) => c.id === id) : undefined;
}

export function getBadge(id: string | undefined | null, list: readonly BadgeDef[] = BADGES): BadgeDef | undefined {
  return id ? list.find((b) => b.id === id) : undefined;
}

/** Odznaki w kolejności wyświetlania. */
export function badgesInOrder(list: readonly BadgeDef[] = BADGES): BadgeDef[] {
  return [...list].sort((a, b) => a.displayOrder - b.displayOrder);
}

export function isChallengeCompleted(c: ChallengeDef, p: Pick<ChallengeProgress, 'completedChallenges' | 'flags'>): boolean {
  return p.completedChallenges.includes(c.id) || !!p.flags[c.completionEventId];
}

export function challengeRequirementsMet(c: ChallengeDef, p: ProgressState): boolean {
  return requirementsMet({ badges: c.requiredBadges, events: c.requiredEvents }, p);
}

export function challengeState(c: ChallengeDef, p: ChallengeProgress): ChallengeState {
  if (c.status !== 'IMPLEMENTED') return 'UNAVAILABLE';
  if (isChallengeCompleted(c, p)) return 'COMPLETED';
  return challengeRequirementsMet(c, p) ? 'AVAILABLE' : 'LOCKED';
}

/** Czytelna lista brakujących wymagań (Dziennik, testy). */
export function missingRequirements(c: ChallengeDef, p: ProgressState, badges: readonly BadgeDef[] = BADGES): string[] {
  const out: string[] = [];
  for (const b of c.requiredBadges) {
    if (!(p.earnedBadges ?? []).includes(b)) out.push(`odznaka: ${getBadge(b, badges)?.name ?? b}`);
  }
  for (const e of c.requiredEvents) if (!p.flags[e]) out.push(eventLabel(e));
  return out;
}

/** Opis wydarzenia wymaganego przez Próbę (pokonanie trenera, ukończenie innej Próby). */
export function eventLabel(eventId: string): string {
  const trainer = TRAINERS.find((t) => t.defeatedEventId === eventId);
  if (trainer) return `pokonaj: ${trainer.name}`;
  const ch = CHALLENGES.find((c) => c.completionEventId === eventId);
  if (ch) return `ukończ: ${ch.name}`;
  return eventId;
}

/** Przejścia otwierane przez zdobyte odznaki (bez powtórzeń, w kolejności odznak). */
export function unlocksOf(badgeIds: readonly string[], badges: readonly BadgeDef[] = BADGES): string[] {
  const out: string[] = [];
  for (const id of badgeIds) {
    for (const e of getBadge(id, badges)?.unlockEffects ?? []) {
      if (e.kind === 'UNLOCK_CONNECTION' && !out.includes(e.connectionId)) out.push(e.connectionId);
    }
  }
  return out;
}

const addUnique = (list: readonly string[], items: readonly string[]) => [...list, ...items.filter((x, i) => !list.includes(x) && items.indexOf(x) === i)];

/** Zmiana stanu po pierwszym zwycięstwie w Próbie. */
export interface ChallengeVictory {
  completedChallenges: string[];
  earnedBadges: string[];
  unlockedConnections: string[];
  flags: Record<string, boolean>;
  /** Odznaka przyznana teraz (null — gracz już ją miał). */
  badge: BadgeDef | null;
  /** Przejścia otwarte teraz (wcześniej zamknięte). */
  unlocked: string[];
}

/**
 * Pierwsze zwycięstwo: ukończenie Próby, wydarzenie ukończenia, odznaka i jej odblokowania.
 * null — Próba była już ukończona (nic się nie zmienia: brak duplikacji odznaki i nagród).
 */
export function challengeVictory(c: ChallengeDef, p: ChallengeProgress, badges: readonly BadgeDef[] = BADGES): ChallengeVictory | null {
  if (isChallengeCompleted(c, p)) return null;
  const badge = getBadge(c.rewardBadgeId, badges);
  const newBadge = badge && !p.earnedBadges.includes(badge.id) ? badge : null;
  const earnedBadges = badge ? addUnique(p.earnedBadges, [badge.id]) : [...p.earnedBadges];
  const opened = unlocksOf(earnedBadges, badges);
  const unlocked = opened.filter((id) => !p.unlockedConnections.includes(id));
  return {
    completedChallenges: addUnique(p.completedChallenges, [c.id]),
    earnedBadges,
    unlockedConnections: addUnique(p.unlockedConnections, opened),
    flags: { ...p.flags, [c.completionEventId]: true },
    badge: newBadge,
    unlocked,
  };
}

/** Nagroda dodatkowa Próby (pieniądze i znane przedmioty o dodatniej liczbie). */
export function challengeRewardItems(c: ChallengeDef): [ItemId, number][] {
  return (Object.entries(c.optionalRewards.items ?? {}) as [ItemId, number][]).filter(([id, n]) => id in ITEMS && n > 0);
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);
const dedupe = (list: string[]) => list.filter((x, i) => list.indexOf(x) === i);

/**
 * Spójność postępu Prób w zapisie (migracja i każde wczytanie — idempotentne):
 * listy unikalnych napisów; ukończona Próba (lista lub wydarzenie) ⇒ jej wydarzenie i odznaka;
 * zdobyta odznaka ⇒ jej odblokowania. Niczego nie odbiera.
 */
export function normalizeProgression(
  data: { flags?: unknown; earnedBadges?: unknown; completedChallenges?: unknown; unlockedConnections?: unknown },
  challenges: readonly ChallengeDef[] = CHALLENGES,
  badges: readonly BadgeDef[] = BADGES,
): { flags: Record<string, boolean>; earnedBadges: string[]; completedChallenges: string[]; unlockedConnections: string[] } {
  const rawFlags = typeof data.flags === 'object' && data.flags !== null && !Array.isArray(data.flags) ? (data.flags as Record<string, unknown>) : {};
  const flags: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(rawFlags)) if (typeof v === 'boolean') flags[k] = v;
  const completedChallenges = dedupe(strings(data.completedChallenges));
  for (const c of challenges) {
    if (flags[c.completionEventId] && !completedChallenges.includes(c.id)) completedChallenges.push(c.id);
    if (completedChallenges.includes(c.id)) flags[c.completionEventId] = true;
  }
  const earnedBadges = dedupe(strings(data.earnedBadges));
  for (const c of challenges) {
    if (completedChallenges.includes(c.id) && getBadge(c.rewardBadgeId, badges) && !earnedBadges.includes(c.rewardBadgeId)) earnedBadges.push(c.rewardBadgeId);
  }
  const unlockedConnections = addUnique(dedupe(strings(data.unlockedConnections)), unlocksOf(earnedBadges, badges));
  return { flags, earnedBadges, completedChallenges, unlockedConnections };
}

// ───────────────────────────── walidacja danych ─────────────────────────────

export interface ChallengeIssue {
  code:
    | 'DUPLICATE_ID'
    | 'DUPLICATE_EVENT'
    | 'MISSING_LOCATION'
    | 'MISSING_REGION'
    | 'MISSING_LEADER'
    | 'MISSING_BADGE'
    | 'INVALID_UNLOCK'
    | 'INVALID_REQUIREMENT'
    | 'INVALID_VALUE';
  ref: string;
  message: string;
}

/**
 * Spójność Prób, liderów i odznak (drużynę lidera sprawdza validateTrainers — lider jest trenerem).
 * Testy jednostkowe + konsola w trybie ?debug.
 */
export function validateChallenges(
  challenges: readonly ChallengeDef[] = CHALLENGES,
  leaders = LEADERS,
  badges: readonly BadgeDef[] = BADGES,
  world: WorldDef = WORLD,
): ChallengeIssue[] {
  const issues: ChallengeIssue[] = [];
  const add = (code: ChallengeIssue['code'], ref: string, message: string) => issues.push({ code, ref, message });
  const seen = (ids: string[], what: string) => {
    const s = new Set<string>();
    for (const id of ids) {
      if (s.has(id)) add('DUPLICATE_ID', id, `Powtórzony identyfikator (${what}): ${id}`);
      s.add(id);
    }
  };
  seen(challenges.map((c) => c.id), 'wyzwanie');
  seen(badges.map((b) => b.id), 'odznaka');
  seen(leaders.map((l) => l.id), 'lider');
  const knownEvents = new Set([...TRAINERS.map((t) => t.defeatedEventId), ...challenges.map((c) => c.completionEventId)]);
  const events = new Set<string>();
  const connections = new Map(world.locations.flatMap((l) => l.connections.map((c) => [c.id, c] as const)));

  for (const c of challenges) {
    if (!c.name.trim()) add('INVALID_VALUE', c.id, 'Pusta nazwa Próby');
    if (!getRegion(c.regionId, world)) add('MISSING_REGION', c.id, `Nieznany region: ${c.regionId}`);
    const loc = getLocation(c.locationId, world);
    if (!loc) add('MISSING_LOCATION', c.id, `Nieznana lokacja: ${c.locationId}`);
    else if (loc.regionId !== c.regionId) add('INVALID_VALUE', c.id, `Lokacja ${loc.id} należy do innego regionu`);
    if (!(TYPE_NAMES as readonly string[]).includes(c.specialization)) add('INVALID_VALUE', c.id, `Nieznana specjalizacja: ${c.specialization}`);
    if (!c.team.length) add('INVALID_VALUE', c.id, 'Lider musi mieć drużynę');
    if (!c.completionEventId || events.has(c.completionEventId) || TRAINERS.some((t) => t.defeatedEventId === c.completionEventId)) {
      add('DUPLICATE_EVENT', c.id, `Pusty lub powtórzony completionEventId: ${c.completionEventId}`);
    }
    events.add(c.completionEventId);
    const d = c.dialogue;
    if (!d.locked.length || !d.before.length || !d.victory.length || !d.after.length) add('INVALID_VALUE', c.id, 'Brak któregoś z dialogów Próby');
    if (!(c.optionalRewards.money >= 0)) add('INVALID_VALUE', c.id, 'Nagroda pieniężna nie może być ujemna');
    for (const [item, n] of Object.entries(c.optionalRewards.items ?? {})) {
      if (!(item in ITEMS) || !(Number(n) > 0)) add('INVALID_VALUE', c.id, `Nieprawidłowa nagroda: ${item} ×${String(n)}`);
    }
    if (!c.arenaTriggers.length) add('INVALID_VALUE', c.id, 'Próba potrzebuje pola wejścia na arenę');

    const badge = getBadge(c.rewardBadgeId, badges);
    if (!badge) add('MISSING_BADGE', c.id, `Nieznana odznaka nagrody: ${c.rewardBadgeId}`);
    else if (badge.challengeId !== c.id) add('MISSING_BADGE', c.id, `Odznaka ${badge.id} należy do innej Próby (${badge.challengeId})`);
    for (const b of c.requiredBadges) {
      if (!getBadge(b, badges)) add('INVALID_REQUIREMENT', c.id, `Nieznana wymagana odznaka: ${b}`);
      if (b === c.rewardBadgeId) add('INVALID_REQUIREMENT', c.id, 'Próba nie może wymagać własnej odznaki');
    }
    for (const e of c.requiredEvents) {
      if (!knownEvents.has(e)) add('INVALID_REQUIREMENT', c.id, `Nieznane wymagane wydarzenie: ${e}`);
      if (e === c.completionEventId) add('INVALID_REQUIREMENT', c.id, 'Próba nie może wymagać własnego ukończenia');
    }

    const leader = leaders.find((l) => l.id === c.leaderId);
    if (!leader) add('MISSING_LEADER', c.id, `Nieznany lider: ${c.leaderId}`);
    else {
      if (leader.challengeId !== c.id) add('MISSING_LEADER', c.id, `Lider ${leader.id} prowadzi inną Próbę`);
      if (leader.locationId !== c.locationId) add('INVALID_VALUE', c.id, `Lider stoi w innej lokacji (${leader.locationId})`);
    }
  }

  for (const b of badges) {
    if (!b.name.trim()) add('INVALID_VALUE', b.id, 'Pusta nazwa odznaki');
    if (!getRegion(b.regionId, world)) add('MISSING_REGION', b.id, `Nieznany region: ${b.regionId}`);
    if (!Number.isInteger(b.displayOrder) || b.displayOrder < 1) add('INVALID_VALUE', b.id, `displayOrder musi być liczbą całkowitą ≥ 1: ${b.displayOrder}`);
    if (badges.some((o) => o !== b && o.displayOrder === b.displayOrder)) add('DUPLICATE_ID', b.id, `Powtórzona kolejność wyświetlania: ${b.displayOrder}`);
    const ch = getChallenge(b.challengeId, challenges);
    if (!ch) add('MISSING_BADGE', b.id, `Odznaka wskazuje nieznaną Próbę: ${b.challengeId}`);
    else if (ch.rewardBadgeId !== b.id) add('MISSING_BADGE', b.id, `Próba ${ch.id} przyznaje inną odznakę`);
    for (const e of b.unlockEffects) {
      const conn = connections.get(e.connectionId);
      if (e.kind !== 'UNLOCK_CONNECTION') add('INVALID_UNLOCK', b.id, `Nieznany efekt: ${String((e as { kind: unknown }).kind)}`);
      else if (!conn) add('INVALID_UNLOCK', b.id, `Odznaka otwiera nieznane przejście: ${e.connectionId}`);
      else if (!conn.locked) add('INVALID_UNLOCK', b.id, `Przejście ${e.connectionId} nie jest zamknięte (brak locked)`);
      if (!e.description.trim()) add('INVALID_UNLOCK', b.id, 'Efekt odznaki bez opisu');
    }
  }
  return issues;
}
