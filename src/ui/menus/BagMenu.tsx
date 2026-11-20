import { useEffect, useState } from 'react';
import { ITEMS, type ItemDef, type ItemId } from '../../config/items';
import { displayName } from '../../engine/creature';
import { itemEvolutionFor } from '../../services/evolutionService';
import { useGame } from '../../state/gameStore';
import { useUi, type EvolutionRequest } from '../../state/uiStore';
import { CapsuleIcon, Modal } from '../components/common';
import { CreatureRow } from './PartyMenu';

export function ItemIcon({ def }: { def: ItemDef }) {
  if (def.kind === 'capture') return <CapsuleIcon size={22} plus={def.id === 'capsule-plus'} />;
  const icon = def.kind === 'held' ? (def.consumable ? '🫐' : '🎒') : def.kind === 'evolution' ? '💎' : '🌿';
  return (
    <span style={{ width: 22, textAlign: 'center' }} aria-hidden>
      {icon}
    </span>
  );
}

export function BagMenu() {
  const bag = useGame((s) => s.bag);
  const party = useGame((s) => s.party);
  const [using, setUsing] = useState<ItemId | null>(null);
  const [equipping, setEquipping] = useState<ItemId | null>(null);
  const [evolving, setEvolving] = useState<ItemId | null>(null);
  const items = (Object.keys(ITEMS) as ItemId[]).filter((id) => (bag[id] ?? 0) > 0);

  if (equipping) {
    const def = ITEMS[equipping];
    return (
      <Modal title={`Załóż: ${def.name}`} onClose={() => setEquipping(null)}>
        <div className="muted small">{def.description}</div>
        <div className="muted small">Założenie zabiera 1 sztukę z torby; poprzedni przedmiot stworzenia wraca do torby.</div>
        {party.map((c) => (
          <div key={c.uid} className="stack" style={{ gap: 2 }}>
            <CreatureRow
              c={c}
              disabled={c.heldItemId === equipping}
              onClick={() => {
                const err = useGame.getState().equipItem(c.uid, equipping);
                useUi.getState().showToast(err ?? `${displayName(c)} trzyma: ${def.name}.`);
                setEquipping(null);
              }}
            />
            <div className="muted small">Trzyma: {c.heldItemId && c.heldItemId in ITEMS ? ITEMS[c.heldItemId as ItemId].name : 'nic'}</div>
          </div>
        ))}
        <button className="btn" onClick={() => setEquipping(null)}>
          ← Wróć do torby
        </button>
      </Modal>
    );
  }

  if (evolving) return <EvolutionItemPicker itemId={evolving} onBack={() => setEvolving(null)} />;

  if (using) {
    const def = ITEMS[using];
    return (
      <Modal title={`Użyj: ${def.name}`} onClose={() => setUsing(null)}>
        <div className="muted small">{def.description}</div>
        {party.map((c) => {
          const ok = def.kind === 'heal' ? c.hp > 0 && c.hp < c.stats.hp : !!c.status;
          return (
            <CreatureRow
              key={c.uid}
              c={c}
              disabled={!ok}
              onClick={() => {
                const msg = useGame.getState().useFieldItem(using, c.uid);
                useUi.getState().showToast(msg ?? 'To nic nie da.');
                if ((useGame.getState().bag[using] ?? 0) <= 0) setUsing(null);
              }}
            />
          );
        })}
        <button className="btn" onClick={() => setUsing(null)}>
          ← Wróć do torby
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Torba">
      {items.length === 0 && <div className="muted">Torba jest pusta. Zajrzyj do Kramu.</div>}
      {items.map((id) => {
        const def = ITEMS[id];
        return (
          <div key={id} className="card row between">
            <div className="row" style={{ gap: 10 }}>
              <ItemIcon def={def} />
              <div>
                <b>{def.name}</b> <span className="muted">×{bag[id]}</span>
                <div className="muted small">{def.description}</div>
              </div>
            </div>
            {def.kind === 'held' ? (
              <button className="btn btn-small btn-primary" onClick={() => setEquipping(id)}>
                Załóż
              </button>
            ) : def.kind === 'evolution' ? (
              <button className="btn btn-small btn-primary" onClick={() => setEvolving(id)}>
                Użyj
              </button>
            ) : def.usableInField ? (
              <button className="btn btn-small btn-primary" onClick={() => setUsing(id)}>
                Użyj
              </button>
            ) : (
              <span className="muted small">w walce</span>
            )}
          </div>
        );
      })}
    </Modal>
  );
}

/** Kamień ewolucji: wybór stworzenia, które może nim ewoluować (warunek z danych łańcucha w buforze). */
function EvolutionItemPicker({ itemId, onBack }: { itemId: ItemId; onBack: () => void }) {
  const party = useGame((s) => s.party);
  const def = ITEMS[itemId];
  const [options, setOptions] = useState<Record<string, EvolutionRequest | null> | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all(party.map((c) => itemEvolutionFor(c, itemId).catch(() => null))).then((list) => {
      if (!alive) return;
      const out: Record<string, EvolutionRequest | null> = {};
      party.forEach((c, i) => (out[c.uid] = list[i]));
      setOptions(out);
    });
    return () => {
      alive = false;
    };
  }, [party, itemId]);

  return (
    <Modal title={`Użyj: ${def.name}`} onClose={onBack}>
      <div className="muted small">{def.description}</div>
      {!options && <div className="muted small">Sprawdzam, kto może ewoluować…</div>}
      {party.map((c) => {
        const req = options?.[c.uid] ?? null;
        return (
          <div key={c.uid} className="stack" style={{ gap: 2 }}>
            <CreatureRow
              c={c}
              disabled={!req}
              onClick={() => {
                if (!req) return;
                useUi.getState().pushEvolutions([req]);
                onBack();
              }}
            />
            {options && <div className="muted small">{req ? `Może ewoluować w: ${req.toSpecies}` : 'Ten kamień nie działa na to stworzenie.'}</div>}
          </div>
        );
      })}
      <button className="btn" onClick={onBack}>
        ← Wróć do torby
      </button>
    </Modal>
  );
}
