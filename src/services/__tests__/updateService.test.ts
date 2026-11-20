import { beforeEach, describe, expect, it } from 'vitest';
import { APP_VERSION, versionLabel } from '../../config/version';
import { useUi } from '../../state/uiStore';
import { SPRITE_CACHE } from '../spriteCache';
import {
  checkForUpdate,
  forceAttempted,
  forceUpdate,
  httpVersionSource,
  installUpdateChecks,
  isSafeToUpdate,
  setForceUpdateEnv,
  setUpdateRegistration,
  setVersionSource,
  type ForceUpdateEnv,
  type UpdatableRegistration,
} from '../updateService';

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
  setVersionSource(null);
  setForceUpdateEnv(null);
  useUi.setState({ mode: 'title', online: true, transition: false, gameMode: 'EXPLORATION', inputLocked: false, activeEncounterId: null, updateAvailable: null, toast: null });
});

/** Atrapa środowiska wymuszonej aktualizacji — rejestruje kroki. */
function fakeForceEnv(caches: string[] = ['workbox-precache-v2-x', SPRITE_CACHE, 'inny']) {
  const log: string[] = [];
  const store = new Map<string, string>();
  const env: ForceUpdateEnv = {
    saveNow: async () => void log.push('save'),
    unregisterAll: async () => (log.push('unregister'), 1),
    cacheNames: async () => [...caches],
    deleteCache: async (n) => (log.push(`delete:${n}`), true),
    reload: (t) => void log.push(`reload:${t}`),
    session: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
  };
  return { env, log };
}

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

describe('porównanie z wersją na serwerze i wymuszona aktualizacja (iOS)', () => {
  const source = (server: string | null, current = 'aaaaaaa') => {
    const calls = { n: 0 };
    setVersionSource({ current, fetchServerVersion: async () => (calls.n++, server) });
    return calls;
  };

  it('serwer ma nowszą wersję, a service worker jej nie widzi → „outdated” i baner (w grze bez automatycznego przeładowania)', async () => {
    setUpdateRegistration(fakeRegistration(false));
    source('bbbbbbb');
    const f = fakeForceEnv();
    setForceUpdateEnv(f.env);
    useUi.setState({ mode: 'overworld' });
    expect(await checkForUpdate()).toBe('outdated');
    expect(useUi.getState().updateAvailable).toBe('bbbbbbb');
    expect(f.log).toEqual([]);
  });

  it('na ekranie tytułowym aktualizacja jest wymuszana od razu — najwyżej raz na wersję w sesji (bez pętli)', async () => {
    setUpdateRegistration(fakeRegistration(false));
    source('bbbbbbb');
    const f = fakeForceEnv();
    setForceUpdateEnv(f.env);
    expect(await checkForUpdate()).toBe('outdated');
    await tick();
    expect(f.log.filter((x) => x.startsWith('reload'))).toEqual(['reload:bbbbbbb']);
    expect(forceAttempted('bbbbbbb')).toBe(true);
    useUi.setState({ transition: false });
    expect(await checkForUpdate()).toBe('outdated');
    await tick();
    expect(f.log.filter((x) => x.startsWith('reload'))).toHaveLength(1);
  });

  it('ta sama wersja → „up-to-date” i brak banera; błąd odczytu serwera nie pokazuje banera; build „dev” nie pyta serwera', async () => {
    setUpdateRegistration(fakeRegistration(false));
    useUi.setState({ updateAvailable: 'stara' });
    source('aaaaaaa');
    expect(await checkForUpdate()).toBe('up-to-date');
    expect(useUi.getState().updateAvailable).toBeNull();
    setVersionSource({ current: 'aaaaaaa', fetchServerVersion: async () => Promise.reject(new Error('net')) });
    expect(await checkForUpdate()).toBe('up-to-date');
    expect(useUi.getState().updateAvailable).toBeNull();
    const dev = source('bbbbbbb', 'dev');
    expect(await checkForUpdate()).toBe('up-to-date');
    expect(dev.n).toBe(0);
  });

  it('wymuszona aktualizacja: zapis, wyrejestrowanie, usunięcie bufora plików gry (sprite’y zostają), przeładowanie', async () => {
    const f = fakeForceEnv();
    setForceUpdateEnv(f.env);
    useUi.setState({ mode: 'overworld' });
    expect(await forceUpdate('ccccccc')).toBe('reloading');
    expect(f.log).toEqual(['save', 'unregister', 'delete:workbox-precache-v2-x', 'delete:inny', 'reload:ccccccc']);
    expect(forceAttempted('ccccccc')).toBe(true);
  });

  it('wymuszona aktualizacja nie przerywa walki', async () => {
    const f = fakeForceEnv();
    setForceUpdateEnv(f.env);
    useUi.setState({ mode: 'battle', gameMode: 'BATTLE' });
    expect(await forceUpdate('ccccccc')).toBe('unsafe');
    expect(f.log).toEqual([]);
  });

  it('odczyt version.json: unikalny adres i cache: no-store; błąd HTTP → brak wersji', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const ok = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body }) as Response;
    const src = httpVersionSource('aaaaaaa', '/Gierka/version.json', (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return seen.length === 1 ? ok({ version: 'bbbbbbb' }) : ok({}, 404);
    }) as unknown as typeof fetch);
    expect(await src.fetchServerVersion()).toBe('bbbbbbb');
    expect(seen[0].url).toMatch(/^\/Gierka\/version\.json\?t=\d+$/);
    expect(seen[0].init?.cache).toBe('no-store');
    expect(await src.fetchServerVersion()).toBeNull();
  });
});
