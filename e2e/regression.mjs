// Testy regresji E2E (Sprint 1: joystick i blokada spotkań; Sprint 2: tereny i losowe spotkania;
// Sprint 3: model świata, dwie lokacje, przejścia, zapis lokacji i migracja zapisu;
// Sprint 4: natury, zdolności, przedmioty trzymane, ewolucje, zapis v3)
// na prawdziwym buildzie (Phaser + PokéAPI). Ruch wyłącznie przez joystick ekranowy (zdarzenia wskaźnika)
// i klawiaturę — bez tap-to-move. Losowość: ziarno gry z adresu (?debug&seed=…) oraz kontrolowane źródło
// rzutu na spotkanie (stepRng) ustawiane przez tryb diagnostyczny. Tryb ?debug służy tylko do odczytu stanu
// i ustawienia scenariusza (pozycja, źródło rzutu).
// Użycie: node e2e/regression.mjs http://localhost:4173/   (kod wyjścia ≠ 0 przy każdym problemie)
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const SEED = 20261119;
const URL = `${BASE}?debug&seed=${SEED}`;
const OUT = 'e2e-shots';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const consoleIssues = [];

const record = (id, title, ok, data) => {
  const verdict = ok === 'INFO' ? 'INFO' : ok ? 'OK' : 'PROBLEM';
  results.push({ id, title, verdict, data });
  console.log(`REG ${id} [${verdict}] ${title} :: ${JSON.stringify(data)}`);
};
const fail = (id, title, e) => {
  results.push({ id, title, verdict: 'BŁĄD TESTU', data: String(e?.stack ?? e).slice(0, 500) });
  console.log(`REG ${id} [BŁĄD TESTU] ${title} :: ${String(e?.stack ?? e).slice(0, 500)}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pl-PL' });
const page = await ctx.newPage();
page.on('pageerror', (e) => consoleIssues.push({ type: 'pageerror', text: e.message }));
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GL Driver Message')) consoleIssues.push({ type: m.type(), text: m.text().slice(0, 300) });
});

const S = (fn, arg) => page.evaluate(fn, arg);
const idle = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});
const pos = () => S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return [sc.tx, sc.ty]; });
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const ui = () => S(() => { const u = window.__szlaki.stores.useUi.getState(); return { mode: u.mode, gameMode: u.gameMode, activeEncounterId: u.activeEncounterId, sourceEntityId: u.sourceEntityId, inputLocked: u.inputLocked, cooldown: u.encounterCooldown, rolls: u.encounterRollCount, transition: u.transition, dialog: !!u.dialog, modal: u.modal, last: u.lastEncounter, decision: u.lastStepDecision && u.lastStepDecision.reason }; });
const stats = () => S(() => { const g = window.__szlaki.stores.useGame.getState(); return { won: g.stats.battlesWon, caught: g.stats.caught, fled: g.stats.fled, blackouts: g.stats.blackouts, encounters: g.stats.encounters, money: g.player.money, party: g.party.length, storage: g.storage.length, steps: g.player.steps }; });
const OFF = { up: [0, -45], down: [0, 45], left: [-45, 0], right: [45, 0] };

/** Kontrolowane źródło rzutu na spotkanie: 'hit' (zawsze trafienie) lub 'miss' (nigdy); liczy rzuty w window.__rolls. */
const setStepRng = (mode) => S((mode) => {
  const E = window.__szlaki.encounter;
  window.__rolls = 0;
  const value = mode === 'hit' ? 0 : 0.999;
  E.configure({ stepRng: E.rngFromNext(() => { window.__rolls += 1; return value; }) });
}, mode);
const rolls = () => S(() => window.__rolls ?? 0);
const resetCooldown = () => S(() => window.__szlaki.stores.useUi.setState({ encounterCooldown: 0, encounterStepProgress: 0 }));
const watchEncounters = () => S(() => {
  window.__enc = [];
  if (!window.__encSub) window.__encSub = window.__szlaki.stores.bus.on('encounter', (p) => (window.__enc ??= []).push({ id: p.encounterId, kind: p.source.kind, zoneId: p.source.zoneId ?? null, table: p.source.encounterTableId ?? null, actorId: p.source.actorId ?? null }));
});
const encounters = () => S(() => window.__enc ?? []);

async function closeDialogs() {
  for (let i = 0; i < 15; i++) {
    if (!(await page.locator('.dialog').count())) break;
    await page.locator('.dialog').click();
    await idle(60);
  }
  const skipLearn = page.getByRole('button', { name: /Nie ucz/ });
  if (await skipLearn.count()) await skipLearn.click();
}
async function waitJoystick() { await page.locator('.joystick').waitFor({ timeout: 15000 }); }
async function joyCenter() { const b = await page.locator('.joystick').boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
/** Trzyma joystick z wychyleniem (dx, dy) przez ms; release=false zostawia palec. */
async function hold(dx, dy, ms, release = true) {
  const [cx, cy] = await joyCenter();
  await page.mouse.move(cx + dx, cy + dy);
  await page.mouse.down();
  await page.mouse.move(cx + dx + 0.01, cy + dy);
  await idle(ms);
  if (release) await page.mouse.up();
}
/** Dokładnie jeden krok joystickiem (krótkie dotknięcie; krok trwa 340 ms). */
async function singleStep(dir) {
  await hold(...OFF[dir], 120);
  await idle(450);
}

/**
 * Teleport gracza (zdarzenie gry) na pole, z którego w kierunku `dir` jest co najmniej `need` wolnych pól
 * o zadanym terenie: 'grass' (wysoka trawa), 'safe' (bez spotkań) albo 'any'.
 */
async function placeWithRoom(dir, need, { terrain = 'any', extra = null } = {}) {
  return S(({ dir, need, terrain, extra }) => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const ok = (x, y) => {
      if (!sc.isWalkable(x, y) || sc.actorAt(x, y) || sc.exitAt(x, y)) return false; // wyjścia z mapy omijamy
      const ch = sc.grid[y][x];
      if (terrain === 'grass') return ch === ',';
      if (terrain === 'safe') return ch !== ',' && ch !== 'r';
      return true;
    };
    const run = (x, y, d) => { let n = 0; const [dx, dy] = D[d]; for (let i = 1; i <= 12; i++) { if (ok(x + dx * i, y + dy * i)) n++; else break; } return n; };
    for (let y = 1; y < sc.grid.length - 1; y++) for (let x = 1; x < sc.grid[0].length - 1; x++) {
      if (!sc.isWalkable(x, y) || sc.actorAt(x, y) || sc.exitAt(x, y)) continue;
      if (terrain === 'safe' && !ok(x, y)) continue;
      if (run(x, y, dir) < need) continue;
      if (extra && run(x, y, extra) < need) continue;
      if (sc.actors.some((a) => !a.removed && Math.abs(a.tx - x) + Math.abs(a.ty - y) <= 3)) continue;
      window.__szlaki.stores.bus.emit('teleport', { x, y, facing: dir });
      return { x, y };
    }
    return null;
  }, { dir, need, terrain, extra });
}

async function waitBattle() { await page.locator('.battle').waitFor({ timeout: 25000 }); }
async function fightToEnd(preferStatus = false) {
  for (let i = 0; i < 900; i++) {
    if (await page.getByRole('button', { name: 'Dalej' }).count()) return true;
    const ph = await S(() => window.__szlaki.stores.useBattle.getState().phase);
    if (ph === 'forcedSwitch') { await page.locator('.creature-row:not([disabled])').first().click(); continue; }
    if (ph === 'choose') {
      await page.getByRole('button', { name: 'Walcz' }).click();
      const all = page.locator('.move-btn:not([disabled])');
      const pref = preferStatus ? all.filter({ hasText: 'status' }) : all.filter({ hasNotText: 'status' });
      await ((await pref.count()) ? pref.first() : all.first()).click();
      continue;
    }
    await S(() => window.__szlaki.stores.useBattle.getState().skip());
    await idle(40);
  }
  return false;
}
/** Ucieczka (powtarzana do skutku); zwraca wynik walki. */
async function fleeToEnd() {
  for (let i = 0; i < 400; i++) {
    if (await page.getByRole('button', { name: 'Dalej' }).count()) return S(() => window.__szlaki.stores.useBattle.getState().engine.outcome);
    const ph = await S(() => window.__szlaki.stores.useBattle.getState().phase);
    if (ph === 'choose') await page.getByRole('button', { name: 'Ucieczka' }).click();
    else if (ph === 'forcedSwitch') await page.locator('.creature-row:not([disabled])').first().click();
    else { await S(() => window.__szlaki.stores.useBattle.getState().skip()); await idle(40); }
  }
  return null;
}
const enemy = () => S(() => { const e = window.__szlaki.stores.useBattle.getState().engine.sides[1].party[0]; return { pokemon: e.pokemon, level: e.level, mighty: e.mighty }; });
async function afterBattleBackOnMap() {
  await closeDialogs();
  await idle(400);
  await closeDialogs();
  await waitJoystick();
}
async function clickDalej(times = 1) {
  await S((n) => { const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Dalej'); for (let i = 0; i < n; i++) btn.click(); }, times);
}
/** Czy sterowanie wróciło: joystick porusza postać (teren bez spotkań). */
async function controlRestored() {
  await setStepRng('miss');
  const spot = await placeWithRoom('right', 3, { terrain: 'safe' });
  await idle(250);
  const a = await pos();
  await hold(...OFF.right, 500);
  await idle(400);
  const b = await pos();
  return { spot, przed: a, po: b, ruszyl: b[0] > a[0] };
}
/** Spotkanie w wysokiej trawie: kontrolowany rzut „trafienie”, gracz robi joystickiem krok na pole trawy. */
async function grassEncounter() {
  await setStepRng('hit');
  let spot = null, dir = null;
  for (const d of ['right', 'left', 'down', 'up']) { spot = await placeWithRoom(d, 2, { terrain: 'grass' }); if (spot) { dir = d; break; } }
  if (!spot) throw new Error('brak wysokiej trawy na mapie');
  await idle(300);
  await resetCooldown();
  await watchEncounters();
  const before = await pos();
  await hold(...OFF[dir], 450, false);
  const st = await ui();
  await idle(500);
  const during = await pos();
  await page.mouse.up();
  await waitBattle();
  await setStepRng('miss');
  return { spot, dir, before, during, stanPoKroku: st.gameMode, zdarzenia: await encounters() };
}
const MEADOW = { pidgey: [2, 4], sentret: [2, 4], zigzagoon: [3, 5], starly: [3, 5], 'rattata-alola': [3, 5] };

// ───────────── R0. Start gry, joystick w HUD, ziarno ─────────────
try {
  await page.goto(URL);
  await page.getByRole('button', { name: 'Nowa gra' }).click();
  await page.locator('.starter-card h3').nth(2).waitFor({ timeout: 30000 });
  await page.locator('.starter-card').first().click();
  await page.getByRole('button', { name: /Ruszamy/ }).click();
  await page.locator('.dialog').waitFor({ timeout: 15000 });
  await closeDialogs();
  await waitJoystick();
  await page.waitForFunction(() => { const sc = window.__szlaki?.game?.scene?.getScene('Overworld'); return !!sc && !!sc.follower && sc.actors.length >= 1; }, null, { timeout: 30000 });
  await setStepRng('miss');
  const hud = { joystick: await page.locator('.joystick').count(), dpad: await page.locator('.dpad').count(), knob: await page.locator('.joystick .knob').count(), seed: await S(() => window.__szlaki.encounter.seed), stan: await ui() };
  await shot('r0-joystick');
  record('R0', 'Start gry: joystick jest sterowaniem ekranowym, stan EXPLORATION, ziarno z adresu', hud.joystick === 1 && hud.dpad === 0 && hud.knob === 1 && hud.seed === SEED && hud.stan.gameMode === 'EXPLORATION' && !hud.stan.inputLocked, hud);
} catch (e) { fail('R0', 'Start gry', e); }

// ───────────── T1. Zwykłe stworzenia nie chodzą po mapie; tylko nieruchome spotkanie specjalne ─────────────
try {
  const snap = () => S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { aktorzy: sc.actors.map((a) => ({ id: a.id, at: [a.tx, a.ty], x: Math.round(a.container.x), y: Math.round(a.container.y), gatunek: a.spawn.creature.pokemon, potezny: a.spawn.creature.mighty })), wedrowka: typeof sc.updateActors, odradzanie: typeof sc.maintainSpawns }; });
  const a = await snap();
  await idle(6000);
  const b = await snap();
  const onlyStatic = b.aktorzy.length === 1 && b.aktorzy[0].id === 'static:gaj-straznik' && same(b.aktorzy[0].at, [36, 28]);
  const still = JSON.stringify(a.aktorzy) === JSON.stringify(b.aktorzy);
  record('T1', 'Brak zwykłych mobilnych spawnów: na mapie stoi tylko Strażnik Gaju (6 s bez ruchu)', onlyStatic && still && b.wedrowka === 'undefined' && b.odradzanie === 'undefined', { przed: a, po6s: b });
} catch (e) { fail('T1', 'Brak mobilnych spawnów', e); }

// ───────────── R1. Cztery kierunki + zatrzymanie po puszczeniu ─────────────
try {
  const out = {};
  let ok = true;
  for (const d of ['up', 'down', 'left', 'right']) {
    const spot = await placeWithRoom(d, 4);
    await idle(300);
    const a = await pos();
    await hold(...OFF[d], 600);
    await idle(250);
    const b = await pos();
    await idle(800);
    const c = await pos();
    const st = await S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { moving: sc.moving, klatka: sc.hero.texture.key, kierunekJoysticka: window.__szlaki.input.virtualInput.dir }; });
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const good = { up: dy < 0 && dx === 0, down: dy > 0 && dx === 0, left: dx < 0 && dy === 0, right: dx > 0 && dy === 0 }[d];
    const stopped = same(b, c) && !st.moving && st.kierunekJoysticka === null && st.klatka.endsWith('-0');
    out[d] = { spot, start: a, poPuszczeniu: b, po800ms: c, ...st, kierunekOK: good, zatrzymanie: stopped };
    if (!good || !stopped) ok = false;
  }
  record('R1', 'Joystick: cztery kierunki; po puszczeniu postać staje (bez animacji chodu)', ok, out);
} catch (e) { fail('R1', 'Cztery kierunki', e); }

// ───────────── R2. Przekątna nie jest szybsza ─────────────
try {
  const spot = await placeWithRoom('down', 9, { extra: 'right' });
  if (!spot) throw new Error('brak otwartego miejsca');
  await idle(300);
  const a = await pos();
  await hold(32, 32, 1000);
  await idle(400);
  const b = await pos();
  const diagTiles = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  const axis = b[0] !== a[0] ? 'right' : 'down';
  const oneAxis = b[0] === a[0] || b[1] === a[1];
  await S((s) => window.__szlaki.stores.bus.emit('teleport', { x: s.x, y: s.y, facing: 'down' }), spot);
  await idle(300);
  const c = await pos();
  await hold(...OFF[axis], 1000);
  await idle(400);
  const d = await pos();
  const axisTiles = Math.abs(d[0] - c[0]) + Math.abs(d[1] - c[1]);
  record('R2', 'Przekątna: ruch w jednej osi i nie szybszy niż ruch w osi przez ten sam czas', oneAxis && diagTiles > 0 && diagTiles <= axisTiles + 1, { spot, przekatnaKafelki: diagTiles, os: axis, osKafelki: axisTiles, jednaOs: oneAxis });
} catch (e) { fail('R2', 'Przekątna', e); }

// ───────────── R3. Martwa strefa ─────────────
try {
  await placeWithRoom('right', 4);
  await idle(300);
  const a = await pos();
  await hold(8, 0, 700, false);
  const dir = await S(() => window.__szlaki.input.virtualInput.dir);
  await page.mouse.up();
  await idle(200);
  const b = await pos();
  record('R3', 'Martwa strefa: małe wychylenie nie porusza postaci', same(a, b) && dir === null, { przed: a, po: b, kierunek: dir });
} catch (e) { fail('R3', 'Martwa strefa', e); }

// ───────────── R4. pointercancel ─────────────
try {
  await placeWithRoom('down', 8);
  await idle(300);
  const a = await pos();
  await hold(...OFF.down, 400, false);
  const moving = await pos();
  await S(() => document.querySelector('.joystick').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true, pointerType: 'mouse' })));
  await idle(450);
  const b = await pos();
  await page.mouse.move(...(await joyCenter()).map((v, i) => v + (i ? 50 : 0)));
  await idle(800);
  const c = await pos();
  await page.mouse.up();
  const last = await S(() => window.__szlaki.input.joystick.lastRelease);
  record('R4', 'pointercancel zatrzymuje ruch; dalszy ruch tego palca jest ignorowany', !same(a, moving) && same(b, c), { start: a, wTrakcie: moving, poCancel: b, po800ms: c, powod: last });
} catch (e) { fail('R4', 'pointercancel', e); }

// ───────────── R5. Utrata fokusu i ukrycie strony ─────────────
try {
  await placeWithRoom('down', 8);
  await idle(300);
  await hold(...OFF.down, 350, false);
  await S(() => window.dispatchEvent(new Event('blur')));
  await idle(450);
  const a = await pos();
  await idle(800);
  const b = await pos();
  await page.mouse.up();
  const blurReason = await S(() => window.__szlaki.input.joystick.lastRelease);
  await S(() => window.dispatchEvent(new Event('focus')));

  await placeWithRoom('down', 8);
  await idle(300);
  await hold(...OFF.down, 350, false);
  await S(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await idle(450);
  const c = await pos();
  await idle(800);
  const d = await pos();
  await page.mouse.up();
  const hiddenReason = await S(() => window.__szlaki.input.joystick.lastRelease);
  await S(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  record('R5', 'Utrata fokusu (blur) i ukrycie strony (visibilitychange) zatrzymują ruch', same(a, b) && same(c, d) && blurReason === 'blur' && hiddenReason === 'hidden', { blur: { po: a, po800ms: b, powod: blurReason }, ukrycie: { po: c, po800ms: d, powod: hiddenReason } });
} catch (e) { fail('R5', 'Fokus i widoczność', e); }

// ───────────── R6. Obrót ekranu: zatrzymanie ruchu i rozmiar mapy ─────────────
try {
  await placeWithRoom('down', 8);
  await idle(300);
  await hold(...OFF.down, 350, false);
  await page.setViewportSize({ width: 844, height: 390 });
  await idle(450);
  const a = await pos();
  await idle(800);
  const b = await pos();
  const reason = await S(() => window.__szlaki.input.joystick.lastRelease);
  await page.mouse.up();
  const sizes = [];
  let sizeOk = true;
  for (const [w, h] of [[390, 844], [844, 390], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    let snap = null;
    const t0 = Date.now();
    for (;;) {
      snap = await S(() => { const g = window.__szlaki.game; const c = g.scene.getScene('Overworld').cameras.main; const r = document.querySelector('.phaser-root').getBoundingClientRect(); return { gra: [g.scale.width, g.scale.height], kamera: [c.width, c.height], rodzic: [Math.round(r.width), Math.round(r.height)] }; });
      const okNow = Math.abs(snap.gra[0] - snap.rodzic[0]) <= 1 && Math.abs(snap.gra[1] - snap.rodzic[1]) <= 1 && Math.abs(snap.kamera[0] - snap.rodzic[0]) <= 1 && Math.abs(snap.kamera[1] - snap.rodzic[1]) <= 1;
      if (okNow || Date.now() - t0 > 500) { snap.ms = Date.now() - t0; snap.ok = okNow; break; }
      await idle(50);
    }
    if (!snap.ok) sizeOk = false;
    sizes.push({ okno: [w, h], ...snap });
  }
  record('R6', 'Obrót ekranu: ruch staje; rozmiar gry i kamery = rozmiar ekranu w ≤ 500 ms po każdym z 3 obrotów', same(a, b) && reason === 'orientation' && sizeOk, { poObrocie: a, po800ms: b, powod: reason, rozmiary: sizes });
} catch (e) { fail('R6', 'Obrót ekranu', e); }

// ───────────── R7. Kolizja ─────────────
try {
  const spot = await S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    for (let y = 2; y < sc.grid.length - 1; y++) for (let x = 1; x < sc.grid[0].length - 1; x++) {
      if (sc.isWalkable(x, y) && !sc.actorAt(x, y) && sc.grid[y][x - 1] === 'T' && sc.isWalkable(x + 1, y)) {
        window.__szlaki.stores.bus.emit('teleport', { x, y, facing: 'down' });
        return { x, y };
      }
    }
    return null;
  });
  await idle(300);
  const a = await pos();
  await hold(...OFF.left, 700);
  await idle(300);
  const b = await pos();
  const facing = await S(() => window.__szlaki.game.scene.getScene('Overworld').facing);
  record('R7', 'Kolizja: drzewo blokuje ruch (postać tylko się odwraca)', !!spot && same(a, b) && facing === 'left', { spot, przed: a, po: b, facing });
} catch (e) { fail('R7', 'Kolizja', e); }

// ───────────── R8. Tap-to-move wyłączony ─────────────
try {
  await placeWithRoom('down', 4);
  await idle(400);
  const target = await S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const cam = sc.cameras.main;
    const tx = sc.tx, ty = sc.ty + 2;
    return { tx, ty, sx: (tx * 16 + 8 - cam.worldView.x) * cam.zoom, sy: (ty * 16 + 8 - cam.worldView.y) * cam.zoom };
  });
  const a = await pos();
  await page.mouse.click(target.sx, target.sy);
  await page.touchscreen.tap(target.sx, target.sy);
  await idle(1200);
  const b = await pos();
  record('R8', 'Dotknięcie mapy nie porusza postaci (tap-to-move wyłączony, także w ?debug)', same(a, b), { cel: target, przed: a, po: b });
} catch (e) { fail('R8', 'Tap-to-move', e); }

// ───────────── R9. Towarzysz ─────────────
try {
  await placeWithRoom('right', 6);
  await idle(400);
  const a = await pos();
  await hold(...OFF.right, 650);
  await idle(500);
  const b = await pos();
  const f = await S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { sprite: !!sc.follower, tile: sc.followerTile ? [sc.followerTile.x, sc.followerTile.y] : null }; });
  const behind = f.tile && f.tile[0] === b[0] - 1 && f.tile[1] === b[1];
  record('R9', 'Towarzysz idzie za graczem (pole, które gracz opuścił)', b[0] > a[0] && f.sprite && behind, { start: a, gracz: b, towarzysz: f });
} catch (e) { fail('R9', 'Towarzysz', e); }

// ───────────── T2. Brak losowania poza trawą ─────────────
try {
  await setStepRng('miss');
  const spot = await placeWithRoom('right', 5, { terrain: 'safe' });
  await idle(300);
  await resetCooldown();
  const s0 = await stats();
  const u0 = await ui();
  await hold(...OFF.right, 1100);
  await idle(450);
  const s1 = await stats();
  const u1 = await ui();
  const r = await rolls();
  const kroki = s1.steps - s0.steps;
  record('T2', 'Poza trawą (osada, ścieżki, zwykła trawa) kroki nie wywołują losowania', kroki >= 2 && r === 0 && u1.rolls === u0.rolls && u1.decision === 'no-terrain', { spot, kroki, rzuty: r, licznikRzutow: [u0.rolls, u1.rolls], decyzja: u1.decision });
} catch (e) { fail('T2', 'Brak losowania poza trawą', e); }

// ───────────── T3. W trawie: dokładnie jedno losowanie na krok ─────────────
try {
  await setStepRng('miss');
  const spot = await placeWithRoom('right', 5, { terrain: 'grass' });
  await idle(300);
  await resetCooldown();
  const s0 = await stats();
  const u0 = await ui();
  await hold(...OFF.right, 1100);
  await idle(450);
  const s1 = await stats();
  const u1 = await ui();
  const r = await rolls();
  const kroki = s1.steps - s0.steps;
  record('T3', 'W wysokiej trawie: dokładnie jeden rzut na każdy krok na nowe pole', kroki >= 2 && r === kroki && u1.rolls - u0.rolls === kroki && u1.decision === 'miss' && u1.gameMode === 'EXPLORATION', { spot, kroki, rzuty: r, licznikRzutow: [u0.rolls, u1.rolls], decyzja: u1.decision });
} catch (e) { fail('T3', 'Jedno losowanie na krok', e); }

// ───────────── T4. Brak losowania przy staniu i przy zderzeniu z przeszkodą ─────────────
try {
  await setStepRng('miss');
  const spot = await S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    for (let y = 2; y < sc.grid.length - 1; y++) for (let x = 1; x < sc.grid[0].length - 1; x++) {
      if (sc.grid[y][x] === ',' && !sc.actorAt(x, y) && sc.grid[y][x + 1] === 'T') {
        window.__szlaki.stores.bus.emit('teleport', { x, y, facing: 'down' });
        return { x, y };
      }
    }
    return null;
  });
  await idle(300);
  await resetCooldown();
  const a = await pos();
  await idle(2500); // stanie w trawie
  const r1 = await rolls();
  await hold(...OFF.right, 1200); // napieranie na drzewo z pola trawy
  await idle(300);
  const b = await pos();
  const r2 = await rolls();
  record('T4', 'Stanie w trawie i napieranie na przeszkodę nie generują losowań', !!spot && r1 === 0 && r2 === 0 && same(a, b), { spot, rzutyPoStaniu: r1, rzutyPoZderzeniu: r2, przed: a, po: b });
} catch (e) { fail('T4', 'Brak losowania w miejscu', e); }

// ───────────── T5. Spotkanie w trawie + T6 walka z wylosowanym przeciwnikiem + podwójne „Dalej” ─────────────
let t5 = null;
try {
  const before = await stats();
  t5 = await grassEncounter();
  const st = await ui();
  const foe = await enemy();
  const range = MEADOW[foe.pokemon];
  const lvlOk = !!range && foe.level >= range[0] + (foe.mighty ? 3 : 0) && foe.level <= range[1] + (foe.mighty ? 3 : 0);
  const moved = Math.abs(t5.during[0] - t5.before[0]) + Math.abs(t5.during[1] - t5.before[1]);
  // Klawiatura w trakcie walki nie porusza postaci.
  const p0 = await pos();
  await page.keyboard.down('ArrowLeft');
  await idle(500);
  await page.keyboard.up('ArrowLeft');
  const p1 = await pos();
  await shot('t5-grass-battle');
  const ok = t5.zdarzenia.length === 1 && t5.zdarzenia[0].kind === 'step' && t5.zdarzenia[0].zoneId === 'meadow' && t5.zdarzenia[0].table === 'meadow' && moved === 1 && ['ENCOUNTER_STARTING', 'BATTLE'].includes(t5.stanPoKroku) && st.gameMode === 'BATTLE' && st.inputLocked && lvlOk && same(p0, p1) && (await stats()).encounters === before.encounters + 1;
  record('T5', 'Spotkanie w wysokiej trawie: jeden rzut-trafienie po kroku, przeciwnik z tabeli Łąki i z zakresu poziomów, ruch zablokowany', ok, { ...t5, przeciwnik: foe, zakres: range, krokiDoSpotkania: moved, stan: st.gameMode, klawiaturaWWalce: [p0, p1] });
} catch (e) { fail('T5', 'Spotkanie w trawie', e); }

try {
  if (!t5) throw new Error('brak walki z T5');
  const rollsBefore = (await ui()).rolls;
  const done = await fightToEnd(false);
  if (!done) throw new Error('walka nie dobiegła końca');
  const outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome);
  const before = await stats();
  // Podwójne/potrójne „Dalej” przy wolnym pobieraniu ruchu do nauki (jak po awansie).
  await page.route('**/api/v2/move/**', async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
  await S(() => {
    const B = window.__szlaki.stores.useBattle;
    const s = B.getState();
    const lead = s.engine.sides[0].party[s.engine.sides[0].active[0]];
    B.setState({ engine: { ...s.engine, pendingLearns: [{ uid: lead.uid, move: 'hyper-voice' }] } });
  });
  await clickDalej(3);
  const ending = await ui();
  await idle(3500);
  await page.unroute('**/api/v2/move/**');
  await afterBattleBackOnMap();
  const after = await stats();
  const key = { win: 'won', caught: 'caught', fled: 'fled', lose: 'blackouts' }[outcome];
  const st = await ui();
  const map = await S(() => ({ petla: window.__szlaki.game.loop.running, towarzysz: !!window.__szlaki.game.scene.getScene('Overworld').follower }));
  const restored = await controlRestored();
  const ok = after[key] - before[key] === 1 && st.gameMode === 'EXPLORATION' && !st.inputLocked && st.activeEncounterId === null && st.last?.outcome === outcome && st.last?.reason === 'result' && st.cooldown === 3 && st.rolls === rollsBefore && map.petla && map.towarzysz && restored.ruszyl;
  record('T6', 'Walka z wylosowanym przeciwnikiem kończy się raz mimo 3× „Dalej”; brak losowań w walce; odnowienie 3 kroki; sterowanie wraca', ok, { wynik: outcome, przyrost: after[key] - before[key], stanPodczasKonczenia: ending.gameMode, stanPo: st, rzutyWWalce: st.rolls - rollsBefore, mapa: map, sterowanie: restored });
} catch (e) { fail('T6', 'Koniec walki', e); }

// ───────────── T7. Odnowienie: 3 kroki bez losowania, czwarty z losowaniem ─────────────
try {
  await setStepRng('hit');
  const spot = await placeWithRoom('right', 6, { terrain: 'grass' });
  await idle(300);
  await S(() => window.__szlaki.stores.useUi.setState({ encounterCooldown: 3, encounterStepProgress: 0 })); // stan jak tuż po walce
  await watchEncounters();
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await singleStep('right');
    const u = await ui();
    seen.push({ krok: i + 1, odnowienie: u.cooldown, decyzja: u.decision, stan: u.gameMode });
  }
  const r3 = await rolls();
  const before4 = await pos();
  await hold(...OFF.right, 450, false);
  const u4 = await ui();
  await idle(400);
  await page.mouse.up();
  await waitBattle();
  await setStepRng('miss');
  const ev = await encounters();
  const outcome = await fleeToEnd();
  await page.getByRole('button', { name: 'Dalej' }).click();
  await afterBattleBackOnMap();
  const ok = JSON.stringify(seen.map((s) => s.odnowienie)) === '[2,1,0]' && seen.every((s) => s.decyzja === 'cooldown' && s.stan === 'EXPLORATION') && r3 === 0 && ev.length === 1 && ['ENCOUNTER_STARTING', 'BATTLE'].includes(u4.gameMode);
  record('T7', 'Odnowienie: po walce 3 kroki w trawie bez losowania (3→2→1→0), czwarty krok losuje', ok, { spot, kroki: seen, rzutyWOdnowieniu: r3, czwartyKrok: { start: before4, stan: u4.gameMode }, spotkania: ev.length, wynikWalki: outcome });
} catch (e) { fail('T7', 'Odnowienie', e); }

// ───────────── T8. Dwa triggery w tej samej klatce, powtórzony trigger i obce zdarzenie ─────────────
let t8 = null;
try {
  await placeWithRoom('right', 3, { terrain: 'safe' });
  await idle(300);
  await resetCooldown();
  await watchEncounters();
  t8 = await S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const st = window.__szlaki.stores;
    const E = window.__szlaki.encounter;
    const guard = sc.actors.find((a) => a.id === 'static:gaj-straznik');
    const meadow = sc.mapDef.zones.find((z) => z.id === 'meadow');
    const r1 = sc.startEncounter(guard); // kontakt ze Strażnikiem
    const r2 = st.useUi.getState().registerEncounterStep({ movedToNewTile: true, zone: meadow }, E.createSequenceRng([0])); // krok w trawie w tej samej klatce
    const r3 = sc.startEncounter(guard); // powtórzenie tego samego triggera
    const id = st.useUi.getState().activeEncounterId;
    st.bus.emit('encounter', { encounterId: 'enc-obce', source: { kind: 'step', locationId: 'x', zoneId: 'meadow', zoneName: 'Łąka', terrainType: 'TALL_GRASS', encounterTableId: 'meadow' } });
    const u = st.useUi.getState();
    return { kontakt: r1, krokWTejKlatce: { rzut: r2.decision.rolled, spotkanie: r2.encounterId }, powtorzenie: r3, zrodlo: u.sourceEntityId, idBezZmian: u.activeEncounterId === id };
  });
  await waitBattle();
  const st = await ui();
  const ev = await encounters();
  const foe = await enemy();
  record('T8', 'Dwa źródła w tej samej klatce i powtórzony trigger: jedno spotkanie; obce zdarzenie nic nie zmienia', t8.kontakt === true && t8.krokWTejKlatce.rzut === false && t8.krokWTejKlatce.spotkanie === null && t8.powtorzenie === false && t8.zrodlo === 'static:gaj-straznik' && t8.idBezZmian && ev.filter((x) => x.id !== 'enc-obce').length === 1 && st.gameMode === 'BATTLE', { ...t8, spotkania: ev, przeciwnik: foe, stan: st.gameMode });
} catch (e) { fail('T8', 'Dwa triggery', e); }

// ───────────── T9. Spotkanie specjalne: ucieczka (zostaje), ponowny kontakt w odnowieniu odrzucony ─────────────
try {
  if (!t8) throw new Error('brak walki ze Strażnikiem z T8');
  const foe = await enemy();
  // Scenariusz ucieczki: starter (poz. 5) jest szybszy od Strażnika, więc ucieczka się udaje (jak przy osłabieniu przeciwnika w T10).
  await page.waitForFunction(() => window.__szlaki.stores.useBattle.getState().phase === 'choose', null, { timeout: 20000 });
  await S(() => {
    const B = window.__szlaki.stores.useBattle;
    const engine = structuredClone(B.getState().engine);
    const side = engine.sides[0];
    side.party[side.active[0]].stats.spe = 999;
    B.setState({ engine });
  });
  const outcome = await fleeToEnd();
  const before = await stats();
  await page.getByRole('button', { name: 'Dalej' }).click();
  await afterBattleBackOnMap();
  const after = await stats();
  const g = await S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); const a = sc.actors.find((x) => x.id === 'static:gaj-straznik'); return a ? { at: [a.tx, a.ty], engaged: a.engaged } : null; });
  // Gracz obok Strażnika, odnowienie po walce: kontakt nie może od razu wywołać walki.
  await S(() => window.__szlaki.stores.bus.emit('teleport', { x: 35, y: 28, facing: 'right' }));
  await idle(300);
  await S(() => window.__szlaki.stores.useUi.setState({ encounterCooldown: 3 }));
  await watchEncounters();
  await hold(...OFF.right, 700);
  await idle(300);
  const ev = await encounters();
  const st = await ui();
  const ok = outcome === 'fled' && after.fled - before.fled === 1 && g && same(g.at, [36, 28]) && g.engaged === false && ev.length === 0 && st.gameMode === 'EXPLORATION';
  record('T9', 'Strażnik po ucieczce zostaje na miejscu; w odnowieniu kontakt nie startuje walki', ok, { przeciwnik: foe, wynik: outcome, straznik: g, spotkaniaWOdnowieniu: ev.length, stan: st.gameMode });
} catch (e) { fail('T9', 'Strażnik — ucieczka', e); }

// ───────────── T10. Spotkanie specjalne przez kontakt joystickiem → złapanie → znika na stałe ─────────────
try {
  await S(() => window.__szlaki.stores.useGame.getState().addItem('capsule-plus', 20));
  await S(() => window.__szlaki.stores.useGame.getState().healAll());
  await setStepRng('miss');
  await S(() => window.__szlaki.stores.bus.emit('teleport', { x: 35, y: 28, facing: 'right' }));
  await idle(300);
  await resetCooldown();
  await watchEncounters();
  const p0 = await pos();
  await hold(...OFF.right, 450, false);
  const st0 = await ui();
  await idle(500);
  const p1 = await pos();
  await page.mouse.up();
  await waitBattle();
  const foe = await enemy();
  const ev = await encounters();
  const before = await stats();
  let outcome = null;
  for (let i = 0; i < 600 && !outcome; i++) {
    if (await page.getByRole('button', { name: 'Dalej' }).count()) { outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome); break; }
    const ph = await S(() => window.__szlaki.stores.useBattle.getState().phase);
    if (ph === 'choose') {
      await S(() => {
        const B = window.__szlaki.stores.useBattle;
        const engine = structuredClone(B.getState().engine);
        engine.sides[1].party[0].hp = 1; // osłabiony przeciwnik — złapanie zwykłą akcją torby
        B.setState({ engine });
        B.getState().submit({ kind: 'item', item: 'capsule-plus' });
      });
    } else if (ph === 'forcedSwitch') await page.locator('.creature-row:not([disabled])').first().click();
    else { await S(() => window.__szlaki.stores.useBattle.getState().skip()); await idle(40); }
  }
  await clickDalej(2);
  await afterBattleBackOnMap();
  await idle(500);
  const after = await stats();
  const st = await ui();
  const map = await S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { straznikNaMapie: sc.actors.some((a) => a.id === 'static:gaj-straznik'), flaga: !!window.__szlaki.stores.useGame.getState().flags['static-done:gaj-straznik'] }; });
  const added = after.party + after.storage - (before.party + before.storage);
  const ok = ev.length === 1 && ev[0].kind === 'static' && ev[0].actorId === 'static:gaj-straznik' && same(p0, p1) && ['ENCOUNTER_STARTING', 'BATTLE'].includes(st0.gameMode) && foe.pokemon === 'growlithe' && foe.mighty === true && outcome === 'caught' && added === 1 && after.caught - before.caught === 1 && !map.straznikNaMapie && map.flaga && st.gameMode === 'EXPLORATION';
  record('T10', 'Spotkanie specjalne: kontakt joystickiem (gracz stoi), złapanie raz mimo 2× „Dalej”, Strażnik znika i zostaje flaga', ok, { przeciwnik: foe, spotkania: ev, gracz: [p0, p1], wynik: outcome, dodane: added, mapa: map, stan: st.gameMode });
} catch (e) { fail('T10', 'Strażnik — złapanie', e); }

// ───────────── T11. Przegrana po spotkaniu w trawie ─────────────
try {
  const before = await stats();
  await S(() => window.__szlaki.stores.useGame.setState((s) => ({ party: s.party.map((c) => ({ ...c, hp: 1 })) })));
  await grassEncounter();
  await fightToEnd(true);
  const outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await afterBattleBackOnMap();
  const after = await stats();
  const st = await ui();
  const s2 = await S(() => { const g = window.__szlaki.stores.useGame.getState(); const sc = window.__szlaki.game.scene.getScene('Overworld'); return { pozycjaZapisu: [g.player.x, g.player.y], pozycjaSceny: [sc.tx, sc.ty], hp: g.party.map((x) => `${x.hp}/${x.stats.hp}`) }; });
  const cooldownPo = st.cooldown;
  const restored = await controlRestored();
  const ok = after.blackouts - before.blackouts === 1 && same(s2.pozycjaZapisu, [5, 6]) && same(s2.pozycjaSceny, [5, 6]) && st.gameMode === 'EXPLORATION' && !st.inputLocked && cooldownPo >= 2 && restored.ruszyl;
  record('T11', 'Przegrana: leczenie i Stacja Opieki raz, odnowienie/kroki ochronne, sterowanie wraca', outcome === 'lose' ? ok : 'INFO', { wynik: outcome, ...s2, stan: st, sterowanie: restored });
} catch (e) { fail('T11', 'Przegrana', e); }

// ───────────── T12. Błąd rozpoczęcia walki (wyczerpana drużyna) ─────────────
try {
  await S(() => window.__szlaki.stores.useGame.setState((s) => ({ party: s.party.map((c) => ({ ...c, hp: 0 })) })));
  await setStepRng('hit');
  let spot = null, dir = null;
  for (const d of ['right', 'left', 'down', 'up']) { spot = await placeWithRoom(d, 2, { terrain: 'grass' }); if (spot) { dir = d; break; } }
  await idle(300);
  await resetCooldown();
  await watchEncounters();
  await hold(...OFF[dir], 450);
  await idle(1200);
  const toast = await page.locator('.toast').textContent().catch(() => null);
  const st = await ui();
  const ev = await encounters();
  const battleShown = await page.locator('.battle').count();
  await setStepRng('miss');
  await S(() => window.__szlaki.stores.useGame.getState().healAll());
  const restored = await controlRestored();
  const ok = ev.length === 1 && battleShown === 0 && st.gameMode === 'EXPLORATION' && !st.inputLocked && st.last?.reason === 'init-error' && st.last?.outcome === 'cancel' && /wyczerpana/.test(toast ?? '') && restored.ruszyl;
  record('T12', 'Błąd rozpoczęcia walki: komunikat, spotkanie anulowane centralnie, sterowanie wraca', ok, { komunikat: toast, stan: st, walka: battleShown, sterowanie: restored });
} catch (e) { fail('T12', 'Błąd inicjalizacji', e); }

// ───────────── T13. Wejście na mapę (przeładowanie): kroki ochronne, Strażnik nie wraca, towarzysz jest ─────────────
try {
  await idle(2500); // autozapis
  await page.reload();
  await page.getByRole('button', { name: /Kontynuuj/ }).click({ timeout: 15000 });
  await waitJoystick();
  await page.waitForFunction(() => !!window.__szlaki?.game?.scene?.getScene('Overworld')?.follower, null, { timeout: 20000 });
  await idle(1500);
  await setStepRng('hit');
  const u0 = await ui();
  const map = await S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { aktorzy: sc.actors.map((a) => a.id), towarzysz: !!sc.follower }; });
  const spot = await placeWithRoom('right', 5, { terrain: 'grass' });
  await idle(300);
  await S(() => window.__szlaki.stores.useUi.setState({ encounterCooldown: 2, encounterStepProgress: 0 })); // jak tuż po wejściu
  await watchEncounters();
  const seen = [];
  for (let i = 0; i < 2; i++) { await singleStep('right'); seen.push((await ui()).cooldown); }
  const ev2 = (await encounters()).length;
  await hold(...OFF.right, 450, false);
  await idle(400);
  await page.mouse.up();
  await waitBattle();
  await setStepRng('miss');
  const ev3 = (await encounters()).length;
  await fleeToEnd();
  await page.getByRole('button', { name: 'Dalej' }).click();
  await afterBattleBackOnMap();
  const ok = u0.cooldown === 2 && map.aktorzy.length === 0 && map.towarzysz && JSON.stringify(seen) === '[1,0]' && ev2 === 0 && ev3 === 1;
  record('T13', 'Po wejściu na mapę 2 kroki ochronne (bez losowań), trzeci losuje; Strażnik nie wraca po złapaniu; towarzysz jest', ok, { odnowieniePoWczytaniu: u0.cooldown, mapa: map, spot, odnowieniePoKrokach: seen, spotkaniaW2Krokach: ev2, spotkaniaPo3: ev3 });
} catch (e) { fail('T13', 'Wejście na mapę', e); }

// ═════════════ Sprint 3: model świata, dwie lokacje, przejścia, zapis lokacji ═════════════
/** Bieżąca wersja formatu zapisu (Sprint 4: v3). */
const SAVE_V = 3;
const REGION = 'kraina-szlakow';
const POLANA = 'polana-startowa';
const ZAGAJNIK = 'szepczacy-zagajnik';
const POLANA_TABLES = ['meadow', 'pond', 'rocks', 'grove'];
const ZAGAJNIK_SPECIES = { caterpie: [3, 5], weedle: [3, 5], oddish: [4, 6], hoothoot: [4, 6], seedot: [4, 6], skwovet: [3, 5], fomantis: [5, 7] };
/** Położenie w świecie: scena (mapa, pozycja), zapis w stanie gry, HUD, odnowienie spotkań. */
const where = () => S(() => {
  const sc = window.__szlaki.game.scene.getScene('Overworld');
  const g = window.__szlaki.stores.useGame.getState().player;
  const u = window.__szlaki.stores.useUi.getState();
  const chip = [...document.querySelectorAll('.chip')].find((c) => c.textContent.includes('📍'));
  return { scena: sc.location?.id ?? null, mapa: sc.mapDef.id, region: g.regionId, lokacja: g.locationId, punkt: g.spawnPointId, zapisPoz: [g.x, g.y], poz: [sc.tx, sc.ty], kierunek: sc.facing, towarzysz: !!sc.follower, przejscie: u.transition, odnowienie: u.encounterCooldown, hud: chip ? chip.textContent : null };
});
/** Czeka na koniec przejścia: scena z mapą lokacji `id`, wejście odblokowane, towarzysz na miejscu. */
const waitArrival = (id) => page.waitForFunction((id) => {
  const sc = window.__szlaki?.game?.scene?.getScene('Overworld');
  return !!sc && sc.location?.id === id && !window.__szlaki.stores.useUi.getState().transition && !!sc.follower;
}, id, { timeout: 20000 });
/** Wiersz zapisu prosto z IndexedDB (to, co przetrwa zamknięcie aplikacji). */
const idbSave = () => S(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('szlaki-dziczy');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const q = db.transaction('saves', 'readonly').objectStore('saves').get('slot1');
    q.onerror = () => reject(q.error);
    q.onsuccess = () => {
      db.close();
      const row = q.result;
      const c = row?.data?.party?.[0] ?? null;
      const stworzenie = c ? { pokemon: c.pokemon, nature: c.nature ?? null, abilityId: c.abilityId ?? null, ability: c.ability ?? null, heldItemId: c.heldItemId ?? null, heldItem: c.heldItem ?? null, evolutionState: c.evolutionState ?? null, stats: c.stats } : null;
      resolve(row ? { wersjaWiersza: row.version, wersjaDanych: row.data.version, region: row.data.player.regionId ?? null, lokacja: row.data.player.locationId ?? null, punkt: row.data.player.spawnPointId ?? null, mapId: row.data.player.mapId ?? null, poz: [row.data.player.x, row.data.player.y], pieniadze: row.data.player.money, stworzenie } : null);
    };
  };
}));
const idbPut = (row) => S((row) => new Promise((resolve, reject) => {
  const req = indexedDB.open('szlaki-dziczy');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('saves', 'readwrite');
    tx.objectStore('saves').put(row);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => reject(tx.error);
  };
}), row);
/** Ucieczka z dzikiej walki (szybki starter — jak w T9) i powrót na mapę. */
async function fleeFast() {
  await page.waitForFunction(() => window.__szlaki.stores.useBattle.getState().phase === 'choose', null, { timeout: 20000 });
  await S(() => {
    const B = window.__szlaki.stores.useBattle;
    const engine = structuredClone(B.getState().engine);
    const side = engine.sides[0];
    side.party[side.active[0]].stats.spe = 999;
    B.setState({ engine });
  });
  const outcome = await fleeToEnd();
  await page.getByRole('button', { name: 'Dalej' }).click();
  await afterBattleBackOnMap();
  return outcome;
}

// ───────────── W1. Model świata ─────────────
try {
  await setStepRng('miss');
  const w = await S(() => { const W = window.__szlaki.world; return { bledy: W.validateWorld(), region: W.WORLD.regions.map((r) => `${r.id}:${r.status}`), lokacje: W.WORLD.locations.map((l) => `${l.id}:${l.type}:${l.status}`) }; });
  const p = await where();
  record('W1', 'Model świata: dane bez błędów walidacji; gra stoi na Polanie Startowej (stały identyfikator) w regionie', w.bledy.length === 0 && p.region === REGION && p.lokacja === POLANA && p.scena === POLANA && p.mapa === 'polana', { ...w, gracz: p });
} catch (e) { fail('W1', 'Model świata', e); }

// ───────────── W2. Przejście A → B joystickiem ─────────────
let w2ok = false;
try {
  await setStepRng('miss');
  await S(() => window.__szlaki.stores.bus.emit('teleport', { x: 36, y: 14, facing: 'right' }));
  await idle(300);
  const exit = await S(() => window.__szlaki.game.scene.getScene('Overworld').exitAt(39, 14));
  const start = await pos();
  await hold(...OFF.right, 1400, false); // 36 → 37 → 38 → 39 (wyjście)
  await waitArrival(ZAGAJNIK);
  const arrived = await where();
  await idle(900); // palec wciąż na joysticku: po przejściu nie prowadzi postaci dalej
  const still = await pos();
  await page.mouse.up();
  const save = await idbSave();
  await shot('w2-zagajnik');
  w2ok = exit === 'polana-do-zagajnika' && arrived.scena === ZAGAJNIK && arrived.mapa === 'zagajnik' && arrived.lokacja === ZAGAJNIK && arrived.region === REGION && arrived.punkt === 'z-polany' && same(arrived.poz, [2, 9]) && same(arrived.zapisPoz, [2, 9]) && arrived.kierunek === 'right' && arrived.towarzysz && !arrived.przejscie && arrived.odnowienie >= 2 && /Szepczący Zagajnik/.test(arrived.hud ?? '') && same(still, [2, 9]) && save?.lokacja === ZAGAJNIK && save?.wersjaDanych === SAVE_V;
  record('W2', 'Przejście A→B joystickiem: Zagajnik, punkt „z-polany” (2,9) twarzą w prawo, towarzysz, HUD, kroki ochronne, zapis od razu w IndexedDB', w2ok, { wyjscie: exit, start, poPrzejsciu: arrived, palecTrzymany900ms: still, zapis: save });
} catch (e) { fail('W2', 'Przejście A→B', e); }

// ───────────── W3. Spotkanie na mapie B korzysta z tabeli Zagajnika ─────────────
try {
  if (!w2ok) throw new Error('brak przejścia do Zagajnika z W2');
  const before = await stats();
  const enc = await grassEncounter();
  const foe = await enemy();
  const range = ZAGAJNIK_SPECIES[foe.pokemon];
  const lvlOk = !!range && foe.level >= range[0] + (foe.mighty ? 3 : 0) && foe.level <= range[1] + (foe.mighty ? 3 : 0);
  await shot('w3-zagajnik-battle');
  const outcome = await fleeFast();
  const p = await where();
  const ok = enc.zdarzenia.length === 1 && enc.zdarzenia[0].kind === 'step' && enc.zdarzenia[0].zoneId === 'paprocie' && enc.zdarzenia[0].table === 'zagajnik' && lvlOk && (await stats()).encounters === before.encounters + 1 && outcome === 'fled' && p.lokacja === ZAGAJNIK && p.scena === ZAGAJNIK;
  record('W3', 'Spotkanie w paprociach Zagajnika: tabela „zagajnik” (inna niż na Polanie), gatunek i poziom z tej tabeli; po walce gracz zostaje na mapie B', ok, { ...enc, przeciwnik: foe, zakres: range, wynik: outcome, poWalce: p });
} catch (e) { fail('W3', 'Tabela spotkań mapy B', e); }

// ───────────── W4. Zapis na mapie B i ponowne wczytanie ─────────────
try {
  if (!w2ok) throw new Error('brak przejścia do Zagajnika z W2');
  await setStepRng('miss');
  const spot = await placeWithRoom('right', 2, { terrain: 'safe' });
  await idle(300);
  await hold(...OFF.right, 500); // ruch → autozapis
  await idle(2800);
  const before = await where();
  const save = await idbSave();
  await page.reload();
  await page.getByRole('button', { name: /Kontynuuj/ }).click({ timeout: 15000 });
  await waitJoystick();
  await waitArrival(ZAGAJNIK);
  await setStepRng('miss');
  const after = await where();
  const restored = await controlRestored();
  const ok = save?.lokacja === ZAGAJNIK && same(save.poz, before.zapisPoz) && after.scena === ZAGAJNIK && after.mapa === 'zagajnik' && after.lokacja === ZAGAJNIK && same(after.poz, before.poz) && after.towarzysz && /Szepczący Zagajnik/.test(after.hud ?? '') && restored.ruszyl;
  record('W4', 'Zapis na mapie B i ponowne wczytanie (przeładowanie + Kontynuuj): gra wraca do Zagajnika w to samo miejsce', ok, { spot, przed: before, zapis: save, poWczytaniu: after, sterowanie: restored });
} catch (e) { fail('W4', 'Zapis i wczytanie mapy B', e); }

// ───────────── W5. Zablokowana ścieżka (lokacja w planach): komunikat i brak softlocka ─────────────
try {
  if (!w2ok) throw new Error('brak przejścia do Zagajnika z W2');
  await setStepRng('miss');
  await S(() => window.__szlaki.stores.bus.emit('teleport', { x: 13, y: 2, facing: 'up' }));
  await idle(300);
  await hold(...OFF.up, 1100, false); // 2 → 1 → 0 (wyzwalacz ścieżki na Wzgórza)
  await page.locator('.dialog').waitFor({ timeout: 5000 });
  const text = (await page.locator('.dialog').textContent()) ?? '';
  const atExit = await where();
  await page.mouse.up();
  await closeDialogs();
  await idle(200);
  await hold(...OFF.down, 750);
  await idle(400);
  const after = await where();
  const ok = /zwalone drzewo/.test(text) && same(atExit.poz, [13, 0]) && atExit.scena === ZAGAJNIK && after.scena === ZAGAJNIK && after.lokacja === ZAGAJNIK && after.poz[0] === 13 && after.poz[1] >= 1 && !after.przejscie && !(await page.locator('.dialog').count());
  record('W5', 'Ścieżka na Wzgórza (PLANNED) zablokowana: komunikat, gracz zostaje w Zagajniku i odchodzi joystickiem (brak softlocka)', ok, { komunikat: text, naWyjsciu: atExit, poOdejsciu: after });
} catch (e) { fail('W5', 'Zablokowana ścieżka', e); }

// ───────────── W6. Powrót B → A joystickiem ─────────────
let w6ok = false;
try {
  if (!w2ok) throw new Error('brak przejścia do Zagajnika z W2');
  await setStepRng('miss');
  await S(() => window.__szlaki.stores.bus.emit('teleport', { x: 3, y: 9, facing: 'left' }));
  await idle(300);
  const exit = await S(() => window.__szlaki.game.scene.getScene('Overworld').exitAt(0, 9));
  await hold(...OFF.left, 1400, false); // 3 → 2 → 1 → 0 (wyjście)
  await waitArrival(POLANA);
  const arrived = await where();
  await idle(900);
  const still = await pos();
  await page.mouse.up();
  const actors = await S(() => ({ ids: window.__szlaki.game.scene.getScene('Overworld').actors.map((a) => a.id), straznikZlapany: !!window.__szlaki.stores.useGame.getState().flags['static-done:gaj-straznik'] }));
  const save = await idbSave();
  await shot('w6-polana');
  w6ok = exit === 'zagajnik-do-polany' && arrived.scena === POLANA && arrived.mapa === 'polana' && arrived.lokacja === POLANA && arrived.punkt === 'z-zagajnika' && same(arrived.poz, [38, 14]) && arrived.kierunek === 'left' && arrived.towarzysz && !arrived.przejscie && arrived.odnowienie >= 2 && !/Zagajnik/.test(arrived.hud ?? '') && same(still, [38, 14]) && actors.ids.length === (actors.straznikZlapany ? 0 : 1) && save?.lokacja === POLANA;
  record('W6', 'Powrót B→A joystickiem: Polana przy wschodnim wyjściu (38,14) twarzą od wyjścia; stan Strażnika zachowany; zapis od razu', w6ok, { wyjscie: exit, poPrzejsciu: arrived, palecTrzymany900ms: still, aktorzy: actors, zapis: save });
} catch (e) { fail('W6', 'Powrót B→A', e); }

// ───────────── W7. Po powrocie na Polanę spotkania znów z tabel Polany ─────────────
try {
  if (!w6ok) throw new Error('brak powrotu na Polanę z W6');
  const enc = await grassEncounter();
  const foe = await enemy();
  const outcome = await fleeFast();
  const p = await where();
  const ok = enc.zdarzenia.length === 1 && POLANA_TABLES.includes(enc.zdarzenia[0].table) && enc.zdarzenia[0].table !== 'zagajnik' && !(foe.pokemon in ZAGAJNIK_SPECIES) && outcome === 'fled' && p.lokacja === POLANA;
  record('W7', 'Po powrocie na Polanę spotkanie korzysta z tabeli Polany (nie Zagajnika)', ok, { ...enc, przeciwnik: foe, wynik: outcome });
} catch (e) { fail('W7', 'Tabela po powrocie', e); }

// ───────────── W8. Przegrana w Zagajniku → Stacja Opieki na Polanie (punkt leczenia z modelu świata) ─────────────
try {
  await setStepRng('miss');
  await S((r) => window.__szlaki.stores.bus.emit('travel', { regionId: r, locationId: 'szepczacy-zagajnik', spawnPointId: 'z-polany', x: 2, y: 9, facing: 'right' }), REGION);
  await waitArrival(ZAGAJNIK);
  const before = await stats();
  await S(() => window.__szlaki.stores.useGame.setState((s) => ({ party: s.party.map((c) => ({ ...c, hp: 1 })) })));
  await grassEncounter();
  await fightToEnd(true);
  const outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await afterBattleBackOnMap();
  if (outcome === 'lose') await waitArrival(POLANA);
  const p = await where();
  const after = await stats();
  const hp = await S(() => window.__szlaki.stores.useGame.getState().party.every((c) => c.hp === c.stats.hp));
  const restored = await controlRestored();
  const ok = after.blackouts - before.blackouts === 1 && p.scena === POLANA && p.lokacja === POLANA && p.punkt === 'stacja-opieki' && same(p.poz, [5, 6]) && hp && p.odnowienie >= 2 && !p.przejscie && restored.ruszyl;
  record('W8', 'Przegrana w Zagajniku: powrót raz do Stacji Opieki na Polanie (5,6), drużyna wyleczona, sterowanie wraca', outcome === 'lose' ? ok : 'INFO', { wynik: outcome, poWalce: p, wyleczeni: hp, sterowanie: restored });
} catch (e) { fail('W8', 'Przegrana na mapie B', e); }

// ───────────── W9. Migracja zapisu v1 (sprzed Sprintu 3) z IndexedDB ─────────────
try {
  await setStepRng('miss');
  const spot = await placeWithRoom('right', 3, { terrain: 'safe' });
  await idle(300);
  // Zapis v1 budujemy ze stanu gry; pozycję ustawiamy jawnie (teleport diagnostyczny przesuwa tylko scenę).
  const v1 = await S((spot) => {
    const snap = structuredClone(window.__szlaki.stores.useGame.getState().snapshot());
    const p = snap.player;
    delete p.regionId; delete p.locationId; delete p.spawnPointId;
    p.mapId = 'polana';
    p.x = spot.x;
    p.y = spot.y;
    p.money = 4321;
    // Stworzenia w formacie sprzed Sprintu 4: `ability`, `heldItem`, bez natury i stanu ewolucji.
    const old = (c) => {
      const o = { ...c, ability: c.abilityId, heldItem: c.heldItemId };
      delete o.abilityId; delete o.heldItemId; delete o.nature; delete o.evolutionState;
      return o;
    };
    snap.party = snap.party.map(old);
    snap.storage = snap.storage.map(old);
    return { ...snap, version: 1 };
  }, spot);
  await page.reload(); // ekran tytułowy — gra nie jest uruchomiona, autozapis nic nie nadpisze
  await page.getByRole('button', { name: /Kontynuuj/ }).waitFor({ timeout: 15000 });
  await idbPut({ id: 'slot1', data: v1, version: 1, updatedAt: Date.now() });
  const stored = await idbSave();
  await page.reload();
  await page.getByRole('button', { name: /Kontynuuj/ }).click({ timeout: 15000 });
  await waitJoystick();
  await waitArrival(POLANA);
  await setStepRng('miss');
  const p = await where();
  const money = await S(() => window.__szlaki.stores.useGame.getState().player.money);
  const lead9 = await S(() => { const c = window.__szlaki.stores.useGame.getState().party[0]; return { nature: c.nature, abilityId: c.abilityId, heldItemId: c.heldItemId, evolutionState: c.evolutionState, stats: c.stats, neutralna: window.__szlaki.creatures.NATURES[c.nature]?.increased === null }; });
  const restored = await controlRestored(); // ruch → autozapis w nowym formacie
  await idle(2800);
  const resaved = await idbSave();
  const creatureOk = stored?.stworzenie?.ability && stored.stworzenie.abilityId === null && lead9.abilityId === stored.stworzenie.ability && lead9.neutralna && JSON.stringify(lead9.stats) === JSON.stringify(stored.stworzenie.stats) && lead9.evolutionState?.cancelledAtLevel === null && resaved?.stworzenie?.ability === null && resaved?.stworzenie?.nature === lead9.nature;
  const ok = stored?.wersjaDanych === 1 && stored?.mapId === 'polana' && same(stored.poz, [spot.x, spot.y]) && p.region === REGION && p.lokacja === POLANA && p.punkt === 'start' && same(p.zapisPoz, [spot.x, spot.y]) && same(p.poz, [spot.x, spot.y]) && money === 4321 && restored.ruszyl && resaved?.wersjaDanych === SAVE_V && resaved?.wersjaWiersza === SAVE_V && resaved?.lokacja === POLANA && resaved?.mapId === null && creatureOk;
  record('W9', 'Stary zapis v1 (mapId, stworzenia bez natury) z IndexedDB: migracja do v3 — Polana, pozycja, pieniądze; natura neutralna, zdolność zachowana, statystyki bez zmian', ok, { pozycjaV1: spot, zapisV1: stored, poWczytaniu: p, pieniadze: money, prowadzacy: lead9, zapisPoMigracji: resaved, sterowanie: restored });
} catch (e) { fail('W9', 'Migracja zapisu v1', e); }


// ═════════════ Sprint 4: natury, zdolności, przedmioty trzymane, ewolucje ═════════════
const lead = () => S(() => {
  const c = window.__szlaki.stores.useGame.getState().party[0];
  return { uid: c.uid, pokemon: c.pokemon, speciesId: c.speciesId, level: c.level, exp: c.exp, hp: c.hp, maxHp: c.stats.hp, nature: c.nature, abilityId: c.abilityId, heldItemId: c.heldItemId, evolutionState: c.evolutionState, moves: c.moves.map((m) => m.name) };
});
const bagCount = (id) => S((id) => window.__szlaki.stores.useGame.getState().bag[id] ?? 0, id);
const openMenu = async (name) => { await page.locator('.hud-menu button', { hasText: name }).click(); await page.locator('.modal').first().waitFor(); };
const closeModal = async () => { while (await page.locator('.modal-close').count()) { await page.locator('.modal-close').last().click(); await idle(150); } };
/** Komunikaty walki (view.message) zbierane od tej chwili. */
const captureMessages = () => S(() => {
  window.__msgs = [];
  if (window.__msgSub) window.__msgSub();
  window.__msgSub = window.__szlaki.stores.useBattle.subscribe((s, p) => { const m = s.view?.message; if (m && m !== p.view?.message) window.__msgs.push(m); });
});
const messages = () => S(() => window.__msgs ?? []);
const waitChoose = () => page.waitForFunction(() => window.__szlaki.stores.useBattle.getState().phase === 'choose', null, { timeout: 20000 });
/** Odtwarza zdarzenia tury do kolejnego wyboru (albo końca walki). */
async function playTurn() {
  for (let i = 0; i < 400; i++) {
    const ph = await S(() => window.__szlaki.stores.useBattle.getState().phase);
    if (ph === 'choose' || ph === 'ended' || ph === 'forcedSwitch') return ph;
    await S(() => window.__szlaki.stores.useBattle.getState().skip());
    await idle(40);
  }
  return null;
}
const patchEnemy = (patch) => S((patch) => {
  const B = window.__szlaki.stores.useBattle;
  const engine = structuredClone(B.getState().engine);
  const e = engine.sides[1].party[0];
  Object.assign(e, patch.creature ?? {});
  e.stats = { ...e.stats, ...(patch.stats ?? {}) };
  B.setState({ engine });
}, patch);
let leadBefore = null;

// ───────────── E1. Natura, zdolność i przedmiot w Drużynie; zakładanie z Torby i zdejmowanie ─────────────
try {
  await waitJoystick();
  await S(() => window.__szlaki.stores.useGame.getState().addItem('trail-leftovers', 1));
  leadBefore = await lead();
  const bag0 = await bagCount('trail-leftovers');
  await openMenu('Torba');
  await page.locator('.modal .card', { hasText: 'Resztki prowiantu' }).getByRole('button', { name: 'Załóż' }).click();
  await page.locator('.modal .creature-row').first().click();
  await idle(200);
  const afterEquip = { held: (await lead()).heldItemId, bag: await bagCount('trail-leftovers') };
  await closeModal();
  await openMenu('Drużyna');
  await page.locator('.modal .creature-row').first().click();
  await page.getByTestId('creature-nature').waitFor();
  const natureText = (await page.getByTestId('creature-nature').textContent()) ?? '';
  const abilityText = (await page.getByTestId('creature-ability').textContent()) ?? '';
  const heldText = (await page.getByTestId('creature-held').textContent()) ?? '';
  const nat = await S((id) => window.__szlaki.creatures.NATURES[id], leadBefore.nature);
  const upText = nat.increased ? ((await page.getByTestId(`stat-${nat.increased}`).textContent()) ?? '') : '';
  const downText = nat.decreased ? ((await page.getByTestId(`stat-${nat.decreased}`).textContent()) ?? '') : '';
  await shot('e1-party-detail');
  await page.getByTestId('creature-held').getByRole('button', { name: 'Zdejmij' }).click();
  await idle(200);
  const afterUnequip = { held: (await lead()).heldItemId, bag: await bagCount('trail-leftovers') };
  await page.getByTestId('creature-held').getByRole('button', { name: 'Załóż' }).click();
  await page.getByTestId('creature-held').getByRole('button', { name: /Resztki prowiantu/ }).click();
  await idle(200);
  const afterReequip = { held: (await lead()).heldItemId, bag: await bagCount('trail-leftovers') };
  await closeModal();
  const natureOk = natureText.includes(nat.name) && (nat.increased ? upText.includes('▲') && downText.includes('▼') : natureText.includes('neutralna'));
  const ok = afterEquip.held === 'trail-leftovers' && afterEquip.bag === bag0 - 1 && natureOk && abilityText.includes('Zdolność') && heldText.includes('Resztki prowiantu') && afterUnequip.held === null && afterUnequip.bag === bag0 && afterReequip.held === 'trail-leftovers' && afterReequip.bag === bag0 - 1;
  record('E1', 'Drużyna pokazuje naturę (▲/▼ przy statystykach), zdolność i przedmiot; zakładanie z Torby i z Drużyny, zdejmowanie zwraca do torby', ok, { prowadzacy: leadBefore, natura: natureText, zdolnosc: abilityText, przedmiot: heldText, zalozenie: afterEquip, zdjecie: afterUnequip, ponownie: afterReequip });
} catch (e) { fail('E1', 'Natura, zdolność, przedmiot w Drużynie', e); }

// ───────────── E2. Przedmiot trzymany działa w walce (Resztki prowiantu na koniec tury) ─────────────
try {
  await waitJoystick();
  await S(() => {
    const G = window.__szlaki.stores.useGame;
    G.setState((s) => ({ party: s.party.map((c, i) => (i === 0 ? { ...c, hp: Math.max(1, Math.floor(c.stats.hp / 2)), status: null } : c)) }));
    G.getState().addItem('balm', 1);
  });
  await grassEncounter();
  await waitChoose();
  await patchEnemy({ stats: { atk: 1, spa: 1 } }); // przeciwnik prawie bez obrażeń — gracz na pewno dotrwa do końca tury
  const hp0 = await S(() => { const B = window.__szlaki.stores.useBattle.getState(); return B.engine.sides[0].party[B.engine.sides[0].active[0]].hp; });
  await captureMessages();
  await S((uid) => window.__szlaki.stores.useBattle.getState().submit({ kind: 'item', item: 'balm', targetUid: uid }), (await lead()).uid);
  await playTurn();
  const msgs = await messages();
  const healEvent = msgs.find((m) => m.includes('Resztki prowiantu'));
  await shot('e2-leftovers');
  const outcome = await fleeFast();
  const ok = !!healEvent && /odzyskuje \d+ PŻ/.test(healEvent) && outcome === 'fled' && (await lead()).heldItemId === 'trail-leftovers';
  record('E2', 'Przedmiot trzymany w walce: Resztki prowiantu leczą na koniec tury (przedmiot zostaje)', ok, { hpPrzedTura: hp0, komunikat: healEvent ?? null, komunikaty: msgs.slice(-8), wynik: outcome });
} catch (e) { fail('E2', 'Przedmiot w walce', e); }

// ───────────── E3. Zdolność działa w walce (Ucieczka: pewna ucieczka od dużo szybszego przeciwnika) ─────────────
try {
  await waitJoystick();
  const original = (await lead()).abilityId;
  await S(() => window.__szlaki.stores.useGame.setState((s) => ({ party: s.party.map((c, i) => (i === 0 ? { ...c, abilityId: 'run-away' } : c)) })));
  await grassEncounter();
  await waitChoose();
  await patchEnemy({ stats: { spe: 999 } });
  await captureMessages();
  await page.getByRole('button', { name: 'Ucieczka' }).click();
  await page.getByRole('button', { name: 'Dalej' }).waitFor({ timeout: 20000 });
  const outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome);
  const escapes = await S(() => window.__szlaki.stores.useBattle.getState().engine.escapeAttempts);
  const msgs = await messages();
  await page.getByRole('button', { name: 'Dalej' }).click();
  await afterBattleBackOnMap();
  await S((ab) => window.__szlaki.stores.useGame.setState((s) => ({ party: s.party.map((c, i) => (i === 0 ? { ...c, abilityId: ab } : c)) })), original);
  const ok = outcome === 'fled' && escapes === 1 && msgs.some((m) => m.includes('Ucieczka'));
  record('E3', 'Zdolność w walce: „Ucieczka” — pierwsza próba ucieczki od przeciwnika o szybkości 999 się udaje', ok, { wynik: outcome, proby: escapes, komunikaty: msgs });
} catch (e) { fail('E3', 'Zdolność w walce', e); }

// ───────────── E4. Ewolucja przez poziom od początku do końca (prawdziwe dane PokéAPI): anulowanie, potem ewolucja ─────────────
let e4 = null;
try {
  await waitJoystick();
  const before = await lead();
  const info = await S(async () => {
    const c = window.__szlaki.stores.useGame.getState().party[0];
    const i = await window.__szlaki.creatures.evolutionInfo(c);
    return i.checks.map((x) => ({ to: x.option.to, method: x.option.method, status: x.status, minLevel: x.option.minLevel }));
  });
  const target = info.find((x) => x.method === 'LEVEL');
  if (!target) throw new Error('prowadzący nie ma ewolucji przez poziom: ' + JSON.stringify(info));
  const L = target.minLevel;
  // Scenariusz: poziom tuż przed progiem, brakuje 1 pkt doświadczenia.
  await S(async ({ L }) => {
    const G = window.__szlaki.stores.useGame;
    const c = G.getState().party[0];
    const table = await window.__szlaki.creatures.getGrowth(c.growthRate);
    G.setState((s) => ({ party: s.party.map((x, i) => (i === 0 ? { ...x, level: L - 1, exp: table[L] - 1, hp: x.stats.hp, status: null, evolutionState: { cancelledAtLevel: null, evolvedFrom: null } } : x)) }));
  }, { L });
  await grassEncounter();
  await waitChoose();
  await patchEnemy({ creature: { hp: 1 } });
  if (!(await fightToEnd(false))) throw new Error('walka nie dobiegła końca');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await closeDialogs();
  await page.getByTestId('evolution-modal').waitFor({ timeout: 30000 });
  const modalText = (await page.getByTestId('evolution-modal').textContent()) ?? '';
  await shot('e4-evolution-modal');
  const atLevel = await lead();
  // 1) Anulowanie.
  await page.getByTestId('evolution-modal').getByRole('button', { name: 'Przerwij' }).click();
  await idle(300);
  const afterCancel = await lead();
  const modalGone = (await page.getByTestId('evolution-modal').count()) === 0;
  await closeDialogs();
  await waitJoystick();
  // 2) Drużyna: warunek spełniony + „Ewoluuj”.
  await openMenu('Drużyna');
  await page.locator('.modal .creature-row').first().click();
  await page.getByTestId('creature-evolution').waitFor({ timeout: 20000 });
  const evoText = (await page.getByTestId('creature-evolution').textContent()) ?? '';
  await page.getByTestId('creature-evolution').getByRole('button', { name: 'Ewoluuj' }).first().click();
  await page.getByTestId('evolution-modal').waitFor({ timeout: 20000 });
  const followerBefore = await S(() => window.__szlaki.game.scene.getScene('Overworld').followerKey);
  await page.getByTestId('evolution-modal').getByRole('button', { name: 'Ewoluuj' }).click();
  await page.locator('.dialog').waitFor({ timeout: 20000 });
  const dialogText = (await page.locator('.dialog').textContent()) ?? '';
  await closeDialogs();
  await closeModal();
  await waitJoystick();
  await idle(800);
  const after = await lead();
  const dex = await S((id) => window.__szlaki.stores.useGame.getState().dex[String(id)] ?? null, after.speciesId);
  const followerAfter = await S(() => window.__szlaki.game.scene.getScene('Overworld').followerKey);
  await shot('e4-evolved');
  e4 = after;
  const ok =
    atLevel.level === L && modalText.includes('Ewoluuj') && afterCancel.pokemon === before.pokemon && afterCancel.evolutionState?.cancelledAtLevel === L && modalGone &&
    evoText.includes('warunek spełniony') && /Gratulacje/.test(dialogText) &&
    after.pokemon !== before.pokemon && after.speciesId !== before.speciesId && after.level === L && after.exp === atLevel.exp && JSON.stringify(after.moves) === JSON.stringify(atLevel.moves) &&
    after.nature === before.nature && after.heldItemId === atLevel.heldItemId && after.evolutionState?.evolvedFrom === before.pokemon && dex?.caught === true && followerAfter.includes(`|${after.pokemon}|`) && followerAfter !== followerBefore;
  record('E4', 'Ewolucja przez poziom: awans w walce → okno; „Przerwij” zostawia gatunek; z Drużyny „Ewoluuj” → nowy gatunek, poziom, EXP, ruchy, natura i przedmiot bez zmian, Atlas, towarzysz', ok, { cel: target, przed: before, naPoziomie: atLevel, poAnulowaniu: afterCancel, druzyna: evoText, dialog: dialogText, po: after, atlas: dex, towarzysz: [followerBefore, followerAfter] });
} catch (e) { fail('E4', 'Ewolucja przez poziom', e); }

// ───────────── E5. Ewolucja kamieniem z Torby (Eevee + Kamień przypływu): anulowanie nie zużywa kamienia ─────────────
try {
  await waitJoystick();
  const eevee = await S(async () => {
    const C = window.__szlaki.creatures;
    const G = window.__szlaki.stores.useGame;
    if (G.getState().party.length >= 6) G.getState().moveToStorage(G.getState().party.length - 1);
    const { creature } = await C.buildStarter('eevee', 10, C.rng);
    G.getState().addCreature(creature);
    G.getState().addItem('stone-water', 1);
    return creature.uid;
  });
  const findC = () => S((uid) => { const c = window.__szlaki.stores.useGame.getState().party.find((x) => x.uid === uid); return c ? { pokemon: c.pokemon, level: c.level, exp: c.exp, moves: c.moves.map((m) => m.name), types: c.types } : null; }, eevee);
  const before = await findC();
  const useStone = async () => {
    await openMenu('Torba');
    await page.locator('.modal .card', { hasText: 'Kamień przypływu' }).getByRole('button', { name: 'Użyj' }).click();
    await page.locator('.modal', { hasText: 'Może ewoluować w: vaporeon' }).waitFor({ timeout: 30000 });
    const rows = page.locator('.modal .creature-row');
    const n = await rows.count();
    let clicked = false;
    for (let i = 0; i < n && !clicked; i++) {
      if (!(await rows.nth(i).isDisabled())) { await rows.nth(i).click(); clicked = true; }
    }
    if (!clicked) throw new Error('żadne stworzenie nie może użyć kamienia');
    await page.getByTestId('evolution-modal').waitFor({ timeout: 20000 });
  };
  await useStone();
  await page.getByTestId('evolution-modal').getByRole('button', { name: 'Przerwij' }).click();
  await idle(300);
  const afterCancel = { c: await findC(), stone: await bagCount('stone-water') };
  await closeModal();
  await useStone();
  await page.getByTestId('evolution-modal').getByRole('button', { name: 'Ewoluuj' }).click();
  await page.locator('.dialog').waitFor({ timeout: 20000 });
  await closeDialogs();
  await closeModal();
  await waitJoystick();
  const after = await findC();
  const stone = await bagCount('stone-water');
  const dex = await S(() => window.__szlaki.stores.useGame.getState().dex['134'] ?? null);
  await shot('e5-vaporeon');
  const ok = before?.pokemon === 'eevee' && afterCancel.c?.pokemon === 'eevee' && afterCancel.stone === 1 && after?.pokemon === 'vaporeon' && after.types.includes('water') && after.level === 10 && after.exp === before.exp && JSON.stringify(after.moves) === JSON.stringify(before.moves) && stone === 0 && dex?.caught === true;
  record('E5', 'Ewolucja kamieniem z Torby: Eevee → Vaporeon; „Przerwij” nie zużywa kamienia, potwierdzenie zużywa; poziom, EXP i ruchy zostają', ok, { przed: before, poAnulowaniu: afterCancel, po: after, kamien: stone, atlas: dex });
} catch (e) { fail('E5', 'Ewolucja kamieniem', e); }

// ───────────── E6. Zapis i wczytanie nowych pól (natura, zdolność, przedmiot, stan ewolucji) ─────────────
try {
  await waitJoystick();
  await setStepRng('miss');
  await controlRestored(); // ruch → autozapis
  await idle(2800);
  const party = () => S(() => window.__szlaki.stores.useGame.getState().party.map((c) => ({ uid: c.uid, pokemon: c.pokemon, nature: c.nature, abilityId: c.abilityId, heldItemId: c.heldItemId, evolutionState: c.evolutionState, stats: c.stats })));
  const before = await party();
  const row = await idbSave();
  await page.reload();
  await page.getByRole('button', { name: /Kontynuuj/ }).click({ timeout: 15000 });
  await waitJoystick();
  await page.waitForFunction(() => !!window.__szlaki?.game?.scene?.getScene('Overworld')?.follower, null, { timeout: 20000 });
  await setStepRng('miss');
  const after = await party();
  const ok = row?.wersjaDanych === SAVE_V && JSON.stringify(after) === JSON.stringify(before) && before.some((c) => c.evolutionState?.evolvedFrom) && before.some((c) => c.heldItemId);
  record('E6', 'Zapis v3 w IndexedDB i ponowne wczytanie: natura, zdolność, przedmiot i stan ewolucji bez zmian', ok, { wersja: row?.wersjaDanych, przed: before, po: after });
} catch (e) { fail('E6', 'Zapis i wczytanie', e); }

// ───────────── E7. Zgodność starego zapisu v2 (stworzenia bez natury, pola ability/heldItem) ─────────────
try {
  await waitJoystick();
  const v2 = await S(() => {
    const snap = structuredClone(window.__szlaki.stores.useGame.getState().snapshot());
    const old = (c) => {
      const o = { ...c, ability: c.abilityId, heldItem: c.heldItemId };
      delete o.abilityId; delete o.heldItemId; delete o.nature; delete o.evolutionState;
      return o;
    };
    snap.party = snap.party.map(old);
    snap.storage = snap.storage.map(old);
    return { ...snap, version: 2 };
  });
  await page.reload();
  await page.getByRole('button', { name: /Kontynuuj/ }).waitFor({ timeout: 15000 });
  await idbPut({ id: 'slot1', data: v2, version: 2, updatedAt: Date.now() });
  const stored = await idbSave();
  await page.reload();
  await page.getByRole('button', { name: /Kontynuuj/ }).click({ timeout: 15000 });
  await waitJoystick();
  await setStepRng('miss');
  const after = await S(() => window.__szlaki.stores.useGame.getState().party.map((c) => ({ pokemon: c.pokemon, nature: c.nature, neutralna: window.__szlaki.creatures.NATURES[c.nature]?.increased === null, abilityId: c.abilityId, heldItemId: c.heldItemId, evolutionState: c.evolutionState, stats: c.stats })));
  const restored = await controlRestored();
  await idle(2800);
  const resaved = await idbSave();
  const src = v2.party;
  const ok = stored?.wersjaDanych === 2 && after.length === src.length && after.every((c, i) => c.pokemon === src[i].pokemon && c.neutralna && c.abilityId === src[i].ability && c.heldItemId === src[i].heldItem && JSON.stringify(c.stats) === JSON.stringify(src[i].stats) && c.evolutionState && c.evolutionState.cancelledAtLevel === null) && restored.ruszyl && resaved?.wersjaDanych === SAVE_V && resaved?.stworzenie?.ability === null && resaved?.stworzenie?.nature;
  record('E7', 'Stary zapis v2 z IndexedDB: stworzenia dostają naturę neutralną, zdolność i przedmiot zachowane, statystyki bez zmian; ponowny zapis w v3', ok, { zapisV2: stored, poWczytaniu: after, zapisPo: resaved, sterowanie: restored });
} catch (e) { fail('E7', 'Zgodność zapisu v2', e); }

// ───────────── U1. Wersja i ręczne sprawdzenie aktualizacji (Menu) ─────────────
try {
  await waitJoystick();
  await page.locator('.hud-menu button', { hasText: '☰' }).click();
  await page.locator('.modal').waitFor();
  const version = (await page.getByTestId('options-version').textContent())?.trim() ?? '';
  await page.getByRole('button', { name: 'Sprawdź aktualizację' }).click();
  await page.locator('.toast').waitFor({ timeout: 15000 });
  const toast = (await page.locator('.toast').textContent())?.trim() ?? '';
  const sw = await S(async () => ({ kontroluje: !!navigator.serviceWorker?.controller }));
  await page.locator('.modal-close').click();
  record('U1', 'Menu pokazuje wersję gry; „Sprawdź aktualizację” pyta serwer (service worker) i odpowiada', /^[0-9a-f]{7}/.test(version) && toast === 'Masz najnowszą wersję gry.' && sw.kontroluje, { wersja: version, komunikat: toast, serviceWorker: sw });
} catch (e) { fail('U1', 'Sprawdzenie aktualizacji', e); }

// ───────────── R17. Konsola ─────────────
record('R17', 'Brak błędów i ostrzeżeń w konsoli (bez komunikatów sterownika GL)', consoleIssues.length === 0, consoleIssues);
await shot('r17-end');

await browser.close();
console.log('\n=== PODSUMOWANIE TESTÓW REGRESJI ===');
for (const r of results) console.log(`${r.id.padEnd(4)} ${r.verdict.padEnd(11)} ${r.title}`);
const bad = results.filter((r) => r.verdict === 'PROBLEM' || r.verdict === 'BŁĄD TESTU');
console.log(`\nOK: ${results.filter((r) => r.verdict === 'OK').length}, INFO: ${results.filter((r) => r.verdict === 'INFO').length}, PROBLEM/BŁĄD: ${bad.length}`);
process.exitCode = bad.length ? 1 : 0;
