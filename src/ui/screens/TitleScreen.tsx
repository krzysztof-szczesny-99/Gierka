import { useState } from 'react';
import { errorMessage } from '../../services/creatureService';
import { ensureCoreData } from '../../services/bootService';
import { useGame } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import { GemLogo } from '../components/common';

export function TitleScreen() {
  const started = useGame((s) => s.started);
  const playerName = useGame((s) => s.player.name);
  const partySize = useGame((s) => s.party.length);
  const online = useUi((s) => s.online);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  async function go(target: 'overworld' | 'starter') {
    setError(null);
    setProgress({ done: 0, total: 1 });
    try {
      await ensureCoreData((done, total) => setProgress({ done, total }));
      useUi.getState().setMode(target);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="screen">
      <div className="title-wrap">
        <GemLogo className="title-gem" />
        <h1 className="logo">
          Szlaki <span>Dziczy</span>
        </h1>
        <p className="tagline">Prototyp RPG o tropieniu i kolekcjonowaniu stworzeń</p>

        {progress ? (
          <div className="stack">
            <div className="muted small">Pobieranie danych podstawowych… {progress.done}/{progress.total}</div>
            <div className="progress">
              <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
          </div>
        ) : (
          <div className="stack">
            {started && partySize > 0 && (
              <button className="btn btn-primary btn-block" onClick={() => void go('overworld')}>
                Kontynuuj — {playerName}
              </button>
            )}
            {!confirmNew ? (
              <button
                className={`btn btn-block ${started ? '' : 'btn-primary'}`}
                onClick={() => (started ? setConfirmNew(true) : void go('starter'))}
              >
                Nowa gra
              </button>
            ) : (
              <div className="card stack">
                <div className="small">Rozpoczęcie nowej gry nadpisze obecny zapis po wyborze startera. Kontynuować?</div>
                <div className="row">
                  <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => void go('starter')}>
                    Tak, nowa gra
                  </button>
                  <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmNew(false)}>
                    Anuluj
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {error && <div className="card small" style={{ borderColor: 'var(--danger)' }}>{error}</div>}
        {!online && <div className="chip offline" style={{ alignSelf: 'center' }}>Tryb offline — dostępne tylko zbuforowane dane</div>}

        <p className="fineprint">
          Niekomercyjny projekt fanowski. Dane: PokéAPI (pokeapi.co). Nazwy i grafiki stworzeń należą do ich prawnych
          właścicieli; mapy, interfejs i kod są oryginalne.
        </p>
      </div>
    </div>
  );
}
