import { useEffect, useRef, useState } from 'react';
import { STARTER_GENERATIONS, STARTER_LEVEL } from '../../config/encounters';
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

interface Selection {
  gen: number;
  idx: number;
}

export function StarterScreen() {
  const [gen, setGen] = useState(1);
  const [byGen, setByGen] = useState<Record<number, Option[]>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const loaded = useRef(new Set<number>());
  const inflight = useRef(new Set<number>());

  // Startery danej generacji pobieramy dopiero po jej otwarciu (mniej zapytań do PokéAPI).
  useEffect(() => {
    const g = gen;
    if (loaded.current.has(g) || inflight.current.has(g)) return;
    const def = STARTER_GENERATIONS.find((x) => x.gen === g);
    if (!def) return;
    inflight.current.add(g);
    setErrors((m) => ({ ...m, [g]: '' }));
    Promise.all(def.starters.map((s) => buildStarter(s, STARTER_LEVEL, gameRng)))
      .then((list) => {
        loaded.current.add(g);
        setByGen((m) => ({ ...m, [g]: list }));
        setSelected((sel) => sel ?? { gen: g, idx: 0 });
      })
      .catch((e) => setErrors((m) => ({ ...m, [g]: errorMessage(e) })))
      .finally(() => inflight.current.delete(g));
  }, [gen, retry]);

  const options = byGen[gen];
  const chosen = selected ? byGen[selected.gen]?.[selected.idx] : undefined;
  const chosenGen = selected ? STARTER_GENERATIONS.find((g) => g.gen === selected.gen) : undefined;
  const currentGen = STARTER_GENERATIONS.find((g) => g.gen === gen)!;

  async function confirm() {
    if (!chosen) return;
    setBusy(true);
    const playerName = name.trim() || 'Tropiciel';
    useGame.getState().newGame(playerName, chosen.creature, dexInfo(chosen.bundle.pokemon, chosen.bundle.species));
    await saveNow().catch(() => undefined);
    const ui = useUi.getState();
    ui.setMode('overworld');
    ui.showDialog([
      `Witaj na Polanie Startowej, ${playerName}! ${chosen.creature.name} będzie Twoim pierwszym towarzyszem.`,
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
          Wybierz generację, a potem jednego z trzech starterów. Typy decydują o skuteczności ruchów w walce.
        </p>

        <div className="gen-grid" role="tablist" aria-label="Generacje">
          {STARTER_GENERATIONS.map((g) => (
            <button
              key={g.gen}
              role="tab"
              aria-selected={g.gen === gen}
              className={g.gen === gen ? 'on' : ''}
              onClick={() => setGen(g.gen)}
            >
              <span>
                Gen. {g.roman}
                {selected?.gen === g.gen ? ' •' : ''}
              </span>
              <small>{g.region}</small>
            </button>
          ))}
        </div>

        {!options && !errors[gen] && (
          <div className="starter-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="starter-card muted small" style={{ display: 'flex', justifyContent: 'center' }}>
                Pobieranie starterów generacji {currentGen.roman}…
              </div>
            ))}
          </div>
        )}
        {errors[gen] && (
          <div className="card stack">
            <div className="small">{errors[gen]}</div>
            <button className="btn" onClick={() => setRetry((r) => r + 1)}>
              Spróbuj ponownie
            </button>
          </div>
        )}

        {options && (
          <div className="starter-grid">
            {options.map((o, i) => {
              const isSel = selected?.gen === gen && selected.idx === i;
              return (
                <button
                  key={o.creature.uid}
                  className={`starter-card ${isSel ? 'selected' : ''}`}
                  onClick={() => setSelected({ gen, idx: i })}
                  aria-pressed={isSel}
                >
                  <div className="sprite-box" style={{ height: 96 }}>
                    <CreatureSprite
                      sprites={o.bundle.pokemon.sprites}
                      types={o.creature.types}
                      name={o.creature.name}
                      scale={1}
                      maxSize={96}
                    />
                  </div>
                  <div>
                    <h3>{o.creature.name}</h3>
                    <TypeBadges types={o.creature.types} />
                    <div className="muted small" style={{ marginTop: 6 }}>
                      Poz. {o.creature.level} · {o.creature.moves.length} {o.creature.moves.length === 1 ? 'ruch' : 'ruchy'} ·{' '}
                      {currentGen.region}
                    </div>
                  </div>
                </button>
              );
            })}
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

        <button className="btn btn-primary btn-block" disabled={!chosen || busy} onClick={() => void confirm()}>
          {chosen ? `Ruszamy w drogę z: ${chosen.creature.name}!` : 'Ruszamy w drogę!'}
        </button>
        {chosen && chosenGen && chosenGen.gen !== gen && (
          <div className="muted small" style={{ textAlign: 'center', marginTop: -6 }}>
            Wybrany starter pochodzi z generacji {chosenGen.roman} ({chosenGen.region}).
          </div>
        )}
        <button className="btn btn-block" onClick={() => useUi.getState().setMode('title')}>
          Wróć
        </button>
      </div>
    </div>
  );
}
