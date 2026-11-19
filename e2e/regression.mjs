// Testy regresji E2E Sprintu 1 (joystick i atomowa blokada spotkań) na prawdziwym buildzie (Phaser + PokéAPI).
// Ruch wyłącznie przez joystick ekranowy (zdarzenia wskaźnika) i klawiaturę — bez tap-to-move.
// Spotkania wywoływane realnym kontaktem: stworzenie stawiane obok gracza, gracz wchodzi w nie joystickiem.
// Tryb ?debug służy tylko do odczytu stanu i ustawienia scenariusza (pozycja, zamrożenie wędrówki stworzeń).
// Użycie: node e2e/regression.mjs http://localhost:4173/   (kod wyjścia ≠ 0 przy każdym problemie)
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
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
const ui = () => S(() => { const u = window.__szlaki.stores.useUi.getState(); return { mode: u.mode, gameMode: u.gameMode, activeEncounterId: u.activeEncounterId, sourceEntityId: u.sourceEntityId, inputLocked: u.inputLocked, transition: u.transition, dialog: !!u.dialog, modal: u.modal, last: u.lastEncounter }; });
const stats = () => S(() => { const g = window.__szlaki.stores.useGame.getState(); return { won: g.stats.battlesWon, caught: g.stats.caught, fled: g.stats.fled, blackouts: g.stats.blackouts, encounters: g.stats.encounters, money: g.player.money, party: g.party.length, storage: g.storage.length }; });

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
  await page.mouse.move(cx + dx + 0.01, cy + dy); // ruch w obrębie joysticka (pointermove)
  await idle(ms);
  if (release) await page.mouse.up();
}
const OFF = { up: [0, -45], down: [0, 45], left: [-45, 0], right: [45, 0] };

/** Zamraża wędrówkę i odradzanie stworzeń (scenariusz ruchu bez przypadkowych kontaktów). */
const freezeActors = () => S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); sc.updateActors = () => {}; sc.maintainSpawns = () => {}; });
const unfreezeActors = () => S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); delete sc.updateActors; delete sc.maintainSpawns; });
const unfreezeSpawns = () => S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); delete sc.maintainSpawns; });

/** Teleport gracza (zdarzenie gry) na pole z co najmniej `need` wolnymi polami w kierunku `dir`. */
async function placeWithRoom(dir, need, extra = null) {
  return S(({ dir, need, extra }) => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const free = (x, y) => sc.isWalkable(x, y) && !sc.actorAt(x, y);
    const run = (x, y, d) => { let n = 0; const [dx, dy] = D[d]; for (let i = 1; i <= 12; i++) { if (free(x + dx * i, y + dy * i)) n++; else break; } return n; };
    let best = null;
    for (let y = 1; y < sc.grid.length - 1; y++) for (let x = 1; x < sc.grid[0].length - 1; x++) {
      if (!free(x, y)) continue;
      if (run(x, y, dir) < need) continue;
      if (extra && run(x, y, extra) < need) continue;
      if (sc.actors.some((a) => !a.removed && Math.abs(a.tx - x) + Math.abs(a.ty - y) <= 3)) continue;
      best = { x, y };
      break;
    }
    if (!best) return null;
    window.__szlaki.stores.bus.emit('teleport', { x: best.x, y: best.y, facing: 'down' });
    return best;
  }, { dir, need, extra });
}

/** Stawia wolne stworzenie tuż obok gracza; zwraca jego id i kierunek kontaktu. */
async function placeActorNextToPlayer() {
  return S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const D = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
    const a = sc.actors.find((x) => !x.removed && !x.engaged);
    if (!a) return null;
    for (const [d, [dx, dy]] of Object.entries(D)) {
      const x = sc.tx + dx, y = sc.ty + dy;
      const fol = sc.followerTile && sc.followerTile.x === x && sc.followerTile.y === y;
      if (sc.isWalkable(x, y) && !sc.actorAt(x, y) && !fol) {
        sc.tweens.killTweensOf(a.container);
        a.tx = x; a.ty = y; a.moving = false;
        a.container.setPosition(x * 16 + 8, (y + 1) * 16);
        return { id: a.id, dir: d, name: a.spawn.creature.name };
      }
    }
    return null;
  });
}

/** Realny kontakt: gracz wchodzi joystickiem w stworzenie stojące obok. */
async function contactEncounter() {
  await freezeActors();
  await S(() => window.__szlaki.stores.useUi.setState({ encounterCooldown: 0 }));
  let t = await placeActorNextToPlayer();
  if (!t) {
    const spot = await placeWithRoom('right', 2);
    await idle(300);
    t = spot ? await placeActorNextToPlayer() : null;
  }
  if (!t) throw new Error('brak stworzenia do kontaktu');
  await S(() => { window.__enc = 0; window.__encFrom = []; if (!window.__encSub) { window.__encSub = window.__szlaki.stores.bus.on('encounter', (p) => { window.__enc += 1; (window.__encFrom ??= []).push(p.actorId); }); } });
  const before = await pos();
  const [ox, oy] = OFF[t.dir];
  await hold(ox, oy, 450, false);
  const during = await ui();
  await idle(600);
  const posDuring = await pos();
  await page.mouse.up();
  return { ...t, before, posDuring, stateTuzPoKontakcie: during.gameMode, zdarzeniaEncounter: await S(() => window.__enc) };
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
async function afterBattleBackOnMap() {
  await closeDialogs();
  await idle(400);
  await closeDialogs();
  await waitJoystick();
}
/** Czy sterowanie wróciło: joystick porusza postać po upływie odnowienia. */
async function controlRestored() {
  await idle(1700);
  await freezeActors();
  const spot = await placeWithRoom('right', 3);
  await idle(250);
  const a = await pos();
  await hold(...OFF.right, 500);
  await idle(300);
  const b = await pos();
  return { spot, przed: a, po: b, ruszyl: b[0] > a[0] };
}

// ───────────── R0. Start gry, joystick w HUD ─────────────
try {
  await page.goto(BASE + '?debug');
  await page.getByRole('button', { name: 'Nowa gra' }).click();
  await page.locator('.starter-card h3').nth(2).waitFor({ timeout: 30000 });
  await page.locator('.starter-card').first().click();
  await page.getByRole('button', { name: /Ruszamy/ }).click();
  await page.locator('.dialog').waitFor({ timeout: 15000 });
  await closeDialogs();
  await waitJoystick();
  await page.waitForFunction(() => { const sc = window.__szlaki?.game?.scene?.getScene('Overworld'); return !!sc && sc.actors.filter((a) => !a.removed).length >= 3 && !!sc.follower; }, null, { timeout: 30000 });
  const hud = { joystick: await page.locator('.joystick').count(), dpad: await page.locator('.dpad').count(), knob: await page.locator('.joystick .knob').count(), stan: await ui() };
  await shot('r0-joystick');
  record('R0', 'Start gry: joystick jest sterowaniem ekranowym (brak starego pada), stan EXPLORATION', hud.joystick === 1 && hud.dpad === 0 && hud.knob === 1 && hud.stan.gameMode === 'EXPLORATION' && !hud.stan.inputLocked, hud);
} catch (e) { fail('R0', 'Start gry', e); }

// ───────────── R1. Cztery kierunki + zatrzymanie po puszczeniu ─────────────
try {
  await freezeActors();
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
  const spot = await placeWithRoom('down', 9, 'right');
  if (!spot) throw new Error('brak otwartego miejsca');
  await idle(300);
  const a = await pos();
  await hold(32, 32, 1000);
  await idle(300);
  const b = await pos();
  const diagTiles = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  const axis = b[0] !== a[0] ? 'right' : 'down';
  const oneAxis = b[0] === a[0] || b[1] === a[1];
  await S((s) => window.__szlaki.stores.bus.emit('teleport', { x: s.x, y: s.y, facing: 'down' }), spot);
  await idle(300);
  const c = await pos();
  await hold(...OFF[axis], 1000);
  await idle(300);
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
  await idle(300);
  const b = await pos();
  await page.mouse.move(...(await joyCenter()).map((v, i) => v + (i ? 50 : 0))); // dalszy ruch palca po anulowaniu
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
  await idle(300);
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
  await idle(300);
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
  await idle(400);
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
  await shot('r6-portrait-after-rotations');
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
  await idle(400);
  const b = await pos();
  const f = await S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { sprite: !!sc.follower, tile: sc.followerTile ? [sc.followerTile.x, sc.followerTile.y] : null }; });
  const behind = f.tile && f.tile[0] === b[0] - 1 && f.tile[1] === b[1];
  record('R9', 'Towarzysz idzie za graczem (pole, które gracz opuścił)', b[0] > a[0] && f.sprite && behind, { start: a, gracz: b, towarzysz: f });
} catch (e) { fail('R9', 'Towarzysz', e); }

// ───────────── R10. Kontakt: jedno spotkanie, natychmiastowa blokada ruchu ─────────────
let r10 = null;
try {
  const before = await stats();
  r10 = await contactEncounter();
  await waitBattle();
  const st = await ui();
  // Klawiatura w trakcie walki nie porusza postaci.
  const p0 = await pos();
  await page.keyboard.down('ArrowLeft');
  await idle(500);
  await page.keyboard.up('ArrowLeft');
  const p1 = await pos();
  const joy = await S(() => ({ dir: window.__szlaki.input.virtualInput.dir, pointer: window.__szlaki.input.joystick.pointerId, powod: window.__szlaki.input.joystick.lastRelease }));
  await shot('r10-battle');
  const ok = r10.zdarzeniaEncounter === 1 && same(r10.before, r10.posDuring) && ['ENCOUNTER_STARTING', 'BATTLE'].includes(r10.stateTuzPoKontakcie) && st.gameMode === 'BATTLE' && st.sourceEntityId === r10.id && st.inputLocked && same(p0, p1) && joy.dir === null && (await stats()).encounters === before.encounters + 1;
  record('R10', 'Kontakt joystickiem: dokładnie jedno spotkanie, ruch zablokowany od razu i w walce', ok, { ...r10, stanWalki: st, klawiaturaWWalce: [p0, p1], joystick: joy });
} catch (e) { fail('R10', 'Kontakt', e); }

// ───────────── R11. Zwycięstwo/wynik + podwójne „Dalej” + powrót sterowania ─────────────
try {
  if (!r10) throw new Error('brak walki z R10');
  const done = await fightToEnd(false);
  if (!done) throw new Error('walka nie dobiegła końca');
  const outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome);
  const before = await stats();
  await page.route('**/api/v2/move/**', async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
  await S(() => {
    const B = window.__szlaki.stores.useBattle;
    const s = B.getState();
    const lead = s.engine.sides[0].party[s.engine.sides[0].active[0]];
    B.setState({ engine: { ...s.engine, pendingLearns: [{ uid: lead.uid, move: 'hyper-voice' }] } });
  });
  await S(() => { const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Dalej'); btn.click(); btn.click(); btn.click(); });
  const endingState = await ui();
  await idle(3500);
  await page.unroute('**/api/v2/move/**');
  await afterBattleBackOnMap();
  const after = await stats();
  const key = { win: 'won', caught: 'caught', fled: 'fled', lose: 'blackouts' }[outcome];
  const st = await ui();
  const map = await S((id) => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { petla: window.__szlaki.game.loop.running, aktorUsuniety: !sc.actors.some((a) => a.id === id), towarzysz: !!sc.follower }; }, r10.id);
  const restored = await controlRestored();
  const ok = after[key] - before[key] === 1 && st.gameMode === 'EXPLORATION' && !st.inputLocked && st.activeEncounterId === null && st.last?.outcome === outcome && st.last?.reason === 'result' && map.petla && map.towarzysz && restored.ruszyl && (outcome === 'fled' || map.aktorUsuniety);
  record('R11', 'Koniec walki: wynik liczony raz mimo 3× „Dalej”, powrót do EXPLORATION, joystick znów działa, towarzysz jest', ok, { wynik: outcome, przyrost: after[key] - before[key], stanPodczasKonczenia: endingState.gameMode, stanPo: st, mapa: map, sterowanie: restored });
} catch (e) { fail('R11', 'Koniec walki', e); }

// ───────────── R12. Dwa triggery w tej samej klatce + obce zdarzenie ─────────────
try {
  await freezeActors();
  await unfreezeSpawns();
  await page.waitForFunction(() => window.__szlaki.game.scene.getScene('Overworld').actors.filter((a) => !a.removed && !a.engaged).length >= 2, null, { timeout: 30000 });
  await S(() => window.__szlaki.stores.useUi.setState({ encounterCooldown: 0 }));
  await S(() => { window.__enc = 0; window.__encFrom = []; });
  const r = await S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const st = window.__szlaki.stores;
    const free = sc.actors.filter((a) => !a.removed && !a.engaged);
    const [a1, a2] = free;
    const r1 = sc.startEncounter(a1);
    const r2 = sc.startEncounter(a2); // ta sama klatka
    const r3 = sc.startEncounter(a1); // powtórzenie tego samego triggera
    const id = st.useUi.getState().activeEncounterId;
    st.bus.emit('encounter', { actorId: a2.id, spawn: a2.spawn }); // zdarzenie spoza blokady
    st.bus.emit('encounter', { encounterId: 'enc-obce', actorId: a2.id, spawn: a2.spawn });
    const u = st.useUi.getState();
    return { a1: a1.id, a2: a2.id, wyniki: [r1, r2, r3], zdarzenia: window.__enc, zrodlo: u.sourceEntityId, idBezZmian: u.activeEncounterId === id, a2Wolny: !a2.engaged };
  });
  await waitBattle();
  const st = await ui();
  record('R12', 'Dwa triggery w tej samej klatce i powtórzony trigger: jedno spotkanie; obce zdarzenia nic nie zmieniają', r.wyniki.join() === 'true,false,false' && r.zrodlo === r.a1 && r.idBezZmian && r.a2Wolny && st.gameMode === 'BATTLE' && st.sourceEntityId === r.a1, { ...r, stan: st });

  // Ucieczka z tej walki.
  let outcome = null;
  for (let i = 0; i < 300 && !outcome; i++) {
    if (await page.getByRole('button', { name: 'Dalej' }).count()) { outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome); break; }
    const ph = await S(() => window.__szlaki.stores.useBattle.getState().phase);
    if (ph === 'choose') await page.getByRole('button', { name: 'Ucieczka' }).click();
    else if (ph === 'forcedSwitch') await page.locator('.creature-row:not([disabled])').first().click();
    else { await S(() => window.__szlaki.stores.useBattle.getState().skip()); await idle(40); }
  }
  const before = await stats();
  await page.getByRole('button', { name: 'Dalej' }).click();
  await afterBattleBackOnMap();
  // Wędrówka i pościg znów aktywne: stworzenie, przed którym uciekliśmy, nie może od razu zacząć nowego spotkania.
  await unfreezeActors();
  await S(() => { window.__enc = 0; window.__encFrom = []; });
  await idle(2500);
  const after = await stats();
  const s2 = await S((id) => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const a = sc.actors.find((x) => x.id === id);
    const u = window.__szlaki.stores.useUi.getState();
    return { aktorIstnieje: !!a, engaged: a?.engaged, aggressive: a?.aggressive, odnowienieMs: a ? Math.round(a.cooldownUntil - sc.time.now) : null, gameMode: u.gameMode, inputLocked: u.inputLocked, spotkaniaZTymStworzeniemW2_5s: (window.__encFrom ?? []).filter((x) => x === id).length, petla: window.__szlaki.game.loop.running };
  }, r.a1);
  await freezeActors();
  // Ewentualne spotkanie z innym stworzeniem w tym czasie kończymy ucieczką, żeby nie wpływało na kolejne testy.
  if ((await ui()).gameMode !== 'EXPLORATION') {
    await waitBattle();
    await fightToEnd(false);
    await page.getByRole('button', { name: 'Dalej' }).click();
    await afterBattleBackOnMap();
  }
  const ok = outcome !== 'fled' || (after.fled - before.fled === 1 && s2.aktorIstnieje && s2.engaged === false && s2.odnowienieMs > 0 && s2.spotkaniaZTymStworzeniemW2_5s === 0 && s2.petla);
  record('R13', 'Ucieczka: licznik raz, stworzenie zostaje z odnowieniem, brak natychmiastowego ponownego spotkania', outcome === 'fled' ? ok : 'INFO', { wynik: outcome, przyrost: after.fled - before.fled, ...s2 });
} catch (e) { fail('R12', 'Dwa triggery / ucieczka', e); }

// ───────────── R14. Złapanie ─────────────
try {
  await S(() => window.__szlaki.stores.useGame.getState().addItem('capsule-plus', 15));
  await S(() => window.__szlaki.stores.useGame.getState().healAll());
  await page.waitForFunction(() => window.__szlaki.game.scene.getScene('Overworld').actors.filter((a) => !a.removed && !a.engaged).length >= 1, null, { timeout: 30000 });
  const c = await contactEncounter();
  await waitBattle();
  const before = await stats();
  let outcome = null;
  for (let i = 0; i < 600 && !outcome; i++) {
    if (await page.getByRole('button', { name: 'Dalej' }).count()) { outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome); break; }
    const ph = await S(() => window.__szlaki.stores.useBattle.getState().phase);
    if (ph === 'choose') {
      await S(() => {
        const B = window.__szlaki.stores.useBattle;
        const s = B.getState();
        const engine = structuredClone(s.engine);
        engine.sides[1].party[0].hp = 1; // osłabiony przeciwnik — próba złapania przez zwykłą akcję torby
        B.setState({ engine });
        B.getState().submit({ kind: 'item', item: 'capsule-plus' });
      });
    } else if (ph === 'forcedSwitch') await page.locator('.creature-row:not([disabled])').first().click();
    else { await S(() => window.__szlaki.stores.useBattle.getState().skip()); await idle(40); }
  }
  await S(() => { const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Dalej'); btn.click(); btn.click(); });
  await afterBattleBackOnMap();
  const after = await stats();
  const st = await ui();
  const added = after.party + after.storage - (before.party + before.storage);
  const ok = outcome === 'caught' ? after.caught - before.caught === 1 && added === 1 && st.gameMode === 'EXPLORATION' && !st.inputLocked : false;
  record('R14', 'Złapanie: stworzenie dodane dokładnie raz (podwójne „Dalej”), powrót do eksploracji', outcome === 'caught' ? ok : 'INFO', { przeciwnik: c.name, wynik: outcome, dodane: added, licznik: after.caught - before.caught, stan: st });
} catch (e) { fail('R14', 'Złapanie', e); }

// ───────────── R15. Przegrana ─────────────
try {
  await page.waitForFunction(() => window.__szlaki.game.scene.getScene('Overworld').actors.filter((a) => !a.removed && !a.engaged).length >= 1, null, { timeout: 30000 });
  const before = await stats();
  await S(() => window.__szlaki.stores.useGame.setState((s) => ({ party: s.party.map((c) => ({ ...c, hp: 1 })) })));
  const c = await contactEncounter();
  await waitBattle();
  await fightToEnd(true);
  const outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await afterBattleBackOnMap();
  const after = await stats();
  const st = await ui();
  const s2 = await S((id) => {
    const g = window.__szlaki.stores.useGame.getState();
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    return { pozycjaZapisu: [g.player.x, g.player.y], pozycjaSceny: [sc.tx, sc.ty], hp: g.party.map((x) => `${x.hp}/${x.stats.hp}`), aktorUsuniety: !sc.actors.some((a) => a.id === id) };
  }, c.id);
  const restored = await controlRestored();
  const ok = after.blackouts - before.blackouts === 1 && same(s2.pozycjaZapisu, [5, 6]) && same(s2.pozycjaSceny, [5, 6]) && s2.aktorUsuniety && st.gameMode === 'EXPLORATION' && !st.inputLocked && restored.ruszyl;
  record('R15', 'Przegrana: leczenie i Stacja Opieki raz, stworzenie usunięte, sterowanie wraca', outcome === 'lose' ? ok : 'INFO', { wynik: outcome, ...s2, stan: st, sterowanie: restored });
} catch (e) { fail('R15', 'Przegrana', e); }

// ───────────── R16. Błąd inicjalizacji ─────────────
try {
  await unfreezeSpawns();
  await page.waitForFunction(() => window.__szlaki.game.scene.getScene('Overworld').actors.filter((a) => !a.removed && !a.engaged).length >= 1, null, { timeout: 30000 });
  await S(() => window.__szlaki.stores.useGame.setState((s) => ({ party: s.party.map((c) => ({ ...c, hp: 0 })) })));
  const c = await contactEncounter();
  await idle(1200);
  const toast = await page.locator('.toast').textContent().catch(() => null);
  const st = await ui();
  const actor = await S((id) => { const a = window.__szlaki.game.scene.getScene('Overworld').actors.find((x) => x.id === id); return a ? { engaged: a.engaged, cooldownUstawione: a.cooldownUntil !== 0 } : null; }, c.id);
  const battleShown = await page.locator('.battle').count();
  await S(() => window.__szlaki.stores.useGame.getState().healAll());
  const restored = await controlRestored();
  const ok = c.zdarzeniaEncounter === 1 && battleShown === 0 && st.gameMode === 'EXPLORATION' && !st.inputLocked && st.last?.reason === 'init-error' && st.last?.outcome === 'cancel' && actor && !actor.engaged && /wyczerpana/.test(toast ?? '') && restored.ruszyl;
  record('R16', 'Błąd rozpoczęcia walki: komunikat, spotkanie anulowane centralnie, stworzenie zwolnione, sterowanie wraca', ok, { komunikat: toast, stan: st, aktor: actor, walka: battleShown, sterowanie: restored });
} catch (e) { fail('R16', 'Błąd inicjalizacji', e); }

// ───────────── R18. Pościg: stworzenie samo zaczyna spotkanie przez centralną blokadę ─────────────
try {
  await freezeActors();
  await unfreezeSpawns();
  await page.waitForFunction(() => window.__szlaki.game.scene.getScene('Overworld').actors.filter((a) => !a.removed && !a.engaged).length >= 1, null, { timeout: 30000 });
  // Scenariusz w obrębie strefy stworzenia (stworzenia nie gonią gracza daleko poza swoją strefę).
  const setup = await S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const free = (x, y) => sc.isWalkable(x, y) && !sc.actorAt(x, y);
    for (const a of sc.actors.filter((x) => !x.removed && !x.engaged)) {
      const r = a.zone.rect;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w - 3; x++) {
        if (![0, 1, 2, 3].every((i) => free(x + i, y) || (x + i === a.tx && y === a.ty))) continue;
        window.__szlaki.stores.bus.emit('teleport', { x, y, facing: 'right' });
        const ax = x + 3;
        sc.tweens.killTweensOf(a.container);
        a.tx = ax; a.ty = y; a.moving = false;
        a.container.setPosition(ax * 16 + 8, (y + 1) * 16);
        a.aggressive = true; a.noticed = false; a.cooldownUntil = 0; a.nextThink = 0;
        // Pozostałe stworzenia nie gonią (izolacja scenariusza).
        for (const o of sc.actors) if (o !== a) o.aggressive = false;
        window.__enc = 0; window.__encFrom = [];
        window.__szlaki.stores.useUi.setState({ encounterCooldown: 0 });
        return { id: a.id, strefa: a.zone.id, at: [ax, y], gracz: [x, y] };
      }
    }
    return null;
  });
  if (!setup) throw new Error('brak miejsca na scenariusz pościgu');
  await idle(300);
  const p0 = await pos();
  await S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); delete sc.updateActors; });
  await page.waitForFunction(() => window.__szlaki.stores.useUi.getState().gameMode !== 'EXPLORATION', null, { timeout: 15000 });
  await waitBattle();
  const st = await ui();
  const ev = await S(() => ({ n: window.__enc, from: window.__encFrom }));
  const p1 = await pos();
  await freezeActors();
  await fightToEnd(false);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await afterBattleBackOnMap();
  const after = await ui();
  const ok = ev.n === 1 && ev.from[0] === setup.id && st.sourceEntityId === setup.id && same(p0, p1) && after.gameMode === 'EXPLORATION' && !after.inputLocked;
  record('R18', 'Pościg stworzenia: jedno spotkanie przez centralną blokadę, gracz stoi, powrót do eksploracji', ok, { ...setup, zdarzenia: ev, stanWalki: st.gameMode, zrodlo: st.sourceEntityId, gracz: [p0, p1], stanPo: after });
} catch (e) { fail('R18', 'Pościg', e); }

// ───────────── R17. Konsola ─────────────
record('R17', 'Brak błędów i ostrzeżeń w konsoli (bez komunikatów sterownika GL)', consoleIssues.length === 0, consoleIssues);
await shot('r17-end');

await browser.close();
console.log('\n=== PODSUMOWANIE TESTÓW REGRESJI ===');
for (const r of results) console.log(`${r.id.padEnd(4)} ${r.verdict.padEnd(11)} ${r.title}`);
const bad = results.filter((r) => r.verdict === 'PROBLEM' || r.verdict === 'BŁĄD TESTU');
console.log(`\nOK: ${results.filter((r) => r.verdict === 'OK').length}, INFO: ${results.filter((r) => r.verdict === 'INFO').length}, PROBLEM/BŁĄD: ${bad.length}`);
process.exitCode = bad.length ? 1 : 0;
