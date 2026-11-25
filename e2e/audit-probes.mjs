// Sondy audytowe Sprintu 0: mierzą rzeczywiste zachowanie gry na prawdziwym buildzie (Phaser + PokéAPI).
// Nie zmieniają kodu gry; korzystają z trybu ?debug. Wynik każdej sondy: OK / PROBLEM / INFO / BŁĄD SONDY.
// Od Sprintu 1 sondy są testem regresji: każdy PROBLEM lub BŁĄD SONDY kończy skrypt kodem ≠ 0.
// (Sprint 1: pad → joystick, blokada spotkań w useUi zamiast pola sceny.)
// (Sprint 2: zwykłe stworzenia nie chodzą po mapie — spotkania w sondach powstają w wysokiej trawie
//  z kontrolowanym źródłem rzutu; poza tymi momentami rzut zawsze chybia, żeby ruch w sondach nie wywoływał walk.)
// Użycie: node e2e/audit-probes.mjs http://localhost:4173/
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const results = [];
const consoleIssues = [];
const api = [];
let phase = 'start';

const record = (id, title, verdict, data) => {
  results.push({ id, title, verdict, data });
  console.log(`AUDIT ${id} [${verdict}] ${title} :: ${JSON.stringify(data)}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pl-PL' });
const page = await ctx.newPage();
page.on('pageerror', (e) => consoleIssues.push({ phase, type: 'pageerror', text: e.message }));
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GL Driver Message')) consoleIssues.push({ phase, type: m.type(), text: m.text().slice(0, 300) });
});
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('pokeapi.co/api/')) api.push({ url: u.replace('https://pokeapi.co/api/v2/', ''), phase });
});

const S = (fn, arg) => page.evaluate(fn, arg);
const idle = (ms) => page.waitForTimeout(ms);
const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const pos = () => S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return [sc.tx, sc.ty]; });
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

async function closeDialogs() {
  for (let i = 0; i < 12; i++) {
    if (!(await page.locator('.dialog').count())) break;
    await page.locator('.dialog').click();
    await idle(60);
  }
  const skipLearn = page.getByRole('button', { name: /Nie ucz/ });
  if (await skipLearn.count()) await skipLearn.click();
}
async function waitHud() { await page.locator('.joystick').waitFor({ timeout: 15000 }); }
async function waitActors(n) {
  await page.waitForFunction((n) => { const sc = window.__szlaki?.game?.scene?.getScene('Overworld'); return !!sc && Array.isArray(sc.actors) && sc.actors.filter((a) => !a.removed).length >= n; }, n, { timeout: 30000 });
}
function freeDir() {
  return S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    let best = 'down', bestN = -1;
    for (const [k, [dx, dy]] of Object.entries(D)) {
      let n = 0;
      for (let i = 1; i <= 6; i++) { const x = sc.tx + dx * i, y = sc.ty + dy * i; if (sc.isWalkable(x, y) && !(sc.actorAt(x, y) || sc.trainerSightAt(x, y)) && !sc.exitAt(x, y)) n++; else break; }
      if (n > bestN) { bestN = n; best = k; }
    }
    return best;
  });
}
async function dpadPoint(dir) {
  const b = await page.locator('.joystick').boundingBox();
  const o = { up: [0, -45], down: [0, 45], left: [-45, 0], right: [45, 0] }[dir];
  return [b.x + b.width / 2 + o[0], b.y + b.height / 2 + o[1]];
}
/** Źródło rzutu na spotkanie: 'hit' (zawsze trafienie) albo 'miss' (nigdy). */
const stepRng = (mode) => S((mode) => { const E = window.__szlaki.encounter; E.configure({ stepRng: E.createSequenceRng([mode === 'hit' ? 0 : 0.999]) }); }, mode);
/** Spotkanie w wysokiej trawie: teleport obok trawy, kontrolowane trafienie, krok joystickiem. */
async function grassEncounter() {
  await page.waitForFunction(() => window.__szlaki.stores.useUi.getState().gameMode === 'EXPLORATION', null, { timeout: 15000 });
  await stepRng('hit');
  const t = await S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const D = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
    for (let y = 1; y < sc.grid.length - 1; y++) for (let x = 1; x < sc.grid[0].length - 1; x++) {
      if (!sc.isWalkable(x, y) || (sc.actorAt(x, y) || sc.trainerSightAt(x, y))) continue;
      for (const [d, [dx, dy]] of Object.entries(D)) {
        if (sc.grid[y + dy]?.[x + dx] === ',' && !(sc.actorAt(x + dx, y + dy) || sc.trainerSightAt(x + dx, y + dy))) {
          window.__szlaki.stores.bus.emit('teleport', { x, y, facing: d });
          return { dir: d, from: [x, y] };
        }
      }
    }
    return null;
  });
  if (!t) throw new Error('brak wysokiej trawy');
  await idle(300);
  await S(() => window.__szlaki.stores.useUi.setState({ encounterCooldown: 0, encounterStepProgress: 0 }));
  const [x, y] = await dpadPoint(t.dir);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await idle(450);
  const st = await S(() => window.__szlaki.stores.useUi.getState().gameMode);
  await page.mouse.up();
  await page.locator('.battle').waitFor({ timeout: 20000 });
  await stepRng('miss');
  return { ...t, stanPoKroku: st };
}
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
const stats = () => S(() => { const g = window.__szlaki.stores.useGame.getState(); return { won: g.stats.battlesWon, caught: g.stats.caught, fled: g.stats.fled, blackouts: g.stats.blackouts, encounters: g.stats.encounters, money: g.player.money, party: g.party.length, storage: g.storage.length }; });

// ───────────── 0. start nowej gry + zakładki generacji ─────────────
try {
  phase = 'starter';
  await page.goto(BASE + '?debug');
  await page.getByRole('button', { name: 'Nowa gra' }).click();
  await page.locator('.starter-card h3').nth(2).waitFor({ timeout: 30000 });
  for (const g of ['Gen. IX', 'Gen. I', 'Gen. IX', 'Gen. I']) {
    await page.locator('.gen-grid button', { hasText: g }).first().click();
    await page.locator('.starter-card h3').nth(2).waitFor({ timeout: 30000 });
  }
  await page.locator('.starter-card').first().click();
  await page.getByRole('button', { name: /Ruszamy/ }).click();
  await page.locator('.dialog').waitFor({ timeout: 15000 });
  await closeDialogs();
  await waitHud();
  phase = 'spawn';
  await waitActors(1);
  await stepRng('miss');
  record('S0', 'Start gry: na mapie tylko nieruchome spotkanie specjalne, towarzysz', 'INFO', await S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { player: [sc.tx, sc.ty], actors: sc.actors.map((a) => a.id), follower: !!sc.follower }; }));
} catch (e) {
  record('S0', 'Start gry', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 1. Zapytania API przy ponownym otwieraniu ekranów ─────────────
try {
  const openClose = async () => {
    for (const name of ['Drużyna', 'Torba', 'Atlas']) {
      await page.locator('.hud-menu button', { hasText: name }).click();
      await page.locator('.modal').waitFor();
      if (name === 'Drużyna') { await page.locator('.creature-row').first().click(); await idle(500); }
      await idle(400);
      await page.locator('.modal-close').click();
    }
    await page.locator('.hud-menu button', { hasText: 'Dziennik' }).click();
    await idle(300);
    await page.locator('.modal-close').click();
  };
  // Od Sprintu 2 nie ma odradzania stworzeń — pomiar dotyczy wyłącznie zapytań menu.
  await idle(2500);
  phase = 'menus-1';
  await openClose();
  phase = 'menus-2';
  await openClose();
  const spawnsDuringModal = await S(() => typeof window.__szlaki.game.scene.getScene('Overworld').maintainSpawns === 'undefined');
  const first = api.filter((r) => r.phase === 'menus-1').map((r) => r.url);
  const second = api.filter((r) => r.phase === 'menus-2').map((r) => r.url);
  record('P1', 'Ponowne otwarcie Drużyny/Torby/Atlasu/Dziennika nie wysyła zapytań do PokéAPI', second.length === 0 ? 'OK' : 'PROBLEM', { pierwszeOtwarcie: first, drugieOtwarcie: second, brakOdradzania: spawnsDuringModal });
} catch (e) {
  record('P1', 'Zapytania przy menu', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 1b. Brak odradzania i ruchu stworzeń (także przy otwartym oknie) ─────────────
try {
  phase = 'modal-spawn';
  const snap = () => S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return sc.actors.map((a) => `${a.id}@${a.tx},${a.ty}`); });
  const before = await snap();
  await page.locator('.hud-menu button', { hasText: 'Atlas' }).click();
  await page.locator('.modal').waitFor();
  await idle(6000);
  const during = await snap();
  await page.locator('.modal-close').click();
  record('P15', 'Stworzenia nie pojawiają się ani nie poruszają (6 s z otwartym oknem)', JSON.stringify(before) === JSON.stringify(during) ? 'OK' : 'PROBLEM', { przed: before, po6s: during });
} catch (e) {
  record('P15', 'Brak odradzania', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 2. Chodzenie: zapytania na krok ─────────────
try {
  phase = 'walk';
  const p0 = await pos();
  for (let i = 0; i < 4; i++) {
    const d = await freeDir();
    await page.keyboard.down(KEYS[d]);
    await idle(700);
    await page.keyboard.up(KEYS[d]);
  }
  const p1 = await pos();
  const steps = await S(() => window.__szlaki.stores.useGame.getState().player.steps);
  const walkReq = api.filter((r) => r.phase === 'walk').map((r) => r.url);
  record('P2', 'Chodzenie nie wysyła zapytań na każdy krok (dopuszczalne: dane nowo pojawiających się gatunków)', 'INFO', { od: p0, do: p1, krokiWZapisie: steps, zapytaniaPodczasChodzenia: walkReq });
} catch (e) {
  record('P2', 'Chodzenie', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 3. Pad: pointercancel ─────────────
try {
  phase = 'pointercancel';
  await waitHud();
  const d = await freeDir();
  const [x, y] = await dpadPoint(d);
  const start = await pos();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await idle(450);
  const moving = await pos();
  await S(() => document.querySelector('.joystick').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true, pointerType: 'mouse' })));
  await idle(350);
  const a = await pos();
  await idle(900);
  const b = await pos();
  await page.mouse.up();
  record('P3', 'Pad: pointercancel zatrzymuje ruch', !same(start, moving) && same(a, b) ? 'OK' : 'PROBLEM', { kierunek: d, start, wTrakcie: moving, poCancel: a, po900ms: b });
} catch (e) {
  record('P3', 'Pad: pointercancel', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 5. Zmiana orientacji podczas trzymania pada ─────────────
try {
  phase = 'orientation';
  await waitHud();
  const d = await freeDir();
  const [x, y] = await dpadPoint(d);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await idle(300);
  await page.setViewportSize({ width: 844, height: 390 });
  await idle(700);
  const cam = await S(() => { const c = window.__szlaki.game.scene.getScene('Overworld').cameras.main; return { w: c.width, h: c.height, zoom: c.zoom }; });
  await page.mouse.up();
  await idle(400);
  const a = await pos();
  await idle(900);
  const b = await pos();
  await page.setViewportSize({ width: 390, height: 844 });
  await idle(700);
  const cam2 = await S(() => { const c = window.__szlaki.game.scene.getScene('Overworld').cameras.main; return { w: c.width, h: c.height, zoom: c.zoom }; });
  const okCam = cam.w === 844 && cam.h === 390 && cam2.w === 390 && cam2.h === 844;
  record('P5', 'Obrót ekranu: kamera dopasowana, ruch zatrzymuje się po puszczeniu pada', okCam && same(a, b) ? 'OK' : 'PROBLEM', { kierunek: d, kameraPoziomo: cam, kameraPionowo: cam2, poPuszczeniu: a, po900ms: b });
} catch (e) {
  record('P5', 'Orientacja', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 5b. Rozmiar kamery w czasie po obrocie (bez wejścia) ─────────────
try {
  phase = 'orientation-2';
  const snap = () => S(() => { const g = window.__szlaki.game; const c = g.scene.getScene('Overworld').cameras.main; const r = document.querySelector('.phaser-root').getBoundingClientRect(); const sm = g.scale; return { kamera: [c.width, c.height], zoom: c.zoom, gra: [sm.width, sm.height], rodzic: [Math.round(r.width), Math.round(r.height)], parentSize: [sm.parentSize.width, sm.parentSize.height], dirty: sm.dirty, lastCheck: Math.round(sm._lastCheck), resizeInterval: sm.resizeInterval, delta: g.loop.delta, rawDelta: g.loop.rawDelta, frame: g.loop.frame, running: g.loop.running, parentIsWindow: sm.parentIsWindow, parentTag: sm.parent && sm.parent.className, okno: [innerWidth, innerHeight] }; });
  const series = [];
  await page.setViewportSize({ width: 844, height: 390 });
  for (const t of [100, 400, 900, 1600]) { await idle(t - (series.length ? [100, 400, 900, 1600][series.length - 1] : 0)); series.push({ t, ...(await snap()) }); }
  await page.setViewportSize({ width: 390, height: 844 });
  await idle(1600);
  series.push({ t: 'pion+1600', ...(await snap()) });
  const last = series[3];
  const ok = last.kamera[0] === 844 && last.kamera[1] === 390 && series[4].kamera[0] === 390 && series[4].kamera[1] === 844;
  record('P5b', 'Rozmiar kamery po obrocie (pomiar w czasie, bez trzymania pada)', ok ? 'OK' : 'PROBLEM', series);
} catch (e) {
  record('P5b', 'Kamera po obrocie', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 4. Utrata fokusu (blur) ─────────────
try {
  phase = 'blur';
  await waitHud();
  let d = await freeDir();
  let [x, y] = await dpadPoint(d);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await idle(400);
  await S(() => { window.dispatchEvent(new Event('blur')); });
  await idle(350);
  const a = await pos();
  await idle(900);
  const b = await pos();
  await page.mouse.up();
  record('P4a', 'Pad: utrata fokusu okna (blur) zatrzymuje ruch', same(a, b) ? 'OK' : 'PROBLEM', { kierunek: d, poBlur: a, po900ms: b });

  await idle(400);
  d = await freeDir();
  await page.keyboard.down(KEYS[d]);
  await idle(400);
  await S(() => { window.dispatchEvent(new Event('blur')); });
  await idle(350);
  const c = await pos();
  await idle(900);
  const e2 = await pos();
  await page.keyboard.up(KEYS[d]);
  record('P4b', 'Klawiatura: utrata fokusu okna (blur) zatrzymuje ruch', same(c, e2) ? 'OK' : 'PROBLEM', { kierunek: d, poBlur: c, po900ms: e2 });
  await S(() => window.dispatchEvent(new Event('focus'))); // przywrócenie fokusu po sondzie
} catch (e) {
  record('P4', 'Blur', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 5c. Obrót po utracie fokusu bez jego przywrócenia, potem po „focus” ─────────────
try {
  phase = 'orientation-blur';
  const snap = () => S(() => { const g = window.__szlaki.game; const c = g.scene.getScene('Overworld').cameras.main; const r = document.querySelector('.phaser-root').getBoundingClientRect(); return { kamera: [c.width, c.height], gra: [g.scale.width, g.scale.height], rodzic: [Math.round(r.width), Math.round(r.height)], okno: [innerWidth, innerHeight], focus: g.loop.inFocus, hasFocus: g.hasFocus }; });
  await S(() => window.dispatchEvent(new Event('blur')));
  await page.setViewportSize({ width: 844, height: 390 });
  await idle(1200);
  const poBlur = await snap();
  await S(() => window.dispatchEvent(new Event('focus')));
  await idle(1200);
  const poFocus = await snap();
  await page.setViewportSize({ width: 390, height: 844 });
  await idle(1200);
  const pion = await snap();
  record('P5c', 'Obrót ekranu po utracie fokusu (bez „focus”), a następnie po przywróceniu fokusu', 'INFO', { poBlur, poFocus, pion });
} catch (e) {
  record('P5c', 'Obrót po blur', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 6. Blokada spotkań: dwa triggery naraz, ruch w przejściu, obce zdarzenie ─────────────
let firstBattleOk = false;
try {
  phase = 'lock';
  await waitHud();
  await S(() => { window.__enc = 0; window.__szlaki.stores.bus.on('encounter', () => { window.__enc += 1; }); });
  const g = await grassEncounter();
  const before = g.from.map((v, i) => v + (i === 0 ? { right: 1, left: -1 }[g.dir] ?? 0 : { down: 1, up: -1 }[g.dir] ?? 0));
  const started = await S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const E = window.__szlaki.encounter;
    const zone = sc.mapDef.zones.find((z) => z.id === 'meadow');
    const again = window.__szlaki.stores.useUi.getState().registerEncounterStep({ movedToNewTile: true, zone }, E.createSequenceRng([0])); // drugi trigger
    const u = window.__szlaki.stores.useUi.getState();
    return { drugiTrigger: { rzut: again.decision.rolled, spotkanie: again.encounterId }, lock: u.activeEncounterId, gameMode: u.gameMode, encounters: window.__enc };
  });
  record('P6a', 'Dwa triggery (krok w trawie + kolejny krok) uruchamiają tylko jedno spotkanie', started.encounters === 1 && started.drugiTrigger.spotkanie === null ? 'OK' : 'PROBLEM', { ...g, ...started });

  await page.keyboard.down('ArrowLeft');
  await idle(600);
  await page.keyboard.up('ArrowLeft');
  const during = await pos();
  record('P6b', 'Gracz nie porusza się podczas walki', same(before, during) ? 'OK' : 'PROBLEM', { poKroku: before, wWalce: during });

  const foreign = await S(() => {
    const st = window.__szlaki.stores;
    const ui = st.useUi.getState();
    const ctxState = { mode: ui.mode, lockPrzed: ui.activeEncounterId };
    st.bus.emit('encounter', { encounterId: 'enc-obce', source: { kind: 'step', locationId: 'x', zoneId: 'meadow', zoneName: 'Łąka', terrainType: 'TALL_GRASS', encounterTableId: 'meadow' } });
    const after = st.useUi.getState();
    return { ...ctxState, lockPoObcymZdarzeniu: after.activeEncounterId, tenSam: after.activeEncounterId === ctxState.lockPrzed, walkaTrwa: after.mode === 'battle' };
  });
  record('P6c', 'Obce zdarzenie spotkania nie zwalnia ani nie zmienia blokady trwającego spotkania', foreign.lockPoObcymZdarzeniu && foreign.tenSam ? 'OK' : 'PROBLEM', foreign);

  await idle(1500);
  const enc2 = await S(() => window.__enc);
  record('P6d', 'Brak ponownego wyzwolenia w kolejnych klatkach', 'INFO', { zdarzeniaEncounterLacznie: enc2, uwaga: 'w tym 1 sztuczne zdarzenie z sondy P6c' });
  firstBattleOk = await fightToEnd(false);
} catch (e) {
  record('P6', 'Blokada spotkań', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 7. Podwójne „Dalej” (koniec walki z nauką ruchu) ─────────────
try {
  phase = 'double-finish';
  if (!firstBattleOk) throw new Error('walka z sondy P6 nie dobiegła końca');
  const outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome);
  const before = await stats();
  // Spowolnienie pobierania ruchu i wstrzyknięcie oczekującej nauki ruchu (jak po awansie z nowym ruchem).
  await page.route('**/api/v2/move/**', async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
  await S(() => {
    const B = window.__szlaki.stores.useBattle;
    const s = B.getState();
    const lead = s.engine.sides[0].party[s.engine.sides[0].active[0]];
    B.setState({ engine: { ...s.engine, pendingLearns: [{ uid: lead.uid, move: 'hyper-voice' }] } });
  });
  await S(() => { const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Dalej'); btn.click(); btn.click(); });
  await idle(4000);
  await page.unroute('**/api/v2/move/**');
  await closeDialogs();
  const after = await stats();
  const key = { win: 'won', caught: 'caught', fled: 'fled', lose: 'blackouts' }[outcome];
  const delta = after[key] - before[key];
  record('P7', 'Podwójne dotknięcie „Dalej” nie dubluje nagród', delta === 1 ? 'OK' : 'PROBLEM', { wynikWalki: outcome, licznik: key, przyrost: delta, przed: before, po: after });
} catch (e) {
  record('P7', 'Podwójne „Dalej”', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 8. Ucieczka i powrót na mapę ─────────────
try {
  phase = 'flee';
  await waitHud();
  const e = await grassEncounter();
  let outcome = null;
  for (let i = 0; i < 300 && !outcome; i++) {
    if (await page.getByRole('button', { name: 'Dalej' }).count()) { outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome); break; }
    const ph = await S(() => window.__szlaki.stores.useBattle.getState().phase);
    if (ph === 'choose') await page.getByRole('button', { name: 'Ucieczka' }).click();
    else if (ph === 'forcedSwitch') await page.locator('.creature-row:not([disabled])').first().click();
    else { await S(() => window.__szlaki.stores.useBattle.getState().skip()); await idle(40); }
  }
  await page.getByRole('button', { name: 'Dalej' }).click();
  await idle(400);
  await closeDialogs();
  await stepRng('hit'); // nawet przy pewnym trafieniu stanie w miejscu nie może wywołać spotkania
  await S(() => { window.__enc = 0; });
  await idle(2500);
  const st = await S(() => {
    const u = window.__szlaki.stores.useUi.getState();
    return { odnowienieKroki: u.encounterCooldown, lock: u.inputLocked || u.gameMode !== 'EXPLORATION', petlaDziala: window.__szlaki.game.loop.running, noweSpotkaniaW2_5s: window.__enc };
  });
  await stepRng('miss');
  const ok = outcome !== 'fled' || (st.odnowienieKroki === 3 && !st.lock && st.petlaDziala && st.noweSpotkaniaW2_5s === 0);
  record('P8', 'Ucieczka: powrót na mapę, odnowienie 3 kroki, brak spotkania bez ruchu', ok ? 'OK' : 'PROBLEM', { krok: e, wynik: outcome, ...st });
} catch (e) {
  record('P8', 'Ucieczka', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 9. Przegrana → Stacja Opieki ─────────────
try {
  phase = 'lose';
  await waitHud();
  const before = await stats();
  await S(() => window.__szlaki.stores.useGame.setState((s) => ({ party: s.party.map((c) => ({ ...c, hp: 1 })) })));
  const e = await grassEncounter();
  await fightToEnd(true);
  const outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await idle(500);
  await closeDialogs();
  await idle(500);
  const after = await stats();
  const st = await S(() => {
    const g = window.__szlaki.stores.useGame.getState();
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    return { pozycjaZapisu: [g.player.x, g.player.y], pozycjaSceny: [sc.tx, sc.ty], hp: g.party.map((c) => `${c.hp}/${c.stats.hp}`) };
  });
  const ok = outcome !== 'lose' || (after.blackouts - before.blackouts === 1 && st.pozycjaZapisu[0] === 5 && st.pozycjaZapisu[1] === 6 && same(st.pozycjaSceny, st.pozycjaZapisu));
  record('P9', 'Przegrana: leczenie, powrót do Stacji Opieki', ok ? (outcome === 'lose' ? 'OK' : 'INFO') : 'PROBLEM', { krok: e, wynik: outcome, ...st, blackoutsPrzyrost: after.blackouts - before.blackouts });
} catch (e) {
  record('P9', 'Przegrana', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 10. Zapis i wczytanie ─────────────
try {
  phase = 'reload';
  await idle(3000);
  const snap = await S(() => { const g = window.__szlaki.stores.useGame.getState(); return { pos: [g.player.x, g.player.y], party: g.party.map((c) => c.uid), money: g.player.money, dex: Object.keys(g.dex).length }; });
  await page.reload();
  await page.getByRole('button', { name: /Kontynuuj/ }).click({ timeout: 15000 });
  await waitHud();
  await idle(800);
  const after = await S(() => { const g = window.__szlaki.stores.useGame.getState(); const sc = window.__szlaki.game.scene.getScene('Overworld'); return { pos: [g.player.x, g.player.y], scena: [sc.tx, sc.ty], party: g.party.map((c) => c.uid), money: g.player.money, dex: Object.keys(g.dex).length }; });
  const ok = same(snap.pos, after.pos) && same(after.pos, after.scena) && JSON.stringify(snap.party) === JSON.stringify(after.party) && snap.money === after.money && snap.dex === after.dex;
  record('P10', 'Zapis w IndexedDB przetrwa przeładowanie', ok ? 'OK' : 'PROBLEM', { przed: snap, po: after });
} catch (e) {
  record('P10', 'Zapis/wczytanie', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 11. Tryb offline (service worker + bufor) ─────────────
try {
  phase = 'offline';
  const sw = await S(async () => {
    if (!('serviceWorker' in navigator)) return { api: false };
    const r = await Promise.race([navigator.serviceWorker.ready.then(() => 'ready'), new Promise((res) => setTimeout(() => res('timeout'), 10000))]);
    return { api: true, ready: r, kontroluje: !!navigator.serviceWorker.controller };
  });
  await ctx.setOffline(true);
  await page.reload();
  const title = await page.getByRole('button', { name: /Kontynuuj/ }).waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  let map = null;
  if (title) {
    await page.getByRole('button', { name: /Kontynuuj/ }).click();
    await waitHud();
    await idle(4000);
    map = await S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { towarzysz: !!sc.follower, online: navigator.onLine }; });
    // Spotkanie w trawie offline: losowane wyłącznie gatunki z bufora (spotkane wcześniej w sondach).
    const g = await grassEncounter();
    map.spotkanieOffline = { ...g, przeciwnik: await S(() => window.__szlaki.stores.useBattle.getState().engine.sides[1].party[0].pokemon) };
    for (let i = 0; i < 300; i++) {
      if (await page.getByRole('button', { name: 'Dalej' }).count()) break;
      const ph = await S(() => window.__szlaki.stores.useBattle.getState().phase);
      if (ph === 'choose') await page.getByRole('button', { name: 'Ucieczka' }).click();
      else if (ph === 'forcedSwitch') await page.locator('.creature-row:not([disabled])').first().click();
      else { await S(() => window.__szlaki.stores.useBattle.getState().skip()); await idle(40); }
    }
    await page.getByRole('button', { name: 'Dalej' }).click();
    await closeDialogs();
    map.powrot = await S(() => window.__szlaki.stores.useUi.getState().gameMode);
  }
  await ctx.setOffline(false);
  record('P11', 'Offline po pierwszym uruchomieniu: start, wczytanie, towarzysz, spotkanie w trawie z bufora', title && map && map.towarzysz && map.spotkanieOffline && map.powrot === 'EXPLORATION' ? 'OK' : 'PROBLEM', { serviceWorker: sw, ekranTytulowy: title, mapa: map });
} catch (e) {
  await ctx.setOffline(false).catch(() => {});
  record('P11', 'Offline', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 12. Podsumowanie zapytań i konsoli ─────────────
const counts = {};
for (const r of api) counts[r.url] = (counts[r.url] ?? 0) + 1;
const dup = Object.entries(counts).filter(([, n]) => n > 1);
record('P12', 'Każdy zasób PokéAPI pobrany najwyżej raz (bufor działa)', dup.length ? 'PROBLEM' : 'OK', { zapytaniaLacznie: api.length, unikalne: Object.keys(counts).length, powtorzone: dup });
const perPhase = {};
for (const r of api) perPhase[r.phase] = (perPhase[r.phase] ?? 0) + 1;
record('P13', 'Zapytania PokéAPI wg etapu sondy', 'INFO', perPhase);
record('P14', 'Błędy i ostrzeżenia konsoli (bez komunikatów sterownika GL)', consoleIssues.length ? 'PROBLEM' : 'OK', consoleIssues);

await browser.close();
console.log('\n=== PODSUMOWANIE SOND ===');
for (const r of results) console.log(`${r.id.padEnd(4)} ${r.verdict.padEnd(10)} ${r.title}`);
const bad = results.filter((r) => r.verdict === 'PROBLEM' || r.verdict === 'BŁĄD SONDY');
process.exitCode = bad.length ? 1 : 0;
