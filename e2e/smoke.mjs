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

  // Joystick ekranowy: przytrzymanie w prawo
  const joy = await page.locator('.joystick').boundingBox();
  await page.mouse.move(joy.x + joy.width / 2 + 45, joy.y + joy.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterPad = await scene(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return [sc.tx, sc.ty]; });
  log('po joysticku', afterPad);
  if (afterPad[0] <= afterKeys[0]) problems.push('Joystick: postać się nie ruszyła w prawo');

  // Dotknięcie mapy: tap-to-move jest wyłączony — postać zostaje na miejscu
  const target = await scene(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    const cam = sc.cameras.main;
    const tx = sc.tx, ty = sc.ty + 2;
    const sx = (tx * 16 + 8 - cam.worldView.x) * cam.zoom;
    const sy = (ty * 16 + 8 - cam.worldView.y) * cam.zoom;
    return { tx, ty, sx, sy };
  });
  await page.mouse.click(target.sx, target.sy);
  await page.waitForTimeout(1200);
  const afterTap = await scene(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); return [sc.tx, sc.ty]; });
  log('dotknięcie', JSON.stringify(target), '→', afterTap);
  if (afterTap[0] !== afterPad[0] || afterTap[1] !== afterPad[1]) problems.push('Dotknięcie mapy poruszyło postać (tap-to-move powinien być wyłączony)');
  await shot('03-moved');

  // Spotkanie: realny kontakt — stworzenie obok gracza, gracz wchodzi w nie joystickiem
  const started = await scene(() => {
    const sc = window.__szlaki.game.scene.getScene('Overworld');
    sc.updateActors = () => {}; // na czas ustawienia scenariusza stworzenia stoją
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
        return { name: a.spawn.creature.name, dir: d };
      }
    }
    return null;
  });
  log('spotkanie z', JSON.stringify(started));
  if (started) {
    const off = { up: [0, -45], down: [0, 45], left: [-45, 0], right: [45, 0] }[started.dir];
    const jb = await page.locator('.joystick').boundingBox();
    await page.mouse.move(jb.x + jb.width / 2 + off[0], jb.y + jb.height / 2 + off[1]);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.up();
    await scene(() => { delete window.__szlaki.game.scene.getScene('Overworld').updateActors; });
  }
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
    const back = await scene(() => { const sc = window.__szlaki.game.scene.getScene('Overworld'); const u = window.__szlaki.stores.useUi.getState(); return { gameMode: u.gameMode, inputLocked: u.inputLocked, loop: window.__szlaki.game.loop.running, actors: sc.actors.length }; });
    log('po walce', JSON.stringify(back));
    if (back.gameMode !== 'EXPLORATION' || back.inputLocked || !back.loop) problems.push('Po walce mapa nie wróciła do działania');
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
// Każdy problem (błąd konsoli, wyjątek, nieudana asercja) kończy test kodem ≠ 0.
process.exitCode = problems.length ? 1 : 0;
