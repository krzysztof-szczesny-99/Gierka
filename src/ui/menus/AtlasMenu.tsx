import { useEffect, useState } from 'react';
import { getSpeciesCount } from '../../data/repository';
import { useGame } from '../../state/gameStore';
import { Modal, TypeBadges } from '../components/common';
import { BlobSprite } from '../components/CreatureSprite';

/** Atlas: odkryte gatunki (tylko dane liczbowe i typy — bez oficjalnych opisów). */
export function AtlasMenu() {
  const dex = useGame((s) => s.dex);
  const useApi = useGame((s) => s.settings.useApiSprites);
  const [total, setTotal] = useState<number | null>(null);
  const entries = Object.values(dex).sort((a, b) => a.id - b.id);
  const seen = entries.filter((e) => e.seen).length;
  const caught = entries.filter((e) => e.caught).length;

  useEffect(() => {
    getSpeciesCount()
      .then(setTotal)
      .catch(() => setTotal(null));
  }, []);

  return (
    <Modal title="Atlas">
      <div className="card row between">
        <span>
          Zobaczone: <b>{seen}</b>
        </span>
        <span>
          Złapane: <b>{caught}</b>
        </span>
        <span className="muted">z {total ?? '…'} gatunków</span>
      </div>
      {entries.length === 0 && <div className="muted small">Atlas uzupełnia się, gdy spotykasz stworzenia w walce.</div>}
      <div className="atlas-grid">
        {entries.map((e) => (
          <div key={e.id} className="atlas-cell">
            <div className="num">
              #{String(e.id).padStart(4, '0')} {e.caught ? '◆' : ''}
            </div>
            <div className="sprite-box" style={{ height: 64 }}>
              {useApi && e.sprite ? (
                <img className="sprite-img" src={e.sprite} alt={e.name} style={{ width: 64, opacity: e.caught ? 1 : 0.55 }} draggable={false} />
              ) : (
                <BlobSprite type={e.types[0] ?? 'normal'} size={52} />
              )}
            </div>
            <div style={{ fontWeight: 600 }}>{e.name}</div>
            <TypeBadges types={e.types} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
