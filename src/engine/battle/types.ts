import type { ItemId } from '../../config/items';
import type { AiProfile } from './ai';
import type {
  BoostKey,
  Creature,
  GrowthTable,
  MajorStatus,
  MoveData,
  PokemonData,
  TypeChart,
} from '../types';

export type SideIndex = 0 | 1;
export type SideKind = 'player' | 'wild' | 'trainer';
export type BattleOutcome = 'win' | 'lose' | 'fled' | 'caught';

export type Boosts = Record<BoostKey, number>;

export interface Volatile {
  confusion: number;
  flinch: boolean;
  faintHandled: boolean;
}

export interface BattleSide {
  kind: SideKind;
  name: string;
  party: Creature[];
  /** Indeksy aktywnych stworzeń w party (1 w walce pojedynczej, 2 w podwójnej — etap 3). */
  active: number[];
  /** Profil AI trenera (Sprint 5); brak — dzikie stworzenie (losowy wybór ruchu). */
  ai?: AiProfile;
  /** Tura, w której AI ostatnio zmieniło stworzenie (bez zmian tura po turze). */
  switchedAtTurn?: number;
}

export interface BattleState {
  format: 'single';
  turn: number;
  sides: [BattleSide, BattleSide];
  boosts: Record<string, Boosts>;
  volatiles: Record<string, Volatile>;
  pokemon: Record<string, PokemonData>;
  moves: Record<string, MoveData>;
  growth: Record<string, GrowthTable>;
  typeChart: TypeChart;
  captureRate: number;
  participants: string[];
  escapeAttempts: number;
  awaitingSwitch: boolean;
  outcome: BattleOutcome | null;
  caught: Creature | null;
  pendingLearns: { uid: string; move: string }[];
}

export type PlayerAction =
  | { kind: 'move'; moveIndex: number }
  | { kind: 'switch'; partyIndex: number }
  | { kind: 'item'; item: ItemId; targetUid?: string }
  | { kind: 'run' };

export type BattleEvent =
  | { t: 'msg'; text: string }
  | { t: 'sendOut'; side: SideIndex; uid: string }
  | { t: 'withdraw'; side: SideIndex; uid: string }
  | { t: 'useMove'; side: SideIndex; uid: string; move: string; moveType: string }
  | { t: 'hp'; side: SideIndex; uid: string; hp: number; maxHp: number; delta: number; crit?: boolean; eff?: number }
  | { t: 'status'; side: SideIndex; uid: string; status: MajorStatus | null }
  | { t: 'boost'; side: SideIndex; uid: string; stat: BoostKey; change: number }
  | { t: 'miss'; side: SideIndex; uid: string }
  | { t: 'faint'; side: SideIndex; uid: string }
  | { t: 'capsule'; item: ItemId; shakes: number; caught: boolean }
  | { t: 'exp'; uid: string; exp: number; level: number; gained: number }
  | { t: 'levelUp'; uid: string; level: number; hp: number; maxHp: number }
  | { t: 'needSwitch' }
  | { t: 'end'; outcome: BattleOutcome };

export const EMPTY_BOOSTS: Boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
