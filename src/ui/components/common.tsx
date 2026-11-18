// Drobne, wielokrotnie używane komponenty interfejsu.

import { useEffect, useState, type ReactNode } from 'react';
import { STATUS_COLOR, TYPE_COLOR, typeLabel } from '../../config/text';
import { getPokemon } from '../../data/repository';
import { STATUS_LABEL } from '../../engine/battle/status';
import type { MajorStatus, PokemonData } from '../../engine/types';
import { useUi } from '../../state/uiStore';

export function HpBar({ hp, max }: { hp: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  const color = pct > 0.5 ? 'var(--hp-good)' : pct > 0.2 ? 'var(--hp-mid)' : 'var(--hp-low)';
  return (
    <div className="hpbar" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={hp} aria-label="Punkty życia">
      <div style={{ width: `${pct * 100}%`, background: color }} />
    </div>
  );
}

export function ExpBar({ progress }: { progress: number }) {
  return (
    <div className="expbar" aria-label="Doświadczenie">
      <div style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
    </div>
  );
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className="type-badge" style={{ background: TYPE_COLOR[type] ?? '#777' }}>
      {typeLabel(type)}
    </span>
  );
}

export function TypeBadges({ types }: { types: readonly string[] }) {
  return (
    <span className="badges">
      {types.map((t) => (
        <TypeBadge key={t} type={t} />
      ))}
    </span>
  );
}

export function StatusBadge({ status }: { status: MajorStatus | null }) {
  if (!status) return null;
  return (
    <span className="status-badge" style={{ background: STATUS_COLOR[status] }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function GenderMark({ gender }: { gender: 'M' | 'F' | 'N' }) {
  if (gender === 'N') return null;
  return <span style={{ color: gender === 'M' ? '#7fb2ec' : '#ef8fb5', marginLeft: 4 }}>{gender === 'M' ? '♂' : '♀'}</span>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  const close = onClose ?? (() => useUi.getState().closeModal());
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={close} aria-label="Zamknij">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Oryginalna kapsuła do łapania (pionowa kapsuła z klejnotem). */
export function CapsuleIcon({ size = 34, plus = false, className }: { size?: number; plus?: boolean; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 34 46" width={size} height={(size * 46) / 34} aria-hidden>
      <rect x="3" y="2" width="28" height="42" rx="14" fill="#1d2a2b" />
      <path d="M5 23 V16 A12 12 0 0 1 29 16 V23 Z" fill={plus ? '#e7a43c' : '#4fd1a5'} />
      <path d="M5 23 V30 A12 12 0 0 0 29 30 V23 Z" fill="#46607a" />
      <rect x="3" y="21" width="28" height="4" fill="#f2b84b" />
      <polygon points="17,15 23,23 17,31 11,23" fill="#d6ffef" stroke="#1d2a2b" strokeWidth="1.5" />
      <ellipse cx="11" cy="11" rx="3" ry="4" fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}

/** Klejnot z logo gry. */
export function GemLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden>
      <polyline points="7,57 22,47 16,38 35,32" fill="none" stroke="#f2b84b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points="37,8 51,26 37,44 23,26" fill="#4fd1a5" />
      <polygon points="37,17 44,26 37,35 30,26" fill="#d6ffef" />
    </svg>
  );
}

/** Dane wariantu z bufora/API (do sprite'ów w menu). */
export function usePokemonData(name: string | null | undefined): PokemonData | null {
  const [data, setData] = useState<PokemonData | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    if (!name) return;
    getPokemon(name)
      .then((d) => alive && setData(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [name]);
  return data;
}
