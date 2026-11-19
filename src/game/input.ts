// Wspólny stan sterowania ekranowego (joystick i przyciski React → scena Phasera).
// Celowo poza Zustandem: zmienia się bardzo często i nie powinien powodować renderów Reacta.
// Logika joysticka jest czysta (bez DOM) — komponent React tylko przekazuje współrzędne wskaźnika,
// a testy jednostkowe sprawdzają ją bez przeglądarki.

import type { Dir } from '../engine/types';

export const virtualInput: { dir: Dir | null; run: boolean; actionQueued: boolean } = {
  dir: null,
  run: false,
  actionQueued: false,
};

export function queueAction(): void {
  virtualInput.actionQueued = true;
}

export function consumeAction(): boolean {
  const a = virtualInput.actionQueued;
  virtualInput.actionQueued = false;
  return a;
}

// ───────────────────────────── joystick ─────────────────────────────

export interface JoystickConfig {
  /** Maksymalne wychylenie gałki (px od środka). Dalej wektor już nie rośnie. */
  radius: number;
  /** Martwa strefa (px od środka): mniejsze wychylenie nie porusza postaci. */
  deadZone: number;
  /**
   * Histereza kierunku (0–1). Bieżący kierunek zostaje, dopóki jego składowa jest ≥ histereza × druga składowa
   * — dzięki temu kciuk w okolicy 45° nie przełącza kierunku w każdej klatce.
   */
  hysteresis: number;
}

export const JOYSTICK_CONFIG: JoystickConfig = { radius: 52, deadZone: 14, hysteresis: 0.75 };

export interface JoystickVector {
  /** Znormalizowany wektor ruchu: długość (magnitude) zawsze w przedziale [0, 1], także po przekątnej. */
  x: number;
  y: number;
  magnitude: number;
  /** Kierunek ruchu po siatce (4 osie) albo null w martwej strefie. */
  dir: Dir | null;
  /** Położenie gałki (px), ograniczone do promienia — tylko do rysowania. */
  knobX: number;
  knobY: number;
}

export const NEUTRAL_VECTOR: JoystickVector = Object.freeze({ x: 0, y: 0, magnitude: 0, dir: null, knobX: 0, knobY: 0 });

/** Kwantyzacja kierunku do 4 osi z histerezą względem poprzedniego kierunku. Remis (dokładnie 45°) → oś pionowa. */
export function quantizeDir(x: number, y: number, prev: Dir | null, hysteresis: number): Dir | null {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === 0 && ay === 0) return null;
  if (prev === 'left' || prev === 'right') {
    const sameSign = prev === 'right' ? x > 0 : x < 0;
    if (sameSign && ax >= ay * hysteresis) return prev;
  } else if (prev === 'up' || prev === 'down') {
    const sameSign = prev === 'down' ? y > 0 : y < 0;
    if (sameSign && ay >= ax * hysteresis) return prev;
  }
  if (ax > ay) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

/** Przelicza położenie palca względem środka joysticka (px) na znormalizowany wektor i kierunek. */
export function computeJoystick(
  dx: number,
  dy: number,
  cfg: JoystickConfig = JOYSTICK_CONFIG,
  prev: Dir | null = null,
): JoystickVector {
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist === 0) return NEUTRAL_VECTOR;
  const ux = dx / dist;
  const uy = dy / dist;
  const knob = Math.min(dist, cfg.radius);
  const knobX = ux * knob;
  const knobY = uy * knob;
  if (dist <= cfg.deadZone) return { x: 0, y: 0, magnitude: 0, dir: null, knobX, knobY };
  const magnitude = Math.min(1, (dist - cfg.deadZone) / Math.max(1, cfg.radius - cfg.deadZone));
  return { x: ux * magnitude, y: uy * magnitude, magnitude, dir: quantizeDir(ux, uy, prev, cfg.hysteresis), knobX, knobY };
}

export type InputReleaseReason =
  | 'pointerup'
  | 'pointercancel'
  | 'blur'
  | 'hidden'
  | 'pagehide'
  | 'orientation'
  | 'lock'
  | 'encounter-end'
  | 'unmount'
  | 'reset';

interface JoystickState {
  /** Wskaźnik (palec), który steruje joystickiem; drugi palec jest ignorowany. */
  pointerId: number | null;
  vector: JoystickVector;
  /** Powód ostatniego zatrzymania (diagnostyka i testy). */
  lastRelease: InputReleaseReason | null;
}

export const joystick: JoystickState = { pointerId: null, vector: NEUTRAL_VECTOR, lastRelease: null };

type JoystickListener = (v: JoystickVector) => void;
const listeners = new Set<JoystickListener>();

/** Subskrypcja zmian wektora (komponent React rysuje gałkę). */
export function onJoystickChange(fn: JoystickListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply(v: JoystickVector): void {
  joystick.vector = v;
  virtualInput.dir = v.dir;
  listeners.forEach((fn) => fn(v));
}

/** Palec dotyka joysticka. Zwraca false, jeśli joystick jest już trzymany innym palcem. */
export function joystickDown(pointerId: number, dx: number, dy: number, cfg: JoystickConfig = JOYSTICK_CONFIG): boolean {
  if (joystick.pointerId !== null) return false;
  joystick.pointerId = pointerId;
  joystick.lastRelease = null;
  apply(computeJoystick(dx, dy, cfg, null));
  return true;
}

export function joystickMove(pointerId: number, dx: number, dy: number, cfg: JoystickConfig = JOYSTICK_CONFIG): void {
  if (pointerId !== joystick.pointerId) return;
  apply(computeJoystick(dx, dy, cfg, joystick.vector.dir));
}

/** Puszczenie albo anulowanie wskaźnika sterującego (pointerup, pointercancel, lostpointercapture). */
export function joystickUp(pointerId: number, reason: 'pointerup' | 'pointercancel' = 'pointerup'): void {
  if (pointerId !== joystick.pointerId) return;
  releaseInput(reason);
}

/**
 * Natychmiast zatrzymuje ruch z joysticka i „odpina” trzymany palec: dalsze ruchy tego palca są ignorowane
 * aż do nowego dotknięcia. Używane przy utracie fokusu, ukryciu strony, obrocie ekranu i blokadzie spotkania.
 */
export function releaseInput(reason: InputReleaseReason): void {
  joystick.pointerId = null;
  joystick.lastRelease = reason;
  if (joystick.vector !== NEUTRAL_VECTOR || virtualInput.dir !== null) apply(NEUTRAL_VECTOR);
}

export function resetVirtualInput(): void {
  releaseInput('reset');
  virtualInput.run = false;
  virtualInput.actionQueued = false;
}

// ───────────────────────────── strażnicy globalni ─────────────────────────────

interface ListenerTarget {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export interface GuardWindow extends ListenerTarget {
  innerWidth: number;
  innerHeight: number;
  screen?: { orientation?: ListenerTarget | null } | null;
}

export interface GuardDocument extends ListenerTarget {
  visibilityState: string;
}

/**
 * Zatrzymuje joystick, gdy okno traci fokus, strona zostaje ukryta lub zamknięta albo zmienia się orientacja ekranu.
 * (Klawiaturę po utracie fokusu zeruje sam Phaser.) Zwraca funkcję odinstalowującą.
 */
export function installInputGuards(win: GuardWindow, doc: GuardDocument): () => void {
  let portrait = win.innerHeight >= win.innerWidth;
  const onBlur = () => releaseInput('blur');
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') releaseInput('hidden');
  };
  const onPageHide = () => releaseInput('pagehide');
  const onOrientation = () => {
    portrait = win.innerHeight >= win.innerWidth;
    releaseInput('orientation');
  };
  const onResize = () => {
    const now = win.innerHeight >= win.innerWidth;
    if (now !== portrait) {
      portrait = now;
      releaseInput('orientation');
    }
  };
  const orientation = win.screen?.orientation ?? null;
  win.addEventListener('blur', onBlur);
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('orientationchange', onOrientation);
  win.addEventListener('resize', onResize);
  doc.addEventListener('visibilitychange', onVisibility);
  orientation?.addEventListener('change', onOrientation);
  return () => {
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('orientationchange', onOrientation);
    win.removeEventListener('resize', onResize);
    doc.removeEventListener('visibilitychange', onVisibility);
    orientation?.removeEventListener('change', onOrientation);
  };
}
