import { afterEach, describe, expect, it } from 'vitest';
import {
  computeJoystick,
  installInputGuards,
  joystick,
  joystickDown,
  joystickMove,
  joystickUp,
  JOYSTICK_CONFIG,
  quantizeDir,
  releaseInput,
  virtualInput,
  type GuardDocument,
  type GuardWindow,
} from '../input';
import { MOVE_TIMING, stepDurationMs } from '../movement';

const R = JOYSTICK_CONFIG.radius;
const DZ = JOYSTICK_CONFIG.deadZone;

afterEach(() => releaseInput('reset'));

describe('joystick: wektor i kierunki', () => {
  it('cztery kierunki', () => {
    expect(computeJoystick(0, -40).dir).toBe('up');
    expect(computeJoystick(0, 40).dir).toBe('down');
    expect(computeJoystick(-40, 0).dir).toBe('left');
    expect(computeJoystick(40, 0).dir).toBe('right');
  });

  it('martwa strefa: brak ruchu, gałka może się lekko przesunąć', () => {
    const v = computeJoystick(DZ - 1, 0);
    expect(v.dir).toBeNull();
    expect(v.magnitude).toBe(0);
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(computeJoystick(0, DZ).dir).toBeNull();
    expect(computeJoystick(0, DZ + 1).dir).toBe('down');
    expect(computeJoystick(0, 0)).toEqual({ x: 0, y: 0, magnitude: 0, dir: null, knobX: 0, knobY: 0 });
  });

  it('normalizacja: długość wektora ≤ 1, gałka ograniczona do promienia', () => {
    for (const [dx, dy] of [
      [500, 0],
      [300, 300],
      [-1000, 20],
      [R, R],
    ]) {
      const v = computeJoystick(dx, dy);
      expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(1 + 1e-9);
      expect(v.magnitude).toBeLessThanOrEqual(1);
      expect(Math.hypot(v.knobX, v.knobY)).toBeLessThanOrEqual(R + 1e-9);
    }
    expect(computeJoystick(1000, 0).magnitude).toBe(1);
  });

  it('przekątna nie daje dłuższego wektora niż oś przy tym samym wychyleniu', () => {
    const d = 40;
    const axis = computeJoystick(d, 0);
    const diag = computeJoystick(d / Math.SQRT2, d / Math.SQRT2);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(Math.hypot(axis.x, axis.y), 9);
    // Pełne wychylenie po przekątnej: długość 1, nie √2.
    const full = computeJoystick(R, R);
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(1, 9);
  });

  it('przekątna jest kwantowana do jednej osi (ruch po siatce)', () => {
    const v = computeJoystick(30, 29);
    expect(['right', 'down']).toContain(v.dir);
    expect(computeJoystick(30, 30).dir).toBe('down'); // remis → oś pionowa
  });

  it('histereza: kierunek nie przeskakuje przy 45°, ale zmienia się przy wyraźnym skręcie', () => {
    expect(quantizeDir(1, 1.1, 'right', JOYSTICK_CONFIG.hysteresis)).toBe('right');
    expect(quantizeDir(1, 2, 'right', JOYSTICK_CONFIG.hysteresis)).toBe('down');
    expect(quantizeDir(-1, 0.2, 'right', JOYSTICK_CONFIG.hysteresis)).toBe('left'); // odwrócenie
    expect(quantizeDir(0, 0, 'up', JOYSTICK_CONFIG.hysteresis)).toBeNull();
  });
});

describe('joystick: prędkość', () => {
  it('ruch po przekątnej nie jest szybszy — czas kroku zależy tylko od trybu chód/bieg', () => {
    const axisDir = computeJoystick(R, 0).dir;
    const diagDir = computeJoystick(R, R).dir;
    expect(axisDir).not.toBeNull();
    expect(diagDir).not.toBeNull();
    // Krok to zawsze 1 kafelek w jednej osi, więc prędkość = 1000 / czas kroku.
    expect(stepDurationMs(false)).toBe(MOVE_TIMING.walkMs);
    expect(stepDurationMs(true)).toBe(MOVE_TIMING.runMs);
  });

  it('chód jest o połowę wolniejszy niż pierwotnie (170 ms → 340 ms na kafelek), bieg szybszy od chodu', () => {
    expect(stepDurationMs(false)).toBe(340);
    expect(1000 / stepDurationMs(false)).toBeCloseTo((1000 / 170) / 2, 6);
    expect(stepDurationMs(true)).toBeLessThan(stepDurationMs(false));
  });

  it('maksymalna prędkość jest limitem dla każdego trybu', () => {
    const maxTps = MOVE_TIMING.maxTilesPerSecond;
    expect(1000 / stepDurationMs(true)).toBeLessThanOrEqual(maxTps + 1e-9);
    expect(1000 / stepDurationMs(false)).toBeLessThanOrEqual(maxTps + 1e-9);
    // Nawet zbyt szybkie ustawienia są przycinane do limitu.
    const capped = stepDurationMs(true, { walkMs: 50, runMs: 10, maxTilesPerSecond: 8 });
    expect(1000 / capped).toBeLessThanOrEqual(8 + 1e-9);
  });
});

describe('joystick: wskaźnik', () => {
  it('pointerdown → ruch, pointerup → zatrzymanie', () => {
    expect(joystickDown(7, 40, 0)).toBe(true);
    expect(virtualInput.dir).toBe('right');
    joystickMove(7, 0, -40);
    expect(virtualInput.dir).toBe('up');
    joystickUp(7, 'pointerup');
    expect(virtualInput.dir).toBeNull();
    expect(joystick.pointerId).toBeNull();
    expect(joystick.vector.magnitude).toBe(0);
    expect(joystick.lastRelease).toBe('pointerup');
  });

  it('pointercancel zatrzymuje ruch', () => {
    joystickDown(3, 0, 40);
    expect(virtualInput.dir).toBe('down');
    joystickUp(3, 'pointercancel');
    expect(virtualInput.dir).toBeNull();
    expect(joystick.lastRelease).toBe('pointercancel');
  });

  it('drugi palec i obce zdarzenia są ignorowane', () => {
    joystickDown(1, 40, 0);
    expect(joystickDown(2, -40, 0)).toBe(false);
    joystickMove(2, 0, 40);
    expect(virtualInput.dir).toBe('right');
    joystickUp(2, 'pointerup');
    expect(virtualInput.dir).toBe('right');
    joystickUp(1, 'pointerup');
    expect(virtualInput.dir).toBeNull();
  });

  it('po wymuszonym zatrzymaniu (np. blokada spotkania) dalszy ruch tego palca nie porusza postaci', () => {
    joystickDown(5, 40, 0);
    releaseInput('lock');
    joystickMove(5, 50, 0);
    expect(virtualInput.dir).toBeNull();
    expect(joystickDown(6, 0, 40)).toBe(true); // nowe dotknięcie działa
    expect(virtualInput.dir).toBe('down');
  });
});

class FakeTarget {
  private map = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.map.get(type)?.delete(fn);
  }
  fire(type: string) {
    this.map.get(type)?.forEach((fn) => fn());
  }
  count(): number {
    let n = 0;
    this.map.forEach((s) => (n += s.size));
    return n;
  }
}

function fakeEnv() {
  const orientation = new FakeTarget();
  const win = Object.assign(new FakeTarget(), { innerWidth: 390, innerHeight: 844, screen: { orientation } });
  const doc = Object.assign(new FakeTarget(), { visibilityState: 'visible' });
  return { win, doc, orientation };
}

describe('joystick: utrata fokusu, ukrycie strony, orientacja', () => {
  it('blur zatrzymuje ruch', () => {
    const { win, doc } = fakeEnv();
    const off = installInputGuards(win as GuardWindow, doc as GuardDocument);
    joystickDown(1, 40, 0);
    win.fire('blur');
    expect(virtualInput.dir).toBeNull();
    expect(joystick.lastRelease).toBe('blur');
    off();
  });

  it('visibilitychange (ukrycie) i pagehide zatrzymują ruch; ponowne pokazanie nie wznawia', () => {
    const { win, doc } = fakeEnv();
    const off = installInputGuards(win as GuardWindow, doc as GuardDocument);
    joystickDown(1, 0, 40);
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(virtualInput.dir).toBeNull();
    expect(joystick.lastRelease).toBe('hidden');
    doc.visibilityState = 'visible';
    doc.fire('visibilitychange');
    expect(virtualInput.dir).toBeNull();
    joystickDown(2, 0, 40);
    win.fire('pagehide');
    expect(virtualInput.dir).toBeNull();
    off();
  });

  it('zmiana orientacji zatrzymuje ruch (zdarzenie i obrót wykryty po rozmiarze okna)', () => {
    const { win, doc, orientation } = fakeEnv();
    const off = installInputGuards(win as GuardWindow, doc as GuardDocument);
    joystickDown(1, 40, 0);
    orientation.fire('change');
    expect(virtualInput.dir).toBeNull();
    joystickDown(2, 40, 0);
    win.innerWidth = 844;
    win.innerHeight = 390;
    win.fire('resize');
    expect(virtualInput.dir).toBeNull();
    expect(joystick.lastRelease).toBe('orientation');
    // Zwykły resize bez obrotu (np. pasek adresu) nie przerywa ruchu.
    joystickDown(3, 40, 0);
    win.innerWidth = 840;
    win.fire('resize');
    expect(virtualInput.dir).toBe('right');
    off();
    expect(win.count() + doc.count() + orientation.count()).toBe(0);
  });
});
