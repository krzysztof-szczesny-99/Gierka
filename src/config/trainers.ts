// Trenerzy (Sprint 5) — dane. Imiona, dialogi i ustawienie są oryginalne. Logika: src/game/trainers.ts,
// walka: createTrainerBattle (ten sam silnik co walka z dzikim stworzeniem), przebieg: encounterService.

import type { AiProfile } from '../engine/battle/ai';
import type { Dir } from '../engine/types';
import type { HeldItemId, ItemId } from './items';
import type { NatureId } from './natures';
import { POLANA_ID, ZAGAJNIK_ID } from './world';

/** Członek drużyny trenera. Wszystkie pola są obsługiwane przez silnik (Sprint 4: natura, zdolność, przedmiot). */
export interface TrainerMemberDef {
  /** Nazwa wariantu w PokéAPI, np. „pidgey”. */
  pokemonId: string;
  level: number;
  /** Do 4 ruchów (nazwy z PokéAPI); brak — ruchy z listy nauki dla poziomu. */
  moves?: string[];
  /** Brak — natura losowana (z ziarnem gry). */
  nature?: NatureId;
  /** Brak — zdolność losowana spośród zwykłych zdolności gatunku. */
  abilityId?: string;
  heldItemId?: HeldItemId | null;
}

export interface TrainerReward {
  money: number;
  items?: Partial<Record<ItemId, number>>;
}

/** Wydarzenie wyzwalające trenera: wejście gracza na wskazane pole. */
export interface TrainerEventTrigger {
  kind: 'tile';
  x: number;
  y: number;
}

/**
 * ONCE — po porażce trener tylko rozmawia (dialogueAfter);
 * REMATCH — po porażce rozmowa rozpoczyna rewanż (bez nagrody), wzrok i wydarzenia już nie wyzwalają walki.
 */
export type RepeatPolicy = 'ONCE' | 'REMATCH';

/** Wygląd (przebarwienie oryginalnej postaci z mapy). „warden” — liderka Próby (Sprint 6). */
export type TrainerLook = 'scout' | 'herbalist' | 'warden';

export interface TrainerDef {
  id: string;
  name: string;
  locationId: string;
  position: { x: number; y: number };
  direction: Dir;
  /** Zasięg wzroku w polach (0 — trener nie wypatruje gracza). */
  sightRange: number;
  dialogueBefore: string[];
  dialogueAfter: string[];
  /** Zaczepka przed rewanżem (repeatPolicy REMATCH). */
  dialogueRematch?: string[];
  team: TrainerMemberDef[];
  aiProfile: AiProfile;
  reward: TrainerReward;
  /** Flaga w zapisie (flags) ustawiana po pierwszej wygranej. */
  defeatedEventId: string;
  repeatPolicy: RepeatPolicy;
  eventTriggers?: TrainerEventTrigger[];
  look: TrainerLook;
  /**
   * Lider Próby (Sprint 6): identyfikator wyzwania z src/config/challenges.ts. Taki trener powstaje z danych
   * wyzwania (LEADER_TRAINERS) — wymagania, odznaka i odblokowania obsługuje src/game/challenges.ts.
   */
  challengeId?: string;
}

export const TRAINERS: readonly TrainerDef[] = [
  {
    id: 'polana-bartek',
    name: 'Tropiciel Bartek',
    locationId: POLANA_ID,
    position: { x: 24, y: 13 },
    direction: 'down',
    sightRange: 3,
    dialogueBefore: ['Hej, stój! Pilnuję drogi do Szepczącego Zagajnika.', 'Kto chce przejść, musi najpierw zmierzyć się z moimi stworzeniami!'],
    dialogueAfter: ['Dobra walka! Droga do Zagajnika stoi przed Tobą otworem.', 'W paprociach roi się od leśnych stworzeń — uważaj na siebie.'],
    team: [
      { pokemonId: 'pidgey', level: 4, moves: ['tackle', 'sand-attack'], nature: 'hardy', abilityId: 'keen-eye' },
      { pokemonId: 'sentret', level: 5, moves: ['scratch', 'growl'], nature: 'jolly', abilityId: 'run-away' },
    ],
    aiProfile: 'BASIC',
    reward: { money: 150, items: { herb: 1 } },
    defeatedEventId: 'trainer:polana-bartek:defeated',
    repeatPolicy: 'ONCE',
    look: 'scout',
  },
  {
    id: 'zagajnik-iga',
    name: 'Zielarka Iga',
    locationId: ZAGAJNIK_ID,
    position: { x: 17, y: 12 },
    direction: 'left',
    sightRange: 3,
    dialogueBefore: ['Szukasz ziół w moim zagajniku?', 'Najpierw sprawdzę, czy Twoje stworzenia są tak silne, jak ich zapach!'],
    dialogueAfter: ['Twoje stworzenia mają w sobie siłę dębu.', 'Wróć, kiedy zechcesz — zawsze chętnie powalczę jeszcze raz.'],
    dialogueRematch: ['Rewanż? Świetnie — moje stworzenia trenowały od świtu!'],
    team: [
      { pokemonId: 'oddish', level: 7, moves: ['absorb', 'acid'], nature: 'modest', abilityId: 'chlorophyll', heldItemId: 'wonder-seed' },
      { pokemonId: 'hoothoot', level: 8, moves: ['peck', 'growl', 'confusion'], nature: 'calm', abilityId: 'insomnia' },
    ],
    aiProfile: 'BALANCED',
    reward: { money: 300, items: { 'soothe-berry': 1 } },
    defeatedEventId: 'trainer:zagajnik-iga:defeated',
    repeatPolicy: 'REMATCH',
    // Skrzyżowanie ścieżek — Iga woła gracza, nawet jeśli nie stoi w jej polu widzenia.
    eventTriggers: [{ kind: 'tile', x: 14, y: 9 }],
    look: 'herbalist',
  },
];

/** Identyfikator aktora na mapie (źródło spotkania w centralnej blokadzie). */
export const trainerActorId = (trainerId: string) => `trainer:${trainerId}`;
