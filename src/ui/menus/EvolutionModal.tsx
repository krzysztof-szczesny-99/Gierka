import { useEffect, useState } from 'react';
import { getPokemon, getSpecies } from '../../data/repository';
import { displayName } from '../../engine/creature';
import type { PokemonData } from '../../engine/types';
import { cancelEvolution, performEvolution } from '../../services/evolutionService';
import { useGame } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import { Modal, TypeBadges, usePokemonData } from '../components/common';
import { CreatureSprite } from '../components/CreatureSprite';

/**
 * Okno ewolucji: „Ewoluuj” albo „Przerwij”. Pojawia się po komunikatach i nauce ruchów (po walce),
 * po użyciu kamienia z Torby albo z przycisku w Drużynie.
 */
export function EvolutionModal() {
  const req = useUi((s) => s.evolutionQueue[0]);
  const waiting = useUi((s) => s.dialog !== null || s.learnQueue.length > 0);
  const creature = useGame((s) => (req ? (s.party.find((c) => c.uid === req.uid) ?? s.storage.find((c) => c.uid === req.uid) ?? null) : null));
  const from = usePokemonData(creature?.pokemon);
  const to = useTargetData(req?.toSpeciesId ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (req && !creature) useUi.getState().shiftEvolution();
  }, [req, creature]);

  if (!req || !creature || waiting) return null;
  const name = displayName(creature);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await performEvolution(req);
      useUi.getState().shiftEvolution();
      if (r.ok) {
        // Komunikat ewolucji na mapie (okno Drużyny/Torby zamykamy, żeby go nie zasłaniało).
        useUi.getState().closeModal();
        useUi.getState().showDialog([r.message, 'Ruchy i doświadczenie zostają bez zmian.']);
      } else useUi.getState().showToast(r.message);
    } catch {
      useUi.getState().shiftEvolution();
      useUi.getState().showToast('Nie udało się pobrać danych ewolucji (brak sieci?). Spróbuj później z menu Drużyny.');
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    if (busy) return;
    const text = cancelEvolution(req);
    useUi.getState().shiftEvolution();
    if (text) useUi.getState().showToast(req.method === 'ITEM' ? `${text} Kamień zostaje w torbie.` : text);
  };

  return (
    <Modal title="Ewolucja" onClose={cancel}>
      <div className="evolution" data-testid="evolution-modal">
        <div className="evolution-pair">
          <div className="evolution-side">
            <div className="sprite-box" style={{ height: 96 }}>
              <CreatureSprite sprites={from?.sprites} shiny={creature.shiny} types={creature.types} name={creature.name} maxSize={96} fallbackSize={72} />
            </div>
            <b>{name}</b>
            <TypeBadges types={creature.types} />
          </div>
          <div className="evolution-arrow" aria-hidden>
            ➜
          </div>
          <div className="evolution-side">
            <div className="sprite-box" style={{ height: 96 }}>
              <CreatureSprite sprites={to?.sprites} shiny={creature.shiny} types={to?.types ?? creature.types} name={req.toSpecies} maxSize={96} fallbackSize={72} />
            </div>
            <b>{prettyName(req.toSpecies)}</b>
            {to && <TypeBadges types={to.types} />}
          </div>
        </div>
        <div>
          Co się dzieje? <b>{name}</b> może ewoluować! <span className="muted small">({req.method === 'LEVEL' ? `warunek spełniony: ${req.condition}` : `przedmiot: ${req.condition}`})</span>
        </div>
        <div className="muted small">Poziom, doświadczenie, ruchy, natura i przedmiot zostają.</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-danger" onClick={cancel} disabled={busy}>
            Przerwij
          </button>
          <button className="btn btn-primary" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Ewoluuje…' : 'Ewoluuj'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Dane domyślnej formy gatunku docelowego (z bufora) — do podglądu sprite'a i typów. */
function useTargetData(speciesId: number | null): PokemonData | null {
  const [data, setData] = useState<PokemonData | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    if (!speciesId) return;
    getSpecies(speciesId)
      .then((sp) => getPokemon(sp.varieties.find((v) => v.isDefault)?.name ?? sp.name))
      .then((d) => alive && setData(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [speciesId]);
  return data;
}

function prettyName(slug: string): string {
  return slug
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
