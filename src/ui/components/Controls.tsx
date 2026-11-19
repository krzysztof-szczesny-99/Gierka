// Sterowanie dotykowe: joystick ekranowy (rozwinięcie dawnego pada kierunkowego) oraz przyciski A/B.
// Komponent tylko przekazuje położenie palca do czystej logiki w game/input.ts (normalizacja, martwa strefa,
// histereza kierunku, zatrzymanie po puszczeniu, pointercancel). Utratę fokusu, ukrycie strony i obrót
// ekranu obsługują strażnicy globalni (installInputGuards w main.tsx).

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Dir } from '../../engine/types';
import {
  joystick,
  joystickDown,
  joystickMove,
  joystickUp,
  onJoystickChange,
  queueAction,
  releaseInput,
  virtualInput,
  type JoystickVector,
} from '../../game/input';

const ARROWS: Record<Dir, string> = { up: '▲', down: '▼', left: '◀', right: '▶' };

export function Joystick() {
  const ref = useRef<HTMLDivElement>(null);
  const [v, setV] = useState<JoystickVector>(joystick.vector);

  useEffect(() => {
    const off = onJoystickChange(setV);
    return () => {
      off();
      releaseInput('unmount');
    };
  }, []);

  const offset = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const r = (ref.current ?? e.currentTarget).getBoundingClientRect();
    return [e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)];
  };

  return (
    <div
      ref={ref}
      className={`joystick ${v.dir ? 'active' : ''}`}
      role="group"
      aria-label="Joystick ruchu"
      data-dir={v.dir ?? ''}
      onPointerDown={(e) => {
        e.preventDefault();
        const [dx, dy] = offset(e);
        if (joystickDown(e.pointerId, dx, dy)) {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* wskaźnik już nieaktywny */
          }
        }
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== joystick.pointerId) return;
        const [dx, dy] = offset(e);
        joystickMove(e.pointerId, dx, dy);
      }}
      onPointerUp={(e) => joystickUp(e.pointerId, 'pointerup')}
      onPointerCancel={(e) => joystickUp(e.pointerId, 'pointercancel')}
      onLostPointerCapture={(e) => joystickUp(e.pointerId, 'pointercancel')}
      onContextMenu={(e) => e.preventDefault()}
    >
      {(Object.keys(ARROWS) as Dir[]).map((d) => (
        <div key={d} className={`arrow ${d} ${v.dir === d ? 'on' : ''}`} aria-hidden>
          {ARROWS[d]}
        </div>
      ))}
      <div className="knob" style={{ transform: `translate(${v.knobX}px, ${v.knobY}px)` }} />
    </div>
  );
}

export function ActionButtons() {
  const [run, setRun] = useState(virtualInput.run);
  return (
    <div className="ab">
      <button
        className={`btn-b ${run ? 'on' : ''}`}
        aria-pressed={run}
        aria-label="Bieg (przełącz)"
        onPointerDown={(e) => {
          e.preventDefault();
          virtualInput.run = !virtualInput.run;
          setRun(virtualInput.run);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        B<br />
        <small>{run ? 'bieg' : 'chód'}</small>
      </button>
      <button
        className="btn-a"
        aria-label="Akcja"
        onPointerDown={(e) => {
          e.preventDefault();
          queueAction();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        A
      </button>
    </div>
  );
}
