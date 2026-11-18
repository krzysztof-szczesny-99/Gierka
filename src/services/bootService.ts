// Start aplikacji: zapis, autozapis, stan sieci, dane podstawowe.

import { OfflineError } from '../api/pokeapi';
import { requestPersistentStorage } from '../data/db';
import { preloadCore } from '../data/repository';
import { installAutosave, loadGame } from '../data/saveGame';
import { useGame } from '../state/gameStore';
import { useUi } from '../state/uiStore';
import { installEncounterHandlers } from './encounterService';

let booted = false;

export async function bootApp(): Promise<void> {
  if (booted) return;
  booted = true;
  const ui = useUi.getState();

  window.addEventListener('online', () => useUi.getState().setOnline(true));
  window.addEventListener('offline', () => useUi.getState().setOnline(false));

  installEncounterHandlers();
  installAutosave();
  void requestPersistentStorage();

  try {
    const data = await loadGame();
    if (data) useGame.getState().loadData(data);
  } catch (e) {
    console.error(e);
    ui.showToast('Nie udało się wczytać zapisu gry.');
  }
  ui.setMode('title');
}

/** Ładuje dane wymagane do walki (tabela typów, krzywe EXP). */
export async function ensureCoreData(onProgress?: (done: number, total: number) => void): Promise<void> {
  try {
    await preloadCore(onProgress);
  } catch (e) {
    if (e instanceof OfflineError) {
      throw new Error('Pierwsze uruchomienie wymaga internetu (pobranie danych z PokéAPI).');
    }
    throw e;
  }
}
