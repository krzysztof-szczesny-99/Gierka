// Stan interfejsu (nie jest zapisywany): tryb ekranu, okna, dialogi, komunikaty, kolejka nauki ruchów.

import { create } from 'zustand';
import type { MoveData } from '../engine/types';

export type Mode = 'boot' | 'title' | 'starter' | 'overworld' | 'battle';
export type ModalId = 'party' | 'bag' | 'atlas' | 'journal' | 'shop' | 'options';

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

/** Czy ruch po mapie ma być zablokowany (okno, dialog, walka, przejście). */
export function isOverworldBlocked(): boolean {
  const s = useUi.getState();
  return s.mode !== 'overworld' || s.modal !== null || s.dialog !== null || s.transition || s.learnQueue.length > 0;
}
