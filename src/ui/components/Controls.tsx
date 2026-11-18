// Sterowanie dotykowe: pad kierunkowy (działa jak drążek — wystarczy przesuwać kciuk) oraz przyciski A/B.

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Dir } from '../../engine/types';
import { queueAction, virtualInput } from '../../game/input';

const ARROWS: Record<Dir, string> = { up: '▲', down: '▼', left: '◀', right: '▶' };
const DEAD_ZONE = 14;

export function DPad() {
  const ref = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [dir, setDir] = useState<Dir | null>(null);

  useEffect(
    () => () => {
      virtualInput.dir = null;
    },
    [],
  );

  const update = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let d: Dir | null = null;
    if (Math.hypot(dx, dy) > DEAD_ZONE) {
      d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    }
    virtualInput.dir = d;
    setDir(d);
  };

  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointer.current) return;
    pointer.current = null;
    virtualInput.dir = null;
    setDir(null);
  };

  return (
    <div
      ref={ref}
      className="dpad"
      role="group"
      aria-label="Kierunki ruchu"
      onPointerDown={(e) => {
        e.preventDefault();
        if (pointer.current !== null) return;
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === pointer.current) update(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      {(Object.keys(ARROWS) as Dir[]).map((d) => (
        <div key={d} className={`arm ${d} ${dir === d ? 'on' : ''}`}>
          {ARROWS[d]}
        </div>
      ))}
      <div className="hub" />
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
