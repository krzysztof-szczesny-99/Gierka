import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { DEBUG, debugSeed, expose } from './debug';
import { WORLD } from './config/world';
import { createRng, createSequenceRng, gameRng, rngFromNext } from './engine/rng';
import { bus } from './game/eventBus';
import { installInputGuards, joystick, virtualInput } from './game/input';
import { validateWorld } from './game/world';
import { configureEncounterDeps } from './services/encounterService';
import { checkForUpdate, installUpdateChecks, setUpdateRegistration } from './services/updateService';
import { useBattle } from './state/battleStore';
import { useGame } from './state/gameStore';
import { useUi, type BeforeInstallPromptEvent } from './state/uiStore';
import './ui/styles/global.css';

// Tryb ?debug&seed=N: powtarzalna losowość gry (testy E2E). Bez ?debug parametr jest ignorowany.
const seed = debugSeed();
if (seed !== null) gameRng.reseed(seed);

expose('stores', { useGame, useUi, useBattle, bus });
expose('input', { joystick, virtualInput });
expose('update', { checkForUpdate });
expose('world', { WORLD, validateWorld });

// Tryb diagnostyczny: spójność danych świata (błędy trafiają do konsoli — test E2E je wykrywa).
if (DEBUG) {
  const issues = validateWorld();
  if (issues.length) console.error('Błędy w danych świata:', issues);
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

// Service worker działa tylko w bezpiecznym kontekście (HTTPS lub localhost).
if ('serviceWorker' in navigator && window.isSecureContext) {
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
