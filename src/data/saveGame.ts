// Zapis i wczytywanie gry w IndexedDB + autozapis + eksport/import JSON.

import { SAVE_VERSION, useGame, type GameData } from '../state/gameStore';
import { useUi } from '../state/uiStore';
import { db } from './db';
import { migrateSave } from './migrations';

const SLOT = 'slot1';
const AUTOSAVE_DELAY = 2000;

/** Migracje zapisów między wersjami formatu — patrz src/data/migrations.ts. */
function migrate(data: unknown): GameData {
  return migrateSave(data);
}

export async function hasSave(): Promise<boolean> {
  return (await db.saves.get(SLOT).catch(() => undefined)) !== undefined;
}

export async function loadGame(): Promise<GameData | null> {
  const row = await db.saves.get(SLOT);
  if (!row) return null;
  return migrate(row.data);
}

let lastSaveAt = 0;
export function getLastSaveAt(): number {
  return lastSaveAt;
}

export async function saveNow(): Promise<void> {
  const s = useGame.getState();
  if (!s.started) return;
  const data = s.snapshot();
  await db.saves.put({ id: SLOT, data, version: SAVE_VERSION, updatedAt: Date.now() });
  lastSaveAt = Date.now();
}

export async function deleteSave(): Promise<void> {
  await db.saves.delete(SLOT);
}

let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function scheduleSave() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    saveNow().catch((e) => console.warn('Autozapis nie powiódł się', e));
  }, AUTOSAVE_DELAY);
}

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  saveNow().catch(() => undefined);
}

/** Autozapis: po każdej zmianie stanu (z opóźnieniem) oraz natychmiast przy ukryciu aplikacji. */
export function installAutosave(): void {
  if (installed) return;
  installed = true;
  useGame.subscribe((state, prev) => {
    if (!state.started) return;
    if (
      state.player !== prev.player ||
      state.party !== prev.party ||
      state.storage !== prev.storage ||
      state.bag !== prev.bag ||
      state.dex !== prev.dex ||
      state.stats !== prev.stats ||
      state.questsClaimed !== prev.questsClaimed ||
      state.flags !== prev.flags ||
      state.earnedBadges !== prev.earnedBadges ||
      state.completedChallenges !== prev.completedChallenges ||
      state.unlockedConnections !== prev.unlockedConnections ||
      state.settings !== prev.settings
    ) {
      scheduleSave();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);

  // Licznik czasu gry (tylko gdy karta jest widoczna i trwa rozgrywka).
  setInterval(() => {
    const mode = useUi.getState().mode;
    if (document.visibilityState === 'visible' && (mode === 'overworld' || mode === 'battle')) {
      useGame.getState().addPlayTime(10_000);
    }
  }, 10_000);
}

export function exportSave(): void {
  const data = useGame.getState().snapshot();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `szlaki-dziczy-zapis-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function importSave(file: File): Promise<void> {
  const text = await file.text();
  const data = migrate(JSON.parse(text) as unknown);
  if (!Array.isArray(data.party) || !data.player) throw new Error('To nie wygląda na zapis tej gry.');
  useGame.getState().loadData(data);
  await saveNow();
}
