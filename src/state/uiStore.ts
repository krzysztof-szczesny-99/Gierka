// Stan interfejsu (nie jest zapisywany): tryb ekranu, okna, dialogi, komunikaty, kolejka nauki ruchów
// oraz centralna blokada spotkań (jedyne miejsce, które decyduje, czy spotkanie może się zacząć).

import { create } from 'zustand';
import type { EncounterOutcome } from '../game/eventBus';
import type { MoveData } from '../engine/types';

export type Mode = 'boot' | 'title' | 'starter' | 'overworld' | 'battle';
export type ModalId = 'party' | 'bag' | 'atlas' | 'journal' | 'shop' | 'options';

/**
 * Logiczny stan rozgrywki na mapie:
 * EXPLORATION → ENCOUNTER_STARTING → BATTLE → ENCOUNTER_ENDING → EXPLORATION.
 * Błąd rozpoczęcia lub zamknięcie interfejsu walki: ENCOUNTER_STARTING/BATTLE → ENCOUNTER_ENDING → EXPLORATION.
 */
export type GameMode = 'EXPLORATION' | 'ENCOUNTER_STARTING' | 'BATTLE' | 'ENCOUNTER_ENDING';

export type EncounterEndReason = 'result' | 'init-error' | 'ui-closed';

export interface EncounterRecord {
  id: string;
  sourceEntityId: string | null;
  outcome: EncounterOutcome;
  reason: EncounterEndReason;
}

/** Zegar blokady spotkań (monotoniczny, w ms). */
export function encounterClock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

let encounterSeq = 0;

export interface DialogState {
  lines: string[];
  index: number;
  onDone?: () => void;
}

export interface LearnRequest {
  uid: string;
  move: MoveData;
}

/** Zdarzenie instalacji PWA (Chrome/Android) — brak w standardowych typach DOM. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface UiStore {
  mode: Mode;
  modal: ModalId | null;
  dialog: DialogState | null;
  toast: { id: number; text: string } | null;
  transition: boolean;
  learnQueue: LearnRequest[];
  online: boolean;
  installPrompt: BeforeInstallPromptEvent | null;
  offlineReady: boolean;

  // ── centralna blokada spotkań ──
  gameMode: GameMode;
  /** Identyfikator trwającego spotkania (null = brak). */
  activeEncounterId: string | null;
  /** Obiekt na mapie, który wywołał spotkanie (np. id dzikiego stworzenia). */
  sourceEntityId: string | null;
  /** Wejście (joystick, klawiatura, przycisk A) jest ignorowane przez scenę. */
  inputLocked: boolean;
  /** Do kiedy (ms wg encounterClock) nie może zacząć się kolejne spotkanie; 0 = brak odnowienia. */
  encounterCooldown: number;
  /** Ostatnie zakończone spotkanie (diagnostyka i testy). */
  lastEncounter: EncounterRecord | null;
  /**
   * Jedyna operacja rozpoczynająca spotkanie. Atomowo (synchronicznie, bez await) sprawdza stan EXPLORATION,
   * brak aktywnego spotkania i odnowienie, przejmuje blokadę i zwraca identyfikator spotkania — albo null.
   */
  tryStartEncounter(sourceEntityId: string, now?: number): string | null;
  /** ENCOUNTER_STARTING → BATTLE (tylko dla bieżącego spotkania). */
  confirmBattle(encounterId: string): boolean;
  /** ENCOUNTER_STARTING/BATTLE → ENCOUNTER_ENDING. Zwraca true dokładnie raz dla danego spotkania. */
  beginEncounterEnd(encounterId: string): boolean;
  /** Czyści activeEncounterId i źródło (stan pozostaje ENCOUNTER_ENDING) i zapisuje wynik. */
  releaseEncounter(encounterId: string, outcome: EncounterOutcome, reason: EncounterEndReason): boolean;
  setEncounterCooldown(until: number): void;
  /** ENCOUNTER_ENDING (po zwolnieniu spotkania) → EXPLORATION i odblokowanie wejścia. */
  enterExploration(): boolean;
  /** Twardy powrót do EXPLORATION (nowa scena mapy). */
  resetEncounterState(): void;

  setMode(m: Mode): void;
  openModal(m: ModalId): void;
  closeModal(): void;
  showDialog(lines: string[], onDone?: () => void): void;
  advanceDialog(): void;
  showToast(text: string, ms?: number): void;
  setTransition(v: boolean): void;
  pushLearn(reqs: LearnRequest[]): void;
  shiftLearn(): void;
  setOnline(v: boolean): void;
  setInstallPrompt(e: BeforeInstallPromptEvent | null): void;
  setOfflineReady(v: boolean): void;
}

let toastId = 0;

export const useUi = create<UiStore>()((set, get) => ({
  mode: 'boot',
  modal: null,
  dialog: null,
  toast: null,
  transition: false,
  learnQueue: [],
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  installPrompt: null,
  offlineReady: false,

  gameMode: 'EXPLORATION',
  activeEncounterId: null,
  sourceEntityId: null,
  inputLocked: false,
  encounterCooldown: 0,
  lastEncounter: null,

  tryStartEncounter: (sourceEntityId, now = encounterClock()) => {
    const s = get();
    if (s.mode !== 'overworld') return null;
    if (s.gameMode !== 'EXPLORATION' || s.activeEncounterId !== null) return null;
    if (now < s.encounterCooldown) return null;
    if (s.modal !== null || s.dialog !== null || s.transition || s.learnQueue.length > 0) return null;
    const id = `enc-${++encounterSeq}`;
    set({ gameMode: 'ENCOUNTER_STARTING', activeEncounterId: id, sourceEntityId, inputLocked: true });
    return id;
  },

  confirmBattle: (encounterId) => {
    const s = get();
    if (s.activeEncounterId !== encounterId || s.gameMode !== 'ENCOUNTER_STARTING') return false;
    set({ gameMode: 'BATTLE' });
    return true;
  },

  beginEncounterEnd: (encounterId) => {
    const s = get();
    if (s.activeEncounterId !== encounterId) return false;
    if (s.gameMode !== 'ENCOUNTER_STARTING' && s.gameMode !== 'BATTLE') return false;
    set({ gameMode: 'ENCOUNTER_ENDING', inputLocked: true });
    return true;
  },

  releaseEncounter: (encounterId, outcome, reason) => {
    const s = get();
    if (s.activeEncounterId !== encounterId || s.gameMode !== 'ENCOUNTER_ENDING') return false;
    set({
      activeEncounterId: null,
      sourceEntityId: null,
      lastEncounter: { id: encounterId, sourceEntityId: s.sourceEntityId, outcome, reason },
    });
    return true;
  },

  setEncounterCooldown: (until) => set({ encounterCooldown: until }),

  enterExploration: () => {
    const s = get();
    if (s.gameMode !== 'ENCOUNTER_ENDING' || s.activeEncounterId !== null) return false;
    set({ gameMode: 'EXPLORATION', inputLocked: false });
    return true;
  },

  resetEncounterState: () =>
    set({ gameMode: 'EXPLORATION', activeEncounterId: null, sourceEntityId: null, inputLocked: false }),

  setMode: (mode) => set({ mode }),
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),

  showDialog: (lines, onDone) => {
    if (!lines.length) {
      onDone?.();
      return;
    }
    set({ dialog: { lines, index: 0, onDone } });
  },
  advanceDialog: () => {
    const d = get().dialog;
    if (!d) return;
    if (d.index + 1 < d.lines.length) {
      set({ dialog: { ...d, index: d.index + 1 } });
    } else {
      set({ dialog: null });
      d.onDone?.();
    }
  },

  showToast: (text, ms = 2600) => {
    const id = ++toastId;
    set({ toast: { id, text } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, ms);
  },

  setTransition: (transition) => set({ transition }),
  pushLearn: (reqs) => set((s) => ({ learnQueue: [...s.learnQueue, ...reqs] })),
  shiftLearn: () => set((s) => ({ learnQueue: s.learnQueue.slice(1) })),
  setOnline: (online) => set({ online }),
  setInstallPrompt: (installPrompt) => set({ installPrompt }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
}));

/** Czy ruch po mapie ma być zablokowany (okno, dialog, spotkanie, walka, przejście). */
export function isOverworldBlocked(): boolean {
  const s = useUi.getState();
  return (
    s.mode !== 'overworld' ||
    s.gameMode !== 'EXPLORATION' ||
    s.inputLocked ||
    s.modal !== null ||
    s.dialog !== null ||
    s.transition ||
    s.learnQueue.length > 0
  );
}
