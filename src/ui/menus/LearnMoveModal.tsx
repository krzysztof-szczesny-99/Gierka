import { useEffect, useState } from 'react';
import { TYPE_COLOR, prettySlug, typeLabel } from '../../config/text';
import { displayName } from '../../engine/creature';
import { describeMove } from '../../engine/moves';
import type { MoveData } from '../../engine/types';
import { loadMovesSafe } from '../../services/creatureService';
import { useGame } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import { Modal } from '../components/common';

/** Nauka nowego ruchu, gdy stworzenie zna już 4 ruchy. */
export function LearnMoveModal() {
  const req = useUi((s) => s.learnQueue[0]);
  const dialogOpen = useUi((s) => s.dialog !== null);
  const creature = useGame((s) => (req ? (s.party.find((c) => c.uid === req.uid) ?? null) : null));
  const [known, setKnown] = useState<Record<string, MoveData>>({});

  useEffect(() => {
    if (!creature) return;
    let alive = true;
    loadMovesSafe(creature.moves.map((m) => m.name)).then((m) => alive && setKnown(m));
    return () => {
      alive = false;
    };
  }, [creature]);

  useEffect(() => {
    if (req && !creature) useUi.getState().shiftLearn();
  }, [req, creature]);

  if (!req || !creature || dialogOpen) return null;
  const name = displayName(creature);
  const finish = (text: string) => {
    useUi.getState().shiftLearn();
    useUi.getState().showToast(text);
  };

  return (
    <Modal title="Nowy ruch" onClose={() => finish(`${name} nie uczy się ruchu ${req.move.displayName}.`)}>
      <div>
        <b>{name}</b> chce nauczyć się ruchu <b>{req.move.displayName}</b>, ale zna już 4 ruchy.
      </div>
      <div className="card small" style={{ borderLeft: `4px solid ${TYPE_COLOR[req.move.type] ?? 'var(--line)'}` }}>
        <b>{req.move.displayName}</b> · {typeLabel(req.move.type)}
        <div className="muted">{describeMove(req.move)}</div>
      </div>
      <div className="muted small">Którego ruchu zapomnieć?</div>
      {creature.moves.map((m, i) => {
        const data = known[m.name];
        return (
          <button
            key={m.name}
            className="btn btn-block"
            style={{ justifyContent: 'space-between', borderLeft: `4px solid ${TYPE_COLOR[data?.type ?? ''] ?? 'var(--line)'}` }}
            onClick={() => {
              useGame.getState().learnMove(creature.uid, req.move, i);
              finish(`${name} zapomina ${data?.displayName ?? prettySlug(m.name)} i uczy się ruchu ${req.move.displayName}!`);
            }}
          >
            <span>{data?.displayName ?? prettySlug(m.name)}</span>
            <span className="muted small">{data ? typeLabel(data.type) : ''}</span>
          </button>
        );
      })}
      <button className="btn btn-danger btn-block" onClick={() => finish(`${name} nie uczy się ruchu ${req.move.displayName}.`)}>
        Nie ucz się
      </button>
    </Modal>
  );
}
