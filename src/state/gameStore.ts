// Trwały stan gry (zapisywany w IndexedDB): gracz, drużyna, magazyn, torba, Atlas, zadania, ustawienia.

import { create } from 'zustand';
import type { BadgeDef, ChallengeDef } from '../config/challenges';
import { isHeldItemId, ITEMS, STARTING_BAG, STARTING_MONEY, type ItemId } from '../config/items';
import { QUESTS } from '../config/quests';
import { RULES } from '../config/rules';
import { challengeRewardItems, challengeVictory, getChallenge } from '../game/challenges';
import { discoveryRewardItems, getHiddenLocation, isDiscovered } from '../game/hiddenLocations';
import { getSpecialEncounter, specialOutcome, type SpecialEncounterRecord, type SpecialOutcomeUpdate } from '../game/specialEncounters';
import { getLocation, startPosition, type WorldPosition } from '../game/world';
import { displayName, healCreature, toMoveSlot } from '../engine/creature';
import type { Creature, Dir, MoveData, TypeName } from '../engine/types';

/**
 * Wersja formatu zapisu. 2 (Sprint 3): położenie w modelu świata (regionId, locationId, spawnPointId)
 * zamiast `mapId`. 3 (Sprint 4): stworzenia z naturą, abilityId, heldItemId i evolutionState.
 * 4 (Sprint 6): postęp Prób Szlaku — earnedBadges, completedChallenges, unlockedConnections.
 * 5 (Sprint 7): wyniki spotkań specjalnych — specialEncounters (odkrycia ukrytych lokacji to flagi).
 * Migracje starszych zapisów — src/data/migrations.ts.
 */
export const SAVE_VERSION = 5;

export interface PlayerState {
  name: string;
  /** Region, lokacja i punkt pojawienia się (bezpieczny punkt wejścia) z modelu świata. */
  regionId: string;
  locationId: string;
  spawnPointId: string;
  /** Ostatnia pozycja na mapie lokacji (przy wczytaniu sprawdzana — patrz resolveSafeEntry). */
  x: number;
  y: number;
  facing: Dir;
  money: number;
  steps: number;
  playTimeMs: number;
  startedAt: number;
}

export interface GameStats {
  battlesWon: number;
  caught: number;
  fled: number;
  blackouts: number;
  encounters: number;
}

export interface DexEntry {
  id: number;
  name: string;
  sprite: string | null;
  types: TypeName[];
  seen: boolean;
  caught: boolean;
}

export interface Settings {
  useApiSprites: boolean;
  vibration: boolean;
  fastText: boolean;
  showFollower: boolean;
}

export interface GameData {
  version: number;
  player: PlayerState;
  party: Creature[];
  storage: Creature[];
  bag: Partial<Record<ItemId, number>>;
  dex: Record<string, DexEntry>;
  stats: GameStats;
  questsClaimed: Record<string, boolean>;
  flags: Record<string, boolean>;
  /** Zdobyte odznaki (identyfikatory z src/config/challenges.ts), w kolejności zdobycia. */
  earnedBadges: string[];
  /** Ukończone Próby Szlaku. */
  completedChallenges: string[];
  /** Otwarte zamknięte przejścia (LocationConnection.locked) — efekty odznak. */
  unlockedConnections: string[];
  /** Wyniki spotkań specjalnych (src/config/specialEncounters.ts): ostatni wynik, liczba walk, ukończenie. */
  specialEncounters: Record<string, SpecialEncounterRecord>;
  settings: Settings;
}

/** Wynik odkrycia ukrytej lokacji (do komunikatu przed wejściem). */
export interface HiddenDiscovery {
  /** Pierwsze wejście — wydarzenie odkrycia zapisane teraz, nagroda przyznana. */
  first: boolean;
  money: number;
  items: [ItemId, number][];
}

/** Wynik pierwszego zwycięstwa w Próbie (do komunikatów po walce). */
export interface ChallengeCompletion {
  challenge: ChallengeDef;
  /** Odznaka przyznana teraz (null — gracz już ją miał). */
  badge: BadgeDef | null;
  /** Przejścia otwarte teraz. */
  unlocked: string[];
  money: number;
  items: [ItemId, number][];
}

export const DEFAULT_SETTINGS: Settings = {
  useApiSprites: true,
  vibration: true,
  fastText: false,
  showFollower: true,
};

function freshData(): GameData {
  const start = startPosition();
  return {
    version: SAVE_VERSION,
    player: {
      name: 'Tropiciel',
      ...start,
      money: STARTING_MONEY,
      steps: 0,
      playTimeMs: 0,
      startedAt: Date.now(),
    },
    party: [],
    storage: [],
    bag: { ...STARTING_BAG },
    dex: {},
    stats: { battlesWon: 0, caught: 0, fled: 0, blackouts: 0, encounters: 0 },
    questsClaimed: {},
    flags: {},
    earnedBadges: [],
    completedChallenges: [],
    unlockedConnections: [],
    specialEncounters: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

type DexInfo = Omit<DexEntry, 'seen' | 'caught'>;

export interface GameStore extends GameData {
  started: boolean;
  newGame(playerName: string, starter: Creature, starterDex: DexInfo): void;
  loadData(d: GameData): void;
  snapshot(): GameData;
  resetGame(): void;
  setPosition(x: number, y: number, facing: Dir): void;
  /** Zmiana lokacji (przejście między mapami, powrót do Stacji Opieki, bezpieczne wejście). */
  setLocation(pos: WorldPosition): void;
  addStep(): void;
  addPlayTime(ms: number): void;
  addMoney(n: number): void;
  spendMoney(n: number): boolean;
  addItem(id: ItemId, n?: number): void;
  removeItem(id: ItemId, n?: number): boolean;
  addCreature(c: Creature): 'party' | 'storage';
  updateCreatures(list: Creature[]): void;
  setLead(index: number): void;
  moveToStorage(index: number): boolean;
  moveToParty(storageIndex: number): boolean;
  healAll(): void;
  markSeen(info: DexInfo): void;
  markCaught(info: DexInfo): void;
  setFlag(key: string, value?: boolean): void;
  incStat(key: keyof GameStats, n?: number): void;
  claimQuest(id: string): boolean;
  updateSettings(p: Partial<Settings>): void;
  learnMove(uid: string, move: MoveData, replaceIndex: number | null): void;
  useFieldItem(id: ItemId, uid: string): string | null;
  /**
   * Założenie przedmiotu trzymanego: 1 sztuka z torby trafia do stworzenia (poprzedni przedmiot wraca
   * do torby). Zwraca komunikat błędu albo null przy powodzeniu.
   */
  equipItem(uid: string, id: ItemId): string | null;
  /** Zdjęcie przedmiotu — wraca do torby. */
  unequipItem(uid: string): boolean;
  /** Anulowana ewolucja przez poziom (nie proponujemy jej ponownie przed kolejnym awansem). */
  setEvolutionCancelled(uid: string, level: number): void;
  /**
   * Pierwsze zwycięstwo w Próbie — jedna, niepodzielna zmiana stanu: ukończenie Próby, wydarzenie ukończenia,
   * odznaka, odblokowane przejścia i nagroda dodatkowa. Zwraca null, jeśli Próba była już ukończona
   * (wtedy nic się nie zmienia — odznaka i nagroda nie mogą zostać przyznane drugi raz).
   */
  completeChallenge(challengeId: string): ChallengeCompletion | null;
  /**
   * Wynik walki ze stworzeniem specjalnym: wpis w zapisie i — gdy spotkanie znika na stałe — wydarzenie ukończenia
   * (jedna zmiana stanu). null — nieznane spotkanie, brak wyniku albo spotkanie już ukończone.
   */
  recordSpecialEncounter(specialId: string, outcome: string): SpecialOutcomeUpdate | null;
  /**
   * Odkrycie ukrytej lokacji: przy pierwszym wejściu zapisuje wydarzenie odkrycia i przyznaje nagrodę (jedna zmiana
   * stanu — dokładnie raz). Kolejne wejścia: first = false, bez nagrody. null — nieznana lokacja.
   */
  discoverHiddenLocation(hiddenId: string): HiddenDiscovery | null;
}

const DATA_KEYS: (keyof GameData)[] = [
  'version',
  'player',
  'party',
  'storage',
  'bag',
  'dex',
  'stats',
  'questsClaimed',
  'flags',
  'earnedBadges',
  'completedChallenges',
  'unlockedConnections',
  'specialEncounters',
  'settings',
];

function replaceByUid(list: Creature[], updated: Map<string, Creature>): Creature[] {
  let changed = false;
  const out = list.map((c) => {
    const u = updated.get(c.uid);
    if (u) {
      changed = true;
      return u;
    }
    return c;
  });
  return changed ? out : list;
}

export const useGame = create<GameStore>()((set, get) => ({
  ...freshData(),
  started: false,

  newGame: (playerName, starter, starterDex) => {
    const d = freshData();
    d.player.name = playerName.trim() || 'Tropiciel';
    d.party = [{ ...starter, caughtAt: Date.now(), metAt: getLocation(d.player.locationId)?.name ?? 'Polana Startowa' }];
    d.dex[String(starterDex.id)] = { ...starterDex, seen: true, caught: true };
    set({ ...d, started: true });
  },

  loadData: (data) => {
    const base = freshData();
    set({
      ...base,
      ...data,
      player: { ...base.player, ...data.player },
      stats: { ...base.stats, ...data.stats },
      settings: { ...base.settings, ...data.settings },
      started: true,
    });
  },

  snapshot: () => {
    const s = get();
    const out = {} as Record<string, unknown>;
    for (const key of DATA_KEYS) out[key] = s[key];
    return structuredClone(out) as unknown as GameData;
  },

  resetGame: () => set({ ...freshData(), started: false }),

  setPosition: (x, y, facing) => set((s) => ({ player: { ...s.player, x, y, facing } })),
  setLocation: (pos) =>
    set((s) => ({
      player: {
        ...s.player,
        regionId: pos.regionId,
        locationId: pos.locationId,
        spawnPointId: pos.spawnPointId,
        x: pos.x,
        y: pos.y,
        facing: pos.facing,
      },
    })),
  addStep: () => set((s) => ({ player: { ...s.player, steps: s.player.steps + 1 } })),
  addPlayTime: (ms) => set((s) => ({ player: { ...s.player, playTimeMs: s.player.playTimeMs + ms } })),

  addMoney: (n) => set((s) => ({ player: { ...s.player, money: Math.max(0, s.player.money + Math.floor(n)) } })),
  spendMoney: (n) => {
    if (get().player.money < n) return false;
    set((s) => ({ player: { ...s.player, money: s.player.money - n } }));
    return true;
  },

  addItem: (id, n = 1) => set((s) => ({ bag: { ...s.bag, [id]: (s.bag[id] ?? 0) + n } })),
  removeItem: (id, n = 1) => {
    const have = get().bag[id] ?? 0;
    if (have < n) return false;
    set((s) => ({ bag: { ...s.bag, [id]: have - n } }));
    return true;
  },

  addCreature: (c) => {
    const s = get();
    if (s.party.length < RULES.maxPartySize) {
      set({ party: [...s.party, c] });
      return 'party';
    }
    set({ storage: [...s.storage, healCreature(c)] });
    return 'storage';
  },

  updateCreatures: (list) => {
    const map = new Map(list.map((c) => [c.uid, c]));
    set((s) => ({ party: replaceByUid(s.party, map), storage: replaceByUid(s.storage, map) }));
  },

  setLead: (index) =>
    set((s) => {
      if (index <= 0 || index >= s.party.length) return {};
      const party = [...s.party];
      const [c] = party.splice(index, 1);
      party.unshift(c);
      return { party };
    }),

  moveToStorage: (index) => {
    const s = get();
    if (s.party.length <= 1 || !s.party[index]) return false;
    const party = [...s.party];
    const [c] = party.splice(index, 1);
    set({ party, storage: [...s.storage, healCreature(c)] });
    return true;
  },

  moveToParty: (storageIndex) => {
    const s = get();
    if (s.party.length >= RULES.maxPartySize || !s.storage[storageIndex]) return false;
    const storage = [...s.storage];
    const [c] = storage.splice(storageIndex, 1);
    set({ party: [...s.party, c], storage });
    return true;
  },

  healAll: () => set((s) => ({ party: s.party.map(healCreature) })),

  markSeen: (info) =>
    set((s) => {
      const key = String(info.id);
      const prev = s.dex[key];
      if (prev?.seen) return {};
      return { dex: { ...s.dex, [key]: { ...info, seen: true, caught: prev?.caught ?? false } } };
    }),

  markCaught: (info) =>
    set((s) => {
      const key = String(info.id);
      const prev = s.dex[key];
      return {
        dex: { ...s.dex, [key]: { ...(prev ?? info), sprite: prev?.sprite ?? info.sprite, seen: true, caught: true } },
      };
    }),

  setFlag: (key, value = true) => set((s) => ({ flags: { ...s.flags, [key]: value } })),
  incStat: (key, n = 1) => set((s) => ({ stats: { ...s.stats, [key]: s.stats[key] + n } })),

  claimQuest: (id) => {
    const s = get();
    const q = QUESTS.find((x) => x.id === id);
    if (!q || s.questsClaimed[id]) return false;
    if (q.progress(s) < q.goal) return false;
    const bag = { ...s.bag };
    for (const [item, n] of Object.entries(q.reward.items) as [ItemId, number][]) bag[item] = (bag[item] ?? 0) + n;
    set({
      questsClaimed: { ...s.questsClaimed, [id]: true },
      bag,
      player: { ...s.player, money: s.player.money + q.reward.money },
    });
    return true;
  },

  updateSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),

  learnMove: (uid, move, replaceIndex) => {
    const apply = (c: Creature): Creature => {
      if (c.uid !== uid || c.moves.some((m) => m.name === move.name)) return c;
      const moves = [...c.moves];
      if (moves.length < RULES.maxMoves) moves.push(toMoveSlot(move));
      else if (replaceIndex !== null && moves[replaceIndex]) moves[replaceIndex] = toMoveSlot(move);
      else return c;
      return { ...c, moves };
    };
    set((s) => ({ party: s.party.map(apply), storage: s.storage.map(apply) }));
  },

  useFieldItem: (id, uid) => {
    const s = get();
    const def = ITEMS[id];
    const c = s.party.find((x) => x.uid === uid);
    if (!def || !c || !def.usableInField || (s.bag[id] ?? 0) <= 0) return null;
    let updated: Creature | null = null;
    let text = '';
    if (def.kind === 'heal') {
      if (c.hp <= 0 || c.hp >= c.stats.hp) return null;
      const hp = Math.min(c.stats.hp, c.hp + (def.healAmount ?? 0));
      updated = { ...c, hp };
      text = `${displayName(c)} odzyskuje ${hp - c.hp} PŻ.`;
    } else if (def.kind === 'cure') {
      if (!c.status) return null;
      updated = { ...c, status: null, sleepTurns: 0 };
      text = `${displayName(c)} czuje się znacznie lepiej!`;
    }
    if (!updated) return null;
    const u = updated;
    set((st) => ({
      party: st.party.map((x) => (x.uid === uid ? u : x)),
      bag: { ...st.bag, [id]: (st.bag[id] ?? 0) - 1 },
    }));
    return text;
  },

  equipItem: (uid, id) => {
    const s = get();
    const c = findOwned(s, uid);
    if (!c) return 'Nie znaleziono stworzenia.';
    if (!isHeldItemId(id)) return 'Tego przedmiotu nie można trzymać.';
    if ((s.bag[id] ?? 0) <= 0) return 'Nie masz tego przedmiotu w torbie.';
    if (c.heldItemId === id) return `${displayName(c)} już trzyma: ${ITEMS[id].name}.`;
    const bag = { ...s.bag, [id]: (s.bag[id] ?? 0) - 1 };
    const prev = c.heldItemId;
    if (isHeldItemId(prev)) bag[prev] = (bag[prev] ?? 0) + 1;
    const map = new Map([[uid, { ...c, heldItemId: id }]]);
    set({ bag, party: replaceByUid(s.party, map), storage: replaceByUid(s.storage, map) });
    return null;
  },

  unequipItem: (uid) => {
    const s = get();
    const c = findOwned(s, uid);
    if (!c || !c.heldItemId) return false;
    const prev = c.heldItemId;
    const bag = isHeldItemId(prev) ? { ...s.bag, [prev]: (s.bag[prev] ?? 0) + 1 } : s.bag;
    const map = new Map([[uid, { ...c, heldItemId: null }]]);
    set({ bag, party: replaceByUid(s.party, map), storage: replaceByUid(s.storage, map) });
    return true;
  },

  setEvolutionCancelled: (uid, level) => {
    const c = findOwned(get(), uid);
    if (!c) return;
    const map = new Map([[uid, { ...c, evolutionState: { ...c.evolutionState, cancelledAtLevel: level } }]]);
    set((s) => ({ party: replaceByUid(s.party, map), storage: replaceByUid(s.storage, map) }));
  },

  completeChallenge: (challengeId) => {
    const s = get();
    const challenge = getChallenge(challengeId);
    if (!challenge) return null;
    const v = challengeVictory(challenge, s);
    if (!v) return null;
    const money = Math.max(0, Math.floor(challenge.optionalRewards.money));
    const items = challengeRewardItems(challenge);
    const bag = { ...s.bag };
    for (const [id, n] of items) bag[id] = (bag[id] ?? 0) + n;
    set({
      completedChallenges: v.completedChallenges,
      earnedBadges: v.earnedBadges,
      unlockedConnections: v.unlockedConnections,
      flags: v.flags,
      bag,
      player: { ...s.player, money: s.player.money + money },
    });
    return { challenge, badge: v.badge, unlocked: v.unlocked, money, items };
  },

  recordSpecialEncounter: (specialId, outcome) => {
    const s = get();
    const def = getSpecialEncounter(specialId);
    if (!def) return null;
    const u = specialOutcome(def, outcome, s.specialEncounters[def.id], s.flags, Date.now());
    if (!u) return null;
    set({
      specialEncounters: { ...s.specialEncounters, [def.id]: u.record },
      ...(u.completes ? { flags: { ...s.flags, [def.completionEventId]: true } } : {}),
    });
    return u;
  },

  discoverHiddenLocation: (hiddenId) => {
    const s = get();
    const h = getHiddenLocation(hiddenId);
    if (!h) return null;
    if (isDiscovered(h, s.flags)) return { first: false, money: 0, items: [] };
    const money = Math.max(0, Math.floor(h.rewards.money));
    const items = discoveryRewardItems(h);
    const bag = { ...s.bag };
    for (const [id, n] of items) bag[id] = (bag[id] ?? 0) + n;
    set({ flags: { ...s.flags, [h.discoveryEventId]: true }, bag, player: { ...s.player, money: s.player.money + money } });
    return { first: true, money, items };
  },
}));

function findOwned(s: GameData, uid: string): Creature | undefined {
  return s.party.find((c) => c.uid === uid) ?? s.storage.find((c) => c.uid === uid);
}

/** Pierwsze sprawne stworzenie (prowadzący drużynę / towarzysz na mapie). */
export function leadCreature(party: Creature[]): Creature | null {
  return party.find((c) => c.hp > 0) ?? party[0] ?? null;
}
