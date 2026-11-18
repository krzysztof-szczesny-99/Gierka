import { useState } from 'react';
import { ITEMS, type ItemId } from '../../config/items';
import { useGame } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import { CapsuleIcon, Modal } from '../components/common';
import { CreatureRow } from './PartyMenu';

export function BagMenu() {
  const bag = useGame((s) => s.bag);
  const party = useGame((s) => s.party);
  const [using, setUsing] = useState<ItemId | null>(null);
  const items = (Object.keys(ITEMS) as ItemId[]).filter((id) => (bag[id] ?? 0) > 0);

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
              {def.kind === 'capture' ? <CapsuleIcon size={22} plus={id === 'capsule-plus'} /> : <span style={{ width: 22, textAlign: 'center' }}>🌿</span>}
              <div>
                <b>{def.name}</b> <span className="muted">×{bag[id]}</span>
                <div className="muted small">{def.description}</div>
              </div>
            </div>
            {def.usableInField ? (
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
