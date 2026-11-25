// Próby Szlaku (Sprint 6): dane (model wyzwania, lidera i odznaki), stan Próby, wymagania, zwycięstwo
// przyznające odznakę dokładnie raz, odblokowanie przejścia, spójność zapisu i walidacja błędnych danych.

import { describe, expect, it } from 'vitest';
import { BADGES, CHALLENGES, LEADER_TRAINERS, LEADERS, ODZNAKA_WIATRU_ID, PROBA_WIATRU_ID, type BadgeDef, type ChallengeDef } from '../../config/challenges';
import { STRAZNICA_ID, WORLD, ZAGAJNIK_ID } from '../../config/world';
import {
  badgesInOrder,
  challengeState,
  challengeVictory,
  getChallenge,
  missingRequirements,
  normalizeProgression,
  unlocksOf,
  validateChallenges,
  type ChallengeProgress,
} from '../challenges';
import { MAP_TRAINERS, getTrainer, talkKind, trainersIn, validateTrainers } from '../trainers';
import { checkTravel, connectionAt, getLocation } from '../world';

const PROBA = getChallenge(PROBA_WIATRU_ID)!;
const IGA_EVENT = 'trainer:zagajnik-iga:defeated';
const progress = (p: Partial<ChallengeProgress> = {}): ChallengeProgress => ({
  flags: {},
  bag: {},
  earnedBadges: [],
  completedChallenges: [],
  unlockedConnections: [],
  ...p,
});
const codes = (challenges: readonly ChallengeDef[] = CHALLENGES, badges: readonly BadgeDef[] = BADGES) =>
  validateChallenges(challenges, LEADERS, badges).map((i) => i.code);

describe('Próba Szlaku: dane', () => {
  it('dane Prób, liderów i odznak przechodzą walidację (także drużyna lidera jako trenera)', () => {
    expect(validateChallenges()).toEqual([]);
    expect(validateTrainers()).toEqual([]);
  });

  it('model wyzwania ma wszystkie pola; jedna Próba, jeden lider, jedna odznaka', () => {
    for (const key of ['id', 'name', 'regionId', 'locationId', 'leaderId', 'specialization', 'team', 'requiredBadges', 'requiredEvents', 'rewardBadgeId', 'optionalRewards', 'completionEventId', 'status']) {
      expect(key in PROBA).toBe(true);
    }
    expect(PROBA).toMatchObject({ locationId: STRAZNICA_ID, specialization: 'flying', rewardBadgeId: ODZNAKA_WIATRU_ID, status: 'IMPLEMENTED', requiredEvents: [IGA_EVENT] });
    expect(PROBA.team.map((m) => m.pokemonId)).toEqual(['spearow', 'swablu', 'pidgeotto']);
    const badge = BADGES[0];
    for (const key of ['id', 'name', 'regionId', 'challengeId', 'displayOrder', 'unlockEffects']) expect(key in badge).toBe(true);
    expect(badge.unlockEffects).toHaveLength(1);
    expect(badge.unlockEffects[0]).toMatchObject({ kind: 'UNLOCK_CONNECTION', connectionId: 'zagajnik-do-wzgorz' });
    expect(badgesInOrder().map((b) => b.id)).toEqual([ODZNAKA_WIATRU_ID]);
    expect(getLocation(STRAZNICA_ID)?.type).toBe('CHALLENGE');
  });

  it('lider jest trenerem z polem challengeId: stoi w lokacji Próby, bez wzroku, bez rewanżu, drużyna i AI z Próby', () => {
    expect(LEADER_TRAINERS).toHaveLength(1);
    const wera = getTrainer('przewodniczka-wera')!;
    expect(MAP_TRAINERS).toContain(wera);
    expect(trainersIn(STRAZNICA_ID).map((t) => t.id)).toEqual(['przewodniczka-wera']);
    expect(wera).toMatchObject({ challengeId: PROBA_WIATRU_ID, sightRange: 0, repeatPolicy: 'ONCE', aiProfile: 'AGGRESSIVE', defeatedEventId: PROBA.completionEventId });
    expect(wera.team).toBe(PROBA.team);
    expect(wera.eventTriggers).toEqual(PROBA.arenaTriggers);
    // Po ukończeniu Próby rozmowa = dialog po walce (bez walki).
    expect(talkKind(wera, {})).toBe('battle');
    expect(talkKind(wera, { [PROBA.completionEventId]: true })).toBe('after');
  });
});

describe('Próba Szlaku: wymagania i stan', () => {
  it('wejście bez wymagań: LOCKED i czytelna lista braków; po pokonaniu Igi — AVAILABLE', () => {
    expect(challengeState(PROBA, progress())).toBe('LOCKED');
    expect(missingRequirements(PROBA, progress())).toEqual(['pokonaj: Zielarka Iga']);
    expect(challengeState(PROBA, progress({ flags: { [IGA_EVENT]: true } }))).toBe('AVAILABLE');
    expect(missingRequirements(PROBA, progress({ flags: { [IGA_EVENT]: true } }))).toEqual([]);
  });

  it('wymagana odznaka: bez niej LOCKED, z nią AVAILABLE; Próba niewdrożona — UNAVAILABLE', () => {
    const c: ChallengeDef = { ...PROBA, requiredBadges: ['inna'], requiredEvents: [] };
    expect(challengeState(c, progress())).toBe('LOCKED');
    expect(challengeState(c, progress({ earnedBadges: ['inna'] }))).toBe('AVAILABLE');
    expect(challengeState({ ...PROBA, status: 'PLANNED' }, progress({ flags: { [IGA_EVENT]: true } }))).toBe('UNAVAILABLE');
  });

  it('ukończona (lista lub wydarzenie) — COMPLETED, niezależnie od wymagań', () => {
    expect(challengeState(PROBA, progress({ completedChallenges: [PROBA.id] }))).toBe('COMPLETED');
    expect(challengeState(PROBA, progress({ flags: { [PROBA.completionEventId]: true } }))).toBe('COMPLETED');
  });
});

describe('Próba Szlaku: zwycięstwo i odblokowanie', () => {
  it('pierwsze zwycięstwo: ukończenie, wydarzenie, odznaka i otwarcie przejścia', () => {
    const p = progress({ flags: { [IGA_EVENT]: true } });
    const v = challengeVictory(PROBA, p)!;
    expect(v.completedChallenges).toEqual([PROBA.id]);
    expect(v.earnedBadges).toEqual([ODZNAKA_WIATRU_ID]);
    expect(v.unlockedConnections).toEqual(['zagajnik-do-wzgorz']);
    expect(v.flags).toEqual({ [IGA_EVENT]: true, [PROBA.completionEventId]: true });
    expect(v.badge?.id).toBe(ODZNAKA_WIATRU_ID);
    expect(v.unlocked).toEqual(['zagajnik-do-wzgorz']);
    // Wejście w stan wejściowy nie jest modyfikowane (czysta funkcja).
    expect(p.earnedBadges).toEqual([]);
  });

  it('odznaka dokładnie raz: po ukończeniu kolejne zwycięstwo nic nie zmienia (null)', () => {
    const p = progress({ flags: { [IGA_EVENT]: true } });
    const v = challengeVictory(PROBA, p)!;
    const after = progress({ flags: v.flags, earnedBadges: v.earnedBadges, completedChallenges: v.completedChallenges, unlockedConnections: v.unlockedConnections });
    expect(challengeVictory(PROBA, after)).toBeNull();
    expect(challengeVictory(PROBA, progress({ flags: { [PROBA.completionEventId]: true } }))).toBeNull();
  });

  it('odznaka już posiadana (np. z migracji): Próba się kończy, odznaka nie jest dublowana', () => {
    const v = challengeVictory(PROBA, progress({ earnedBadges: [ODZNAKA_WIATRU_ID], unlockedConnections: ['zagajnik-do-wzgorz'] }))!;
    expect(v.badge).toBeNull();
    expect(v.earnedBadges).toEqual([ODZNAKA_WIATRU_ID]);
    expect(v.unlocked).toEqual([]);
    expect(v.unlockedConnections).toEqual(['zagajnik-do-wzgorz']);
  });

  it('odblokowanie przejścia: przed zwycięstwem zamknięte, po nim checkTravel prowadzi na Wzgórza', () => {
    const conn = connectionAt(getLocation(ZAGAJNIK_ID)!, 13, 0)!;
    const before = progress({ flags: { [IGA_EVENT]: true } });
    expect(checkTravel(conn, before)).toMatchObject({ ok: false, reason: 'locked' });
    const v = challengeVictory(PROBA, before)!;
    expect(checkTravel(conn, { ...before, unlockedConnections: v.unlockedConnections, earnedBadges: v.earnedBadges }).ok).toBe(true);
    expect(unlocksOf([ODZNAKA_WIATRU_ID])).toEqual(['zagajnik-do-wzgorz']);
    expect(unlocksOf(['nie-ma'])).toEqual([]);
  });

  it('spójność zapisu: ukończona Próba ⇒ wydarzenie i odznaka ⇒ przejście; nic nie jest odbierane', () => {
    expect(normalizeProgression({ completedChallenges: [PROBA.id] })).toEqual({
      flags: { [PROBA.completionEventId]: true },
      earnedBadges: [ODZNAKA_WIATRU_ID],
      completedChallenges: [PROBA.id],
      unlockedConnections: ['zagajnik-do-wzgorz'],
    });
    expect(normalizeProgression({ unlockedConnections: ['inne-przejscie'] }).unlockedConnections).toEqual(['inne-przejscie']);
    expect(normalizeProgression({})).toEqual({ flags: {}, earnedBadges: [], completedChallenges: [], unlockedConnections: [] });
  });
});

describe('Próba Szlaku: walidacja błędnych danych', () => {
  it('nieznana odznaka nagrody, odznaka innej Próby, wymaganie własnej odznaki lub nieznanego wydarzenia', () => {
    expect(codes([{ ...PROBA, rewardBadgeId: 'nie-ma' }])).toContain('MISSING_BADGE');
    expect(codes([{ ...PROBA, requiredBadges: [ODZNAKA_WIATRU_ID] }])).toContain('INVALID_REQUIREMENT');
    expect(codes([{ ...PROBA, requiredEvents: ['nieznane-wydarzenie'] }])).toContain('INVALID_REQUIREMENT');
    expect(codes([{ ...PROBA, requiredEvents: [PROBA.completionEventId] }])).toContain('INVALID_REQUIREMENT');
  });

  it('brak lidera, zdublowane id lub wydarzenie, nieznana lokacja i specjalizacja, pusta drużyna, brak dialogu', () => {
    expect(codes([{ ...PROBA, leaderId: 'nie-ma' }])).toContain('MISSING_LEADER');
    expect(codes([PROBA, { ...PROBA }])).toContain('DUPLICATE_ID');
    expect(codes([PROBA, { ...PROBA, id: 'druga' }])).toContain('DUPLICATE_EVENT');
    expect(codes([{ ...PROBA, completionEventId: IGA_EVENT }])).toContain('DUPLICATE_EVENT');
    expect(codes([{ ...PROBA, locationId: 'nie-ma' }])).toContain('MISSING_LOCATION');
    expect(codes([{ ...PROBA, specialization: 'wiatr' as never }])).toContain('INVALID_VALUE');
    expect(codes([{ ...PROBA, team: [] }])).toContain('INVALID_VALUE');
    expect(codes([{ ...PROBA, dialogue: { ...PROBA.dialogue, locked: [] } }])).toContain('INVALID_VALUE');
  });

  it('odznaka: efekt na nieznanym lub otwartym przejściu, zła kolejność, nieznana Próba', () => {
    const b = BADGES[0];
    expect(codes(CHALLENGES, [{ ...b, unlockEffects: [{ kind: 'UNLOCK_CONNECTION', connectionId: 'nie-ma', description: 'x' }] }])).toContain('INVALID_UNLOCK');
    expect(codes(CHALLENGES, [{ ...b, unlockEffects: [{ kind: 'UNLOCK_CONNECTION', connectionId: 'polana-do-zagajnika', description: 'x' }] }])).toContain('INVALID_UNLOCK');
    expect(codes(CHALLENGES, [{ ...b, displayOrder: 0 }])).toContain('INVALID_VALUE');
    expect(codes(CHALLENGES, [b, { ...b, id: 'druga', challengeId: 'nie-ma' }])).toContain('MISSING_BADGE');
  });

  it('świat: zamknięte przejście ze Sprintu 6 jest otwierane przez Odznakę Wiatru', () => {
    const locked = WORLD.locations.flatMap((l) => l.connections).filter((c) => c.locked);
    expect(locked.map((c) => c.id)).toEqual(['zagajnik-do-wzgorz']);
    expect(BADGES.flatMap((b) => b.unlockEffects.map((e) => e.connectionId))).toEqual(['zagajnik-do-wzgorz']);
  });
});
