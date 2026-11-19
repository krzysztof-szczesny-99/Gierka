import { beforeEach, describe, expect, it } from 'vitest';
import { APP_VERSION, versionLabel } from '../../config/version';
import { useUi } from '../../state/uiStore';
import { checkForUpdate, installUpdateChecks, isSafeToUpdate, setUpdateRegistration, type UpdatableRegistration } from '../updateService';

function fakeRegistration(found = false): UpdatableRegistration & { calls: number } {
  const r = {
    calls: 0,
    installing: null as unknown,
    waiting: null as unknown,
    update: async () => {
      r.calls += 1;
      if (found) r.installing = {};
    },
  };
  return r;
}

class FakeTarget {
  private map = new Map<string, Set<() => void>>();
  visibilityState = 'visible';
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
  count() {
    let n = 0;
    this.map.forEach((s) => (n += s.size));
    return n;
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  setUpdateRegistration(null);
  useUi.setState({ mode: 'title', online: true, transition: false, gameMode: 'EXPLORATION', inputLocked: false, activeEncounterId: null });
});

describe('aktualizacje aplikacji', () => {
  it('bezpieczne momenty: ekran tytułowy i eksploracja; niebezpieczne: walka, przejście, trwające spotkanie', () => {
    expect(isSafeToUpdate()).toBe(true);
    useUi.setState({ mode: 'overworld' });
    expect(isSafeToUpdate()).toBe(true);
    useUi.setState({ mode: 'battle', gameMode: 'BATTLE', inputLocked: true, activeEncounterId: 'enc-1' });
    expect(isSafeToUpdate()).toBe(false);
    useUi.setState({ mode: 'overworld', gameMode: 'ENCOUNTER_STARTING' });
    expect(isSafeToUpdate()).toBe(false);
    useUi.setState({ gameMode: 'EXPLORATION', inputLocked: false, activeEncounterId: null, transition: true });
    expect(isSafeToUpdate()).toBe(false);
  });

  it('sprawdzenie: najnowsza wersja albo pobieranie nowej', async () => {
    const r = fakeRegistration(false);
    setUpdateRegistration(r);
    expect(await checkForUpdate()).toBe('up-to-date');
    expect(r.calls).toBe(1);
    const r2 = fakeRegistration(true);
    setUpdateRegistration(r2);
    expect(await checkForUpdate()).toBe('downloading');
  });

  it('bez sieci, bez rejestracji i podczas walki nie sprawdza (nie przerwie gry)', async () => {
    expect(await checkForUpdate()).toBe('no-registration');
    const r = fakeRegistration(true);
    setUpdateRegistration(r);
    useUi.setState({ online: false });
    expect(await checkForUpdate()).toBe('offline');
    useUi.setState({ online: true, mode: 'battle', gameMode: 'BATTLE' });
    expect(await checkForUpdate()).toBe('unsafe');
    expect(r.calls).toBe(0);
  });

  it('błąd sieci przy sprawdzaniu nie psuje gry', async () => {
    setUpdateRegistration({ installing: null, waiting: null, update: async () => Promise.reject(new Error('net')) });
    expect(await checkForUpdate()).toBe('error');
  });

  it('jednoczesne wywołania łączą się w jedno sprawdzenie', async () => {
    const r = fakeRegistration(false);
    setUpdateRegistration(r);
    const [a, b] = await Promise.all([checkForUpdate(), checkForUpdate()]);
    expect([a, b]).toEqual(['up-to-date', 'up-to-date']);
    expect(r.calls).toBe(1);
  });

  it('automatycznie: powrót do aplikacji, odzyskanie sieci i interwał; wyłączenie usuwa nasłuch', async () => {
    const r = fakeRegistration(false);
    setUpdateRegistration(r);
    const win = new FakeTarget();
    const doc = new FakeTarget();
    let tickFn: (() => void) | null = null;
    let cleared = false;
    const off = installUpdateChecks(win, doc, 1000, { set: (fn) => ((tickFn = fn), 1), clear: () => (cleared = true) });
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    await tick();
    expect(r.calls).toBe(0); // ukrycie nie sprawdza
    doc.visibilityState = 'visible';
    doc.fire('visibilitychange');
    await tick();
    expect(r.calls).toBe(1);
    win.fire('online');
    await tick();
    expect(r.calls).toBe(2);
    tickFn!();
    await tick();
    expect(r.calls).toBe(3);
    off();
    expect(cleared).toBe(true);
    expect(win.count() + doc.count()).toBe(0);
  });

  it('wersja gry ma czytelną etykietę (lokalnie „dev”, w CI skrót commita)', () => {
    expect(APP_VERSION).toMatch(/^(dev|[0-9a-f]{7})$/);
    expect(versionLabel().startsWith(APP_VERSION)).toBe(true);
  });
});
