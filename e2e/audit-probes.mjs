// Sondy audytowe Sprintu 0: mierzą rzeczywiste zachowanie gry na prawdziwym buildzie (Phaser + PokéAPI).
// Nie zmieniają kodu gry; korzystają z trybu ?debug. Wynik każdej sondy: OK / PROBLEM / INFO / BŁĄD SONDY.
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
async function waitHud() { await page.locator('.dpad').waitFor({ timeout: 15000 }); }
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
      for (let i = 1; i <= 6; i++) { const x = sc.tx + dx * i, y = sc.ty + dy * i; if (sc.isWalkable(x, y) && !sc.actorAt(x, y)) n++; else break; }
      if (n > bestN) { bestN = n; best = k; }
    }
    return best;
  });
}
async function dpadPoint(dir) {
  const b = await page.locator('.dpad').boundingBox();
  const o = { up: [0, -45], down: [0, 45], left: [-45, 0], right: [45, 0] }[dir];
  return [b.x + b.width / 2 + o[0], b.y + b.height / 2 + o[1]];
}
async function startNearestEncounter() {
  return S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const d = (a) => Math.abs(a.tx - sc.tx) + Math.abs(a.ty - sc.ty);
    const a = [...sc.actors].filter((x) => !x.removed && !x.engaged).sort((p, q) => d(p) - d(q))[0];
    if (!a) return null;
    sc.startEncounter(a);
    return { id: a.id, name: a.spawn.creature.name, level: a.spawn.creature.level };
  });
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
  await waitActors(4);
  record('S0', 'Start gry i pojawienie się stworzeń', 'INFO', await S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { player: [sc.tx, sc.ty], actors: sc.actors.length, follower: !!sc.follower }; }));
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
  phase = 'menus-1';
  await openClose();
  phase = 'menus-2';
  await openClose();
  const first = api.filter((r) => r.phase === 'menus-1').map((r) => r.url);
  const second = api.filter((r) => r.phase === 'menus-2').map((r) => r.url);
  record('P1', 'Ponowne otwarcie Drużyny/Torby/Atlasu/Dziennika nie wysyła zapytań do PokéAPI', second.length === 0 ? 'OK' : 'PROBLEM', { pierwszeOtwarcie: first, drugieOtwarcie: second });
} catch (e) {
  record('P1', 'Zapytania przy menu', 'BŁĄD SONDY', String(e).slice(0, 300));
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
  await S(() => document.querySelector('.dpad').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true, pointerType: 'mouse' })));
  await idle(350);
  const a = await pos();
  await idle(900);
  const b = await pos();
  await page.mouse.up();
  record('P3', 'Pad: pointercancel zatrzymuje ruch', !same(start, moving) && same(a, b) ? 'OK' : 'PROBLEM', { kierunek: d, start, wTrakcie: moving, poCancel: a, po900ms: b });
} catch (e) {
  record('P3', 'Pad: pointercancel', 'BŁĄD SONDY', String(e).slice(0, 300));
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
} catch (e) {
  record('P4', 'Blur', 'BŁĄD SONDY', String(e).slice(0, 300));
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

// ───────────── 6. Blokada spotkań: dwa stworzenia naraz, ruch w przejściu, obce anulowanie ─────────────
let firstBattleOk = false;
try {
  phase = 'lock';
  await waitHud();
  await waitActors(2);
  await S(() => { window.__enc = 0; window.__szlaki.stores.bus.on('encounter', () => { window.__enc += 1; }); });
  const before = await pos();
  const started = await S(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const dist = (a) => Math.abs(a.tx - sc.tx) + Math.abs(a.ty - sc.ty);
    const [a1, a2] = [...sc.actors].filter((a) => !a.removed).sort((p, q) => dist(p) - dist(q));
    sc.startEncounter(a1);
    sc.startEncounter(a2); // ta sama klatka
    const u = window.__szlaki.stores.useUi.getState();
    return { a1: a1.id, a2: a2.id, lock: sc.encounterLock, transition: u.transition, encounters: window.__enc };
  });
  record('P6a', 'Dwa stworzenia w tej samej klatce uruchamiają tylko jedno spotkanie', started.encounters === 1 ? 'OK' : 'PROBLEM', started);

  await page.keyboard.down('ArrowLeft');
  await idle(600);
  await page.keyboard.up('ArrowLeft');
  const during = await pos();
  record('P6b', 'Gracz nie porusza się podczas przejścia do walki', same(before, during) ? 'OK' : 'PROBLEM', { przed: before, wPrzejsciu: during });

  const foreign = await S((a2) => {
    const st = window.__szlaki.stores;
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const other = sc.actors.find((a) => a.id === a2);
    const ui = st.useUi.getState();
    const ctxState = { mode: ui.mode, transition: ui.transition, lockPrzed: sc.encounterLock };
    if (other) st.bus.emit('encounter', { actorId: other.id, spawn: other.spawn });
    return { ...ctxState, lockPoObcymAnulowaniu: sc.encounterLock, pierwszaWalkaNadalTrwa: st.useUi.getState().transition || st.useUi.getState().mode === 'battle' };
  }, started.a2);
  record('P6c', 'Anulowanie innego spotkania nie zwalnia blokady trwającego spotkania', foreign.lockPoObcymAnulowaniu ? 'OK' : 'PROBLEM', foreign);

  await page.locator('.battle').waitFor({ timeout: 20000 });
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
  await waitActors(1);
  await S(() => { window.__enc = 0; });
  const e = await startNearestEncounter();
  await page.locator('.battle').waitFor({ timeout: 20000 });
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
  await S(() => { window.__enc = 0; });
  await idle(2500);
  const st = await S((id) => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const a = sc.actors.find((x) => x.id === id);
    return { aktorIstnieje: !!a, engaged: a?.engaged, aggressive: a?.aggressive, cooldownMs: a ? Math.round(a.cooldownUntil - sc.time.now) : null, lock: sc.encounterLock, petlaDziala: window.__szlaki.game.loop.running, noweSpotkaniaW2_5s: window.__enc };
  }, e?.id);
  const ok = outcome !== 'fled' || (st.aktorIstnieje && !st.engaged && !st.lock && st.petlaDziala && st.noweSpotkaniaW2_5s === 0);
  record('P8', 'Ucieczka: powrót na mapę, stworzenie zostaje z odnowieniem, brak natychmiastowego ponownego spotkania', ok ? 'OK' : 'PROBLEM', { przeciwnik: e, wynik: outcome, ...st });
} catch (e) {
  record('P8', 'Ucieczka', 'BŁĄD SONDY', String(e).slice(0, 300));
}

// ───────────── 9. Przegrana → Stacja Opieki ─────────────
try {
  phase = 'lose';
  await waitHud();
  await waitActors(1);
  const before = await stats();
  await S(() => window.__szlaki.stores.useGame.setState((s) => ({ party: s.party.map((c) => ({ ...c, hp: 1 })) })));
  const e = await startNearestEncounter();
  await page.locator('.battle').waitFor({ timeout: 20000 });
  await fightToEnd(true);
  const outcome = await S(() => window.__szlaki.stores.useBattle.getState().engine.outcome);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await idle(500);
  await closeDialogs();
  await idle(500);
  const after = await stats();
  const st = await S((id) => {
    const g = window.__szlaki.stores.useGame.getState();
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    return { pozycjaZapisu: [g.player.x, g.player.y], pozycjaSceny: [sc.tx, sc.ty], hp: g.party.map((c) => `${c.hp}/${c.stats.hp}`), aktorUsuniety: !sc.actors.some((a) => a.id === id) };
  }, e?.id);
  const ok = outcome !== 'lose' || (after.blackouts - before.blackouts === 1 && st.pozycjaZapisu[0] === 5 && st.pozycjaZapisu[1] === 6 && same(st.pozycjaSceny, st.pozycjaZapisu) && st.aktorUsuniety);
  record('P9', 'Przegrana: leczenie, powrót do Stacji Opieki, usunięcie stworzenia', ok ? (outcome === 'lose' ? 'OK' : 'INFO') : 'PROBLEM', { przeciwnik: e, wynik: outcome, ...st, blackoutsPrzyrost: after.blackouts - before.blackouts });
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
    await idle(7000);
    map = await S(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { stworzenia: sc.actors.length, towarzysz: !!sc.follower, online: navigator.onLine }; });
  }
  await ctx.setOffline(false);
  record('P11', 'Offline po pierwszym uruchomieniu: start, wczytanie, stworzenia z bufora', title && map && map.stworzenia > 0 ? 'OK' : 'PROBLEM', { serviceWorker: sw, ekranTytulowy: title, mapa: map });
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
