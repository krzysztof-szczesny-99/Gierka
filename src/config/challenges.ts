// Próby Szlaku (Sprint 6) — dane: wyzwania (funkcjonalny odpowiednik sal z oficjalnych gier, ale z oryginalną
// nazwą, mapą, liderem i dialogami), liderzy i odznaki. Logika: src/game/challenges.ts; walka: ten sam silnik
// co walki z trenerami (lider jest trenerem z polem challengeId — LEADER_TRAINERS).

import type { AiProfile } from '../engine/battle/ai';
import type { Dir, TypeName } from '../engine/types';
import type { TrainerDef, TrainerEventTrigger, TrainerLook, TrainerMemberDef, TrainerReward } from './trainers';
import { REGION_ID, STRAZNICA_ID, type LocationStatus } from './world';

/** Dialogi Próby (oryginalne). Lider mówi je jako trener: „Imię: „…”” */
export interface ChallengeDialogue {
  /** Wymagania niespełnione — lider odmawia, walki nie ma. */
  locked: string[];
  /** Przed walką (wymagania spełnione, Próba nieukończona). */
  before: string[];
  /** Po zwycięstwie — w komunikatach po walce, po informacji o odznace. */
  victory: string[];
  /** Kolejne rozmowy po ukończeniu Próby (bez walki i bez nagrody). */
  after: string[];
}

export interface ChallengeDef {
  id: string;
  name: string;
  regionId: string;
  locationId: string;
  leaderId: string;
  /** Specjalizacja: typ stworzeń lidera. */
  specialization: TypeName;
  team: TrainerMemberDef[];
  /** Odznaki potrzebne do podjęcia Próby (lista zdobytych odznak w zapisie). */
  requiredBadges: string[];
  /** Wydarzenia (flagi zapisu) potrzebne do podjęcia Próby, np. pokonanie trenera. */
  requiredEvents: string[];
  rewardBadgeId: string;
  /** Dodatkowa nagroda za pierwsze zwycięstwo (pieniądze i przedmioty) — przyznawana raz, razem z odznaką. */
  optionalRewards: TrainerReward;
  /** Flaga zapisu ustawiana po ukończeniu Próby. */
  completionEventId: string;
  /** Stan wdrożenia (jak w modelu świata): tylko IMPLEMENTED ma lidera na mapie. */
  status: LocationStatus;
  aiProfile: AiProfile;
  dialogue: ChallengeDialogue;
  /** Pola wejścia na arenę — wejście sprawdza wymagania i rozpoczyna Próbę. */
  arenaTriggers: TrainerEventTrigger[];
}

/** Lider Próby stojący na mapie. */
export interface LeaderDef {
  id: string;
  name: string;
  challengeId: string;
  locationId: string;
  position: { x: number; y: number };
  direction: Dir;
  look: TrainerLook;
}

/** Efekt odznaki: otwiera zamknięte przejście (LocationConnection.locked) — id trafia do unlockedConnections. */
export interface BadgeUnlockEffect {
  kind: 'UNLOCK_CONNECTION';
  connectionId: string;
  /** Opis dla gracza (komunikat po zdobyciu odznaki i Dziennik). */
  description: string;
}

export interface BadgeDef {
  id: string;
  name: string;
  regionId: string;
  challengeId: string;
  displayOrder: number;
  description: string;
  unlockEffects: BadgeUnlockEffect[];
}

export const PROBA_WIATRU_ID = 'proba-wiatru';
export const ODZNAKA_WIATRU_ID = 'odznaka-wiatru';

export const CHALLENGES: readonly ChallengeDef[] = [
  {
    id: PROBA_WIATRU_ID,
    name: 'Próba Wiatru',
    regionId: REGION_ID,
    locationId: STRAZNICA_ID,
    leaderId: 'przewodniczka-wera',
    specialization: 'flying',
    team: [
      { pokemonId: 'spearow', level: 11, moves: ['peck', 'leer', 'fury-attack'], nature: 'adamant', abilityId: 'keen-eye' },
      { pokemonId: 'swablu', level: 11, moves: ['peck', 'growl', 'astonish', 'sing'], nature: 'calm', abilityId: 'natural-cure' },
      { pokemonId: 'pidgeotto', level: 13, moves: ['gust', 'quick-attack', 'wing-attack', 'sand-attack'], nature: 'jolly', abilityId: 'keen-eye', heldItemId: 'power-band' },
    ],
    requiredBadges: [],
    requiredEvents: ['trainer:zagajnik-iga:defeated'],
    rewardBadgeId: ODZNAKA_WIATRU_ID,
    optionalRewards: { money: 800, items: { 'herb-strong': 2 } },
    completionEventId: 'challenge:proba-wiatru:completed',
    status: 'IMPLEMENTED',
    aiProfile: 'AGGRESSIVE',
    dialogue: {
      locked: [
        'Witaj w Wietrznej Strażnicy. Jestem Wera i prowadzę Próbę Wiatru.',
        'Na arenę wpuszczam tylko tropicieli, którzy pokonali Zielarkę Igę z Szepczącego Zagajnika. Wróć, gdy Ci się to uda!',
      ],
      before: [
        'Wiatr przywiał nowego tropiciela!',
        'Zasady Próby Wiatru są proste: moje skrzydlate stworzenia przeciw Twojej drużynie. Wygrasz — zdobędziesz Odznakę Wiatru.',
        'Trzymaj się mocno. Zaczynamy!',
      ],
      victory: [
        'Twoje stworzenia nie dały się porwać wichurze. Odznaka jest Twoja!',
        'Moi pomocnicy już uprzątają zwalone drzewo na północy Zagajnika — droga na Wzgórza Wiatru stoi otworem.',
      ],
      after: [
        'Odznaka Wiatru dobrze na Tobie wygląda.',
        'Ścieżka na Wzgórza Wiatru zaczyna się na północnym skraju Szepczącego Zagajnika.',
      ],
    },
    // Brama areny (dwa pola przejścia w murze).
    arenaTriggers: [
      { kind: 'tile', x: 8, y: 8 },
      { kind: 'tile', x: 9, y: 8 },
    ],
  },
];

export const LEADERS: readonly LeaderDef[] = [
  {
    id: 'przewodniczka-wera',
    name: 'Przewodniczka Wera',
    challengeId: PROBA_WIATRU_ID,
    locationId: STRAZNICA_ID,
    position: { x: 8, y: 3 },
    direction: 'down',
    look: 'warden',
  },
];

export const BADGES: readonly BadgeDef[] = [
  {
    id: ODZNAKA_WIATRU_ID,
    name: 'Odznaka Wiatru',
    regionId: REGION_ID,
    challengeId: PROBA_WIATRU_ID,
    displayOrder: 1,
    description: 'Za zwycięstwo w Próbie Wiatru w Wietrznej Strażnicy.',
    unlockEffects: [
      { kind: 'UNLOCK_CONNECTION', connectionId: 'zagajnik-do-wzgorz', description: 'ścieżka z Szepczącego Zagajnika na Wzgórza Wiatru' },
    ],
  },
];

/**
 * Lider jako trener (ten sam kod mapy, centralna blokada i silnik walki co w Sprincie 5): drużyna, profil AI,
 * dialogi i nagroda pochodzą z wyzwania; pokonanie = wydarzenie ukończenia Próby; bez rewanżu i bez wzroku.
 */
export function leaderAsTrainer(challenge: ChallengeDef, leader: LeaderDef): TrainerDef {
  return {
    id: leader.id,
    name: leader.name,
    locationId: leader.locationId,
    position: leader.position,
    direction: leader.direction,
    sightRange: 0,
    dialogueBefore: challenge.dialogue.before,
    dialogueAfter: challenge.dialogue.after,
    team: challenge.team,
    aiProfile: challenge.aiProfile,
    reward: challenge.optionalRewards,
    defeatedEventId: challenge.completionEventId,
    repeatPolicy: 'ONCE',
    eventTriggers: challenge.arenaTriggers,
    look: leader.look,
    challengeId: challenge.id,
  };
}

/** Liderzy wdrożonych Prób (trafiają na mapę razem z trenerami). */
export const LEADER_TRAINERS: readonly TrainerDef[] = CHALLENGES.filter((c) => c.status === 'IMPLEMENTED').flatMap((c) => {
  const leader = LEADERS.find((l) => l.id === c.leaderId && l.challengeId === c.id);
  return leader ? [leaderAsTrainer(c, leader)] : [];
});
