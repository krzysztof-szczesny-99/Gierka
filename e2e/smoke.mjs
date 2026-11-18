// Test dymny E2E na prawdziwym buildzie (Phaser + PokéAPI). Uruchamiany w GitHub Actions (workflow e2e.yml).
// Użycie: node e2e/smoke.mjs http://localhost:4173/
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const OUT = 'e2e-shots';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('▶', ...a);
const problems = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pl-PL' });
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 5).join('\n')}`));
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GL Driver Message')) problems.push(`${m.type()}: ${m.text()}`);
});
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const scene = (fn) => page.evaluate(fn);

try {
  await page.goto(BASE + '?debug');
  await page.getByRole('button', { name: 'Nowa gra' }).click();
  await page.locator('.starter-card h3').nth(2).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot('01-starter');
  // Najnowsza generacja: startery pobierane po otwarciu zakładki
  await page.locator('.gen-grid button', { hasText: 'Gen. IX' }).click();
  await page.locator('.starter-card h3', { hasText: 'Sprigatito' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot('01b-starter-gen9');
  log('startery gen. IX', JSON.stringify(await page.locator('.starter-card h3').allTextContents()));
  await page.locator('.gen-grid button', { hasText: 'Gen. V' }).first().click();
  await page.locator('.starter-card h3', { hasText: 'Snivy' }).waitFor({ timeout: 30000 });
  log('startery gen. V', JSON.stringify(await page.locator('.starter-card h3').allTextContents()));
  await page.locator('.starter-card').nth(1).click();
  log('przycisk', await page.getByRole('button', { name: /Ruszamy/ }).textContent());
  await page.getByRole('button', { name: /Ruszamy/ }).click();
  await page.locator('.dialog').waitFor({ timeout: 15000 });
  await shot('02a-intro');
  for (let i = 0; i < 8 && (await page.locator('.dialog').count()); i++) await page.locator('.dialog').click();
  log('UI', JSON.stringify(await scene(() => { const u = window.__szlaki.stores.useUi.getState(); return { mode: u.mode, modal: u.modal, dialog: !!u.dialog, learn: u.learnQueue.length, transition: u.transition }; })));
  await page.locator('canvas').waitFor({ timeout: 15000 });
  log('mapa: czekam na stworzenia');
  await page.waitForTimeout(9000);
  await shot('02-map');

  const info = await scene(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    return {
      player: [sc.tx, sc.ty],
      actors: sc.actors.map((a) => `${a.spawn.creature.name} L${a.spawn.creature.level} @${a.tx},${a.ty}${a.spawn.creature.mighty ? ' (potężny)' : ''}`),
      follower: !!sc.follower,
      zoom: sc.cameras.main.zoom,
      renderer: window.__szlaki.game.renderer.type === 2 ? 'WebGL' : 'Canvas',
    };
  });
  log('stan mapy', JSON.stringify(info));
  if (!info.actors.length) problems.push('BRAK stworzeń na mapie po 9 s');
  if (!info.follower) problems.push('BRAK towarzysza');

  // Klawiatura: 3 kroki w dół
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(650);
  await page.keyboard.up('ArrowDown');
  await page.waitForTimeout(300);
  const afterKeys = await scene(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return [sc.tx, sc.ty]; });
  log('po klawiaturze', afterKeys);
  if (afterKeys[1] <= info.player[1]) problems.push('Klawiatura: postać się nie ruszyła');

  // Pad dotykowy: przytrzymanie w prawo
  const pad = await page.locator('.dpad').boundingBox();
  await page.mouse.move(pad.x + pad.width / 2 + 45, pad.y + pad.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterPad = await scene(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return [sc.tx, sc.ty]; });
  log('po padzie', afterPad);
  if (afterPad[0] <= afterKeys[0]) problems.push('Pad: postać się nie ruszyła w prawo');

  // Dotknięcie mapy: cel 2 kafelki w dół
  const target = await scene(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const cam = sc.cameras.main;
    const tx = sc.tx, ty = sc.ty + 2;
    const sx = (tx * 16 + 8 - cam.worldView.x) * cam.zoom;
    const sy = (ty * 16 + 8 - cam.worldView.y) * cam.zoom;
    return { tx, ty, sx, sy, walk: sc.isWalkable(tx, ty) };
  });
  await page.mouse.click(target.sx, target.sy);
  await page.waitForTimeout(1200);
  const afterTap = await scene(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return [sc.tx, sc.ty]; });
  log('dotknięcie', JSON.stringify(target), '→', afterTap);
  if (target.walk && (afterTap[0] !== target.tx || afterTap[1] !== target.ty)) problems.push('Dotknięcie mapy: postać nie doszła do celu');
  await shot('03-moved');

  // Spotkanie: najbliższe stworzenie
  const started = await scene(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const a = [...sc.actors].sort((p, q) => Math.abs(p.tx - sc.tx) + Math.abs(p.ty - sc.ty) - (Math.abs(q.tx - sc.tx) + Math.abs(q.ty - sc.ty)))[0];
    if (!a) return null;
    sc.startEncounter(a);
    return a.spawn.creature.name;
  });
  log('spotkanie z', started);
  if (started) {
    await page.locator('.battle').waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    await shot('04-battle');
    let turns = 0;
    for (let i = 0; i < 400 && turns < 30; i++) {
      if (await page.getByRole('button', { name: 'Dalej' }).count()) break;
      const phase = await scene(() => window.__szlaki.stores.useBattle.getState().phase);
      if (phase === 'forcedSwitch') { await page.locator('.creature-row:not([disabled])').first().click(); continue; }
      if (phase === 'choose') {
        await page.getByRole('button', { name: 'Walcz' }).click();
        if (turns === 0) await shot('05-moves');
        const btns = page.locator('.move-btn:not([disabled])');
        const n = await btns.count();
        await btns.nth(turns % Math.max(1, n)).click();
        turns++;
        if (turns === 1) { await page.waitForTimeout(700); await shot('06-turn'); }
        continue;
      }
      await page.locator('.msgbox').click();
      await page.waitForTimeout(60);
    }
    await shot('07-battle-end');
    log('tury', turns, 'wynik', await scene(() => window.__szlaki.stores.useBattle.getState().engine?.outcome));
    await page.getByRole('button', { name: 'Dalej' }).click();
    await page.waitForTimeout(800);
    for (let i = 0; i < 8 && (await page.locator('.dialog').count()); i++) await page.locator('.dialog').click();
    if (await page.getByRole('button', { name: /Nie ucz/ }).count()) await page.getByRole('button', { name: /Nie ucz/ }).click();
    await page.waitForTimeout(1500);
    const back = await scene(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return { lock: sc.encounterLock, loop: window.__szlaki.game.loop.running, actors: sc.actors.length }; });
    log('po walce', JSON.stringify(back));
    if (back.lock || !back.loop) problems.push('Po walce mapa nie wróciła do działania');
    await shot('08-back-on-map');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowUp');
  } else {
    problems.push('Nie udało się rozpocząć spotkania');
  }

  // Tryb poziomy
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(800);
  await shot('09-landscape-map');
} catch (e) {
  problems.push('WYJĄTEK TESTU: ' + (e?.stack ?? e));
  await shot('99-failure').catch(() => {});
}

await browser.close();
console.log('\n=== PROBLEMY (' + problems.length + ') ===\n' + (problems.join('\n') || 'brak'));
fs.writeFileSync(`${OUT}/problems.txt`, problems.join('\n') || 'brak');
