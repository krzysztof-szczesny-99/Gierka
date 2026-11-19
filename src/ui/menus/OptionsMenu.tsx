import { useEffect, useRef, useState } from 'react';
import { getRequestCount } from '../../api/pokeapi';
import { versionLabel } from '../../config/version';
import { cacheStats, clearApiCache } from '../../data/repository';
import { deleteSave, exportSave, getLastSaveAt, importSave, saveNow } from '../../data/saveGame';
import { errorMessage } from '../../services/creatureService';
import { checkForUpdate } from '../../services/updateService';
import { useGame, type Settings } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import { Modal } from '../components/common';

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function Toggle({ label, hint, k }: { label: string; hint?: string; k: keyof Settings }) {
  const value = useGame((s) => s.settings[k]);
  return (
    <label className="card row between" style={{ cursor: 'pointer' }}>
      <span>
        {label}
        {hint && <div className="muted small">{hint}</div>}
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => useGame.getState().updateSettings({ [k]: e.target.checked } as Partial<Settings>)}
        style={{ width: 26, height: 26, accentColor: 'var(--accent)' }}
      />
    </label>
  );
}

export function OptionsMenu() {
  const install = useUi((s) => s.installPrompt);
  const offlineReady = useUi((s) => s.offlineReady);
  const [cache, setCache] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [checking, setChecking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = (t: string) => useUi.getState().showToast(t);

  useEffect(() => {
    cacheStats()
      .then((s) => setCache(s.entries))
      .catch(() => setCache(null));
  }, []);

  const last = getLastSaveAt();

  return (
    <Modal title="Menu">
      <button
        className="btn btn-primary btn-block"
        onClick={() =>
          saveNow()
            .then(() => toast('Zapisano grę.'))
            .catch((e) => toast(errorMessage(e)))
        }
      >
        Zapisz teraz
      </button>
      <div className="muted small">
        Autozapis jest włączony{last ? ` · ostatni zapis: ${new Date(last).toLocaleTimeString('pl-PL')}` : ''}.
      </div>

      <Toggle k="useApiSprites" label="Grafiki stworzeń z PokéAPI" hint="Wyłącz, aby używać oryginalnych sylwetek zastępczych." />
      <Toggle k="showFollower" label="Towarzysz podąża za graczem" />
      <Toggle k="fastText" label="Szybkie komunikaty w walce" />
      <Toggle k="vibration" label="Wibracje (Android)" />

      <div className="card stack">
        <b>Instalacja na telefonie</b>
        {isStandalone() ? (
          <div className="small muted">Gra działa jako zainstalowana aplikacja.</div>
        ) : install ? (
          <button
            className="btn btn-amber"
            onClick={async () => {
              await install.prompt();
              await install.userChoice.catch(() => undefined);
              useUi.getState().setInstallPrompt(null);
            }}
          >
            Zainstaluj aplikację
          </button>
        ) : isIos() ? (
          <div className="small muted">Safari: przycisk „Udostępnij” → „Do ekranu początkowego”.</div>
        ) : (
          <div className="small muted">
            Użyj menu przeglądarki → „Zainstaluj aplikację” / „Dodaj do ekranu głównego”. Instalacja wymaga HTTPS.
          </div>
        )}
        <div className="small muted">Tryb offline: {offlineReady ? 'gotowy' : 'po pierwszym uruchomieniu przez HTTPS'}.</div>
      </div>

      <div className="card stack">
        <b>Zapis gry</b>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-small" onClick={() => exportSave()}>
            Eksportuj (JSON)
          </button>
          <button className="btn btn-small" onClick={() => fileRef.current?.click()}>
            Importuj
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                await importSave(f);
                toast('Wczytano zapis. Uruchom ponownie, aby odświeżyć mapę.');
              } catch (err) {
                toast(errorMessage(err));
              }
            }}
          />
        </div>
        {!confirmReset ? (
          <button className="btn btn-small btn-danger" onClick={() => setConfirmReset(true)}>
            Usuń zapis i zacznij od nowa
          </button>
        ) : (
          <div className="row">
            <button
              className="btn btn-small btn-danger"
              onClick={async () => {
                await deleteSave();
                useGame.getState().resetGame();
                const ui = useUi.getState();
                ui.closeModal();
                ui.setMode('title');
              }}
            >
              Tak, usuń
            </button>
            <button className="btn btn-small" onClick={() => setConfirmReset(false)}>
              Anuluj
            </button>
          </div>
        )}
      </div>

      <div className="card stack small">
        <b>Dane</b>
        <div className="muted">
          Zbuforowane rekordy PokéAPI: {cache ?? '…'} · zapytania w tej sesji: {getRequestCount()}
        </div>
        <button
          className="btn btn-small"
          onClick={async () => {
            await clearApiCache();
            setCache(0);
            toast('Wyczyszczono bufor danych API.');
          }}
        >
          Wyczyść bufor danych
        </button>
      </div>

      <div className="card stack small">
        <b>Wersja gry</b>
        <div className="muted" data-testid="options-version">
          {versionLabel()}
        </div>
        <button
          className="btn btn-small"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            await saveNow().catch(() => undefined);
            const r = await checkForUpdate();
            setChecking(false);
            const text: Record<typeof r, string> = {
              'up-to-date': 'Masz najnowszą wersję gry.',
              downloading: 'Pobieram nową wersję — gra za chwilę uruchomi się ponownie (postęp jest zapisany).',
              offline: 'Brak internetu — nie można sprawdzić aktualizacji.',
              unsafe: 'Aktualizację można sprawdzić poza walką.',
              'no-registration': 'Aktualizacje działają w aplikacji otwartej przez HTTPS (np. z ekranu głównego).',
              error: 'Nie udało się sprawdzić aktualizacji. Spróbuj ponownie za chwilę.',
            };
            toast(text[r]);
          }}
        >
          {checking ? 'Sprawdzam…' : 'Sprawdź aktualizację'}
        </button>
      </div>

      <div className="card small muted">
        Szlaki Dziczy 0.1 (etap 1) — niekomercyjny prototyp fanowski. Dane o stworzeniach: PokéAPI. Nazwy i grafiki stworzeń
        należą do ich właścicieli; mapy, teksty, interfejs, grafika postaci i kafelków oraz kod są oryginalne.
      </div>
      <button
        className="btn btn-block"
        onClick={async () => {
          await saveNow().catch(() => undefined);
          const ui = useUi.getState();
          ui.closeModal();
          ui.setMode('title');
        }}
      >
        Wyjdź do ekranu tytułowego
      </button>
    </Modal>
  );
}
