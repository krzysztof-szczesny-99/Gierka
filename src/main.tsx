import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { DEBUG, debugSeed, expose } from './debug';
import { NATURES } from './config/natures';
import { WORLD } from './config/world';
import { getGrowth } from './data/repository';
import { createRng, createSequenceRng, gameRng, rngFromNext } from './engine/rng';
import { bus } from './game/eventBus';
import { installInputGuards, joystick, virtualInput } from './game/input';
import { validateWorld } from './game/world';
import { TRAINERS } from './config/trainers';
import { validateTrainers } from './game/trainers';
import { buildStarter } from './services/creatureService';
import { configureEncounterDeps } from './services/encounterService';
import { evolutionInfo, levelEvolutionFor } from './services/evolutionService';
import { cleanupSpriteCacheOnce } from './services/spriteCache';
import { APP_VERSION } from './config/version';
import { saveNow } from './data/saveGame';
import {
  browserForceUpdateEnv,
  checkForUpdate,
  forceUpdate,
  httpVersionSource,
  installUpdateChecks,
  setForceUpdateEnv,
  setUpdateRegistration,
  setVersionSource,
} from './services/updateService';
import { useBattle } from './state/battleStore';
import { useGame } from './state/gameStore';
import { useUi, type BeforeInstallPromptEvent } from './state/uiStore';
import './ui/styles/global.css';

// Tryb ?debug&seed=N: powtarzalna losowość gry (testy E2E). Bez ?debug parametr jest ignorowany.
const seed = debugSeed();
if (seed !== null) gameRng.reseed(seed);

expose('stores', { useGame, useUi, useBattle, bus });
expose('input', { joystick, virtualInput });
expose('update', { checkForUpdate, forceUpdate });
expose('world', { WORLD, validateWorld });
expose('trainers', { TRAINERS, validateTrainers });
// Scenariusze E2E (tylko ?debug): budowanie stworzenia z danych PokéAPI i stan ewolucji.
expose('creatures', { buildStarter, evolutionInfo, levelEvolutionFor, getGrowth, NATURES, rng: gameRng });

// Tryb diagnostyczny: spójność danych świata (błędy trafiają do konsoli — test E2E je wykrywa).
if (DEBUG) {
  const issues = validateWorld();
  if (issues.length) console.error('Błędy w danych świata:', issues);
  const trainerIssues = validateTrainers();
  if (trainerIssues.length) console.error('Błędy w danych trenerów:', trainerIssues);
}
// Kontrolowane źródło losowości spotkań dla testów E2E (tylko ?debug).
expose('encounter', { configure: configureEncounterDeps, createRng, createSequenceRng, rngFromNext, seed });

// Joystick zatrzymuje się po utracie fokusu, ukryciu/zamknięciu strony i obrocie ekranu.
installInputGuards(window, document);

// Zdarzenie instalacji może przyjść bardzo wcześnie — nasłuchujemy przed startem Reacta.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  useUi.getState().setInstallPrompt(e as BeforeInstallPromptEvent);
});
window.addEventListener('appinstalled', () => useUi.getState().setInstallPrompt(null));

// Po wymuszonej aktualizacji adres ma parametr ?u=… (omija bufor) — usuwamy go, zostawiając resztę.
{
  const url = new URL(window.location.href);
  if (url.searchParams.has('u')) {
    url.searchParams.delete('u');
    window.history.replaceState(null, '', url.toString());
  }
}

// Service worker działa tylko w bezpiecznym kontekście (HTTPS lub localhost).
if ('serviceWorker' in navigator && window.isSecureContext) {
  cleanupSpriteCacheOnce();
  // Porównanie z version.json na serwerze i wymuszona aktualizacja (iOS bywa „przyklejony” do starej wersji).
  const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  setVersionSource(httpVersionSource(APP_VERSION, `${base}version.json`));
  setForceUpdateEnv(browserForceUpdateEnv(saveNow));
  registerSW({
    immediate: true,
    // Aplikacja z ekranu głównego bywa tylko wznawiana z tła — sprawdzamy aktualizacje jawnie (updateService).
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setUpdateRegistration(registration);
      void checkForUpdate();
      installUpdateChecks(window, document);
    },
    onOfflineReady() {
      useUi.getState().setOfflineReady(true);
      useUi.getState().showToast('Gra jest gotowa do działania offline.');
    },
    onRegisterError(err) {
      console.warn('Rejestracja service workera nie powiodła się', err);
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
