import { useEffect, useState } from 'react';
import { STARTER_LEVEL, STARTERS } from '../../config/encounters';
import { saveNow } from '../../data/saveGame';
import { gameRng } from '../../engine/rng';
import type { Creature } from '../../engine/types';
import { buildStarter, dexInfo, errorMessage, type CreatureBundle } from '../../services/creatureService';
import { useGame } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import { TypeBadges } from '../components/common';
import { CreatureSprite } from '../components/CreatureSprite';

interface Option {
  creature: Creature;
  bundle: CreatureBundle;
}

export function StarterScreen() {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all(STARTERS.map((s) => buildStarter(s, STARTER_LEVEL, gameRng)))
      .then((list) => alive && setOptions(list))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, []);

  async function confirm() {
    if (!options) return;
    setBusy(true);
    const opt = options[selected];
    const playerName = name.trim() || 'Tropiciel';
    useGame.getState().newGame(playerName, opt.creature, dexInfo(opt.bundle.pokemon, opt.bundle.species));
    await saveNow().catch(() => undefined);
    const ui = useUi.getState();
    ui.setMode('overworld');
    ui.showDialog([
      `Witaj na Polanie Startowej, ${playerName}! ${opt.creature.name} będzie Twoim pierwszym towarzyszem.`,
      'Ruch: pad po lewej albo dotknij miejsca na mapie. A — interakcja (tabliczki, drzwi), B — przełącza bieg.',
      'Dzikie stworzenia widać na mapie. Podejdź do jednego, aby rozpocząć walkę — niektóre same ruszą w Twoją stronę!',
      'Stacja Opieki (miętowy dach) leczy drużynę, a w Kramie (bursztynowy dach) kupisz kapsuły i napary.',
      'Zadania czekają w Dzienniku. Postęp zapisuje się automatycznie. Powodzenia!',
    ]);
  }

  return (
    <div className="screen">
      <div className="title-wrap" style={{ textAlign: 'left' }}>
        <h2 style={{ margin: 0 }}>Wybierz pierwszego towarzysza</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Każdy ma inny typ. Typy decydują o skuteczności ruchów w walce.
        </p>

        {!options && !error && <div className="card muted">Pobieranie danych stworzeń…</div>}
        {error && (
          <div className="card stack">
            <div className="small">{error}</div>
            <button className="btn" onClick={() => location.reload()}>
              Spróbuj ponownie
            </button>
          </div>
        )}

        {options && (
          <div className="starter-grid">
            {options.map((o, i) => (
              <button
                key={o.creature.uid}
                className={`starter-card ${i === selected ? 'selected' : ''}`}
                onClick={() => setSelected(i)}
                aria-pressed={i === selected}
              >
                <div className="sprite-box" style={{ height: 96 }}>
                  <CreatureSprite sprites={o.bundle.pokemon.sprites} types={o.creature.types} name={o.creature.name} scale={1} maxSize={96} />
                </div>
                <div>
                  <h3>{o.creature.name}</h3>
                  <TypeBadges types={o.creature.types} />
                  <div className="muted small" style={{ marginTop: 6 }}>
                    Poz. {o.creature.level} · {o.creature.moves.length} ruchy · gen. {o.bundle.species.generation}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <label className="stack small">
          <span className="muted">Twoje imię (opcjonalnie)</span>
          <input
            className="text-input"
            value={name}
            maxLength={14}
            placeholder="Tropiciel"
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </label>

        <button className="btn btn-primary btn-block" disabled={!options || busy} onClick={() => void confirm()}>
          Ruszamy w drogę!
        </button>
        <button className="btn btn-block" onClick={() => useUi.getState().setMode('title')}>
          Wróć
        </button>
      </div>
    </div>
  );
}
