// Scena eksploracji: mapa kafelkowa, ruch po siatce (joystick ekranowy, opcjonalnie klawiatura),
// stworzenia widoczne na mapie (wędrują, część sama podchodzi), towarzysz za graczem, start spotkań.
// Spotkanie zaczyna się wyłącznie przez centralną blokadę useUi.tryStartEncounter (startEncounter poniżej).

import * as Phaser from 'phaser';
import { ACTOR_RETREAT_COOLDOWN_MS, ENCOUNTER_TABLES } from '../../config/encounters';
import { isOnline } from '../../api/pokeapi';
import { getPokemon, isPokemonCached } from '../../data/repository';
import { gameRng } from '../../engine/rng';
import type { Dir } from '../../engine/types';
import { buildWild, type WildSpawn } from '../../services/creatureService';
import { leadCreature, useGame } from '../../state/gameStore';
import { isOverworldBlocked, useUi } from '../../state/uiStore';
import { bus, type EncounterOutcome } from '../eventBus';
import { consumeAction, releaseInput, resetVirtualInput, virtualInput } from '../input';
import { MAPS, TEST_MAP, type MapDef, type ZoneDef } from '../maps/testMap';
import {
  charAt,
  DIRS,
  followerSpotBehind,
  isWalkable,
  nextFollowerMove,
  planStep,
  stepDurationMs,
  type Point,
} from '../movement';
import { ensureCreatureTexture, TILESET_KEY, type CreatureTexture } from '../textures';
import { tileDef, TILE_SIZE, WATER_ALT_INDEX } from '../tiles';

const WATER_INDEX = 3;
const WILD_SCALE = 0.45;
const MIGHTY_SCALE = 0.6;
const FOLLOWER_SCALE = 0.36;
const BLOB_SCALE = 0.75;

interface WildActor {
  id: string;
  zone: ZoneDef;
  spawn: WildSpawn;
  tx: number;
  ty: number;
  container: Phaser.GameObjects.Container;
  image: Phaser.GameObjects.Image;
  moving: boolean;
  nextThink: number;
  aggressive: boolean;
  noticed: boolean;
  /** Czas sceny, do którego stworzenie nie goni gracza; < 0 = ustaw odnowienie w najbliższej klatce po walce. */
  cooldownUntil: number;
  engaged: boolean;
  removed: boolean;
}

function dirBetween(ax: number, ay: number, bx: number, by: number): Dir | null {
  if (bx > ax) return 'right';
  if (bx < ax) return 'left';
  if (by > ay) return 'down';
  if (by < ay) return 'up';
  return null;
}

const tileCenterX = (x: number) => x * TILE_SIZE + TILE_SIZE / 2;
const tileBottomY = (y: number) => (y + 1) * TILE_SIZE;

export class OverworldScene extends Phaser.Scene {
  private mapDef: MapDef = TEST_MAP;
  private grid: string[][] = [];
  private layer: Phaser.Tilemaps.TilemapLayer | null = null;
  private player!: Phaser.GameObjects.Container;
  private hero!: Phaser.GameObjects.Sprite;
  private tx = 0;
  private ty = 0;
  private facing: Dir = 'down';
  private moving = false;
  private stepToggle = false;
  private lastBump: string | null = null;
  private follower: Phaser.GameObjects.Container | null = null;
  private followerImage: Phaser.GameObjects.Image | null = null;
  private followerTile: Point | null = null;
  private followerKey = '';
  private followerReq = 0;
  private actors: WildActor[] = [];
  private actorSeq = 0;
  private spawning = new Set<string>();
  private zoneTiles = new Map<string, Point[]>();
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private keyAction: Phaser.Input.Keyboard.Key | null = null;
  private keyRun: Phaser.Input.Keyboard.Key | null = null;
  private waterAlt = false;
  private disposed = false;
  private cleanups: (() => void)[] = [];

  constructor() {
    super('Overworld');
  }

  // ───────────────────────────── tworzenie ─────────────────────────────

  create(): void {
    this.disposed = false;
    // Nowa scena mapy zawsze startuje w eksploracji (bez pozostałości po poprzedniej grze).
    if (useUi.getState().mode === 'overworld') useUi.getState().resetEncounterState();
    const g = useGame.getState();
    this.mapDef = MAPS[g.player.mapId] ?? TEST_MAP;
    this.grid = this.mapDef.layout.map((row) => row.split(''));

    const data = this.grid.map((row) => row.map((ch) => tileDef(ch).index));
    const map = this.make.tilemap({ data, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = map.addTilesetImage(TILESET_KEY, TILESET_KEY, TILE_SIZE, TILE_SIZE, 0, 0);
    if (tileset) this.layer = map.createLayer(0, tileset, 0, 0);
    this.layer?.setDepth(0);

    for (const zone of this.mapDef.zones) this.zoneTiles.set(zone.id, this.collectZoneTiles(zone));

    // Gracz
    this.tx = g.player.x;
    this.ty = g.player.y;
    this.facing = g.player.facing;
    if (!this.isWalkable(this.tx, this.ty)) {
      this.tx = this.mapDef.spawn.x;
      this.ty = this.mapDef.spawn.y;
    }
    const shadow = this.add.ellipse(0, -1, 11, 4, 0x000000, 0.28);
    this.hero = this.add.sprite(0, 0, 'hero-down-0').setOrigin(0.5, 1);
    this.player = this.add.container(tileCenterX(this.tx), tileBottomY(this.ty), [shadow, this.hero]);
    this.player.setDepth(tileBottomY(this.ty) + 10);
    this.setHeroFrame(false);

    // Kamera
    const cam = this.cameras.main;
    cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    cam.startFollow(this.player, true, 0.18, 0.18);
    cam.setRoundPixels(true);
    this.applyZoom();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);

    // Wejście: joystick ekranowy (Controls.tsx → virtualInput) oraz opcjonalnie klawiatura.
    // Dotknięcie mapy celowo nie porusza postaci (tap-to-move wyłączony).
    const kb = this.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      this.keyAction = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.keyRun = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    }

    // Animacja wody i odradzanie stworzeń
    this.time.addEvent({ delay: 650, loop: true, callback: () => this.animateWater() });
    this.time.addEvent({ delay: 1800, loop: true, callback: () => this.maintainSpawns() });
    this.maintainSpawns();

    // Towarzysz (prowadzący drużynę)
    this.refreshFollower();

    const unsubGame = useGame.subscribe((s, prev) => {
      if (s.party !== prev.party || s.settings !== prev.settings) this.refreshFollower();
    });
    // Podczas walki usypiamy pętlę Phasera (oszczędność baterii) i budzimy po powrocie.
    const unsubUi = useUi.subscribe((s, prev) => {
      if (s.mode === 'battle' && prev.mode !== 'battle') this.game.loop.sleep();
      if (prev.mode === 'battle' && s.mode !== 'battle') this.game.loop.wake(true);
    });

    this.cleanups.push(
      unsubGame,
      unsubUi,
      bus.on('battle-end', (p) => this.onBattleEnd(p.actorId, p.outcome)),
      bus.on('teleport', (p) => this.teleport(p.x, p.y, p.facing)),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.dispose());
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    resetVirtualInput();
  }

  // ───────────────────────────── pętla ─────────────────────────────

  update(): void {
    if (this.disposed) return;
    // Blokada: spotkanie (centralny stan), walka, okno, dialog, przejście — wejście jest ignorowane.
    if (isOverworldBlocked()) {
      consumeAction();
      if (!this.moving) this.setHeroFrame(false);
      return;
    }

    // Zawsze zegar sceny (this.time.now) — spójnie z czasami ustawianymi przy tworzeniu stworzeń.
    this.updateActors(this.time.now);
    // Spotkanie mogło się zacząć w tej klatce (pościg) — wtedy ruch jest już zablokowany.
    if (this.moving || isOverworldBlocked()) return;

    const actionPressed = consumeAction() || (this.keyAction ? Phaser.Input.Keyboard.JustDown(this.keyAction) : false);
    if (actionPressed) {
      this.interactFront();
      return;
    }

    const dir: Dir | null = virtualInput.dir ?? this.keyboardDir();
    if (!dir) {
      this.lastBump = null;
      this.setHeroFrame(false);
      return;
    }
    const running = virtualInput.run || !!this.keyRun?.isDown;
    this.tryStep(dir, running);
  }

  private keyboardDir(): Dir | null {
    const c = this.cursors;
    if (!c) return null;
    if (c.left.isDown) return 'left';
    if (c.right.isDown) return 'right';
    if (c.up.isDown) return 'up';
    if (c.down.isDown) return 'down';
    return null;
  }

  // ───────────────────────────── ruch gracza ─────────────────────────────

  private tryStep(dir: Dir, running: boolean): void {
    this.facing = dir;
    const plan = planStep(this.grid, { x: this.tx, y: this.ty }, dir, (x, y) => !!this.actorAt(x, y));

    if (plan.kind === 'contact') {
      this.setHeroFrame(false);
      const actor = this.actorAt(plan.x, plan.y);
      if (actor) this.startEncounter(actor);
      return;
    }

    if (plan.kind === 'blocked') {
      this.setHeroFrame(false);
      const key = `${plan.x},${plan.y}`;
      if ((plan.tileKind === 'door' || plan.tileKind === 'sign') && this.lastBump !== key) {
        this.lastBump = key;
        this.interactAt(plan.x, plan.y, false);
      }
      return;
    }

    const nx = plan.x;
    const ny = plan.y;
    const fromX = this.tx;
    const fromY = this.ty;
    this.tx = nx;
    this.ty = ny;
    this.moving = true;
    this.lastBump = null;
    this.stepToggle = !this.stepToggle;
    this.setHeroFrame(true);

    const duration = stepDurationMs(running);
    this.player.setDepth(tileBottomY(ny) + 10);
    this.tweens.add({
      targets: this.player,
      x: tileCenterX(nx),
      y: tileBottomY(ny),
      duration,
      onComplete: () => {
        this.moving = false;
        this.onStepComplete();
      },
    });
    this.moveFollower(fromX, fromY, duration);
  }

  private onStepComplete(): void {
    const g = useGame.getState();
    g.setPosition(this.tx, this.ty, this.facing);
    g.addStep();
  }

  private setHeroFrame(walking: boolean): void {
    if (!this.hero) return;
    const base = this.facing === 'left' ? 'right' : this.facing;
    const key = `hero-${base}-${walking ? 1 : 0}`;
    if (this.hero.texture.key !== key) this.hero.setTexture(key);
    const flip = this.facing === 'left' || ((this.facing === 'up' || this.facing === 'down') && walking && this.stepToggle);
    this.hero.setFlipX(flip);
  }

  private teleport(x: number, y: number, facing: Dir): void {
    this.tx = x;
    this.ty = y;
    this.facing = facing;
    this.tweens.killTweensOf(this.player);
    this.moving = false;
    this.player.setPosition(tileCenterX(x), tileBottomY(y));
    this.player.setDepth(tileBottomY(y) + 10);
    this.setHeroFrame(false);
    this.cameras.main.centerOn(this.player.x, this.player.y);
    this.placeFollowerBehind();
  }

  // ───────────────────────────── interakcje ─────────────────────────────

  private interactFront(): void {
    const nx = this.tx + DIRS[this.facing].x;
    const ny = this.ty + DIRS[this.facing].y;
    const actor = this.actorAt(nx, ny);
    if (actor) {
      this.startEncounter(actor);
      return;
    }
    this.interactAt(nx, ny, true);
  }

  private interactAt(x: number, y: number, explicit: boolean): void {
    const key = `${x},${y}`;
    const door = this.mapDef.doors[key];
    if (door) {
      bus.emit('door', { kind: door });
      return;
    }
    const sign = this.mapDef.signs[key];
    if (sign) {
      bus.emit('dialog', { lines: sign });
      return;
    }
    if (!explicit) return;
    const ch = this.charAt(x, y);
    if (tileDef(ch).kind === 'water') bus.emit('dialog', { lines: ['Woda jest spokojna i głęboka. Może kiedyś uda się ją przepłynąć…'] });
    else if (ch === 'R') bus.emit('dialog', { lines: ['Ciężki głaz. Ani drgnie.'] });
  }

  // ───────────────────────────── spotkania ─────────────────────────────

  /**
   * Jedyne miejsce, z którego mapa zgłasza spotkanie (kontakt przy kroku, przycisk A, pościg stworzenia).
   * Najpierw przejmuje centralną blokadę — gdy się nie uda (trwa inne spotkanie, odnowienie, okno), nic nie robi.
   */
  private startEncounter(actor: WildActor): boolean {
    if (this.disposed || actor.removed || actor.engaged) return false;
    const encounterId = useUi.getState().tryStartEncounter(actor.id);
    if (!encounterId) return false;
    actor.engaged = true;
    // Natychmiastowe zatrzymanie wejścia: joystick odpina palec, klawisze zostają wyzerowane.
    releaseInput('lock');
    this.input.keyboard?.resetKeys();
    const d = dirBetween(this.tx, this.ty, actor.tx, actor.ty);
    if (d) this.facing = d;
    this.setHeroFrame(false);
    this.showAlert(actor);
    const cam = this.cameras.main;
    cam.flash(220, 255, 255, 255);
    cam.shake(180, 0.004);
    bus.emit('encounter', { encounterId, actorId: actor.id, spawn: actor.spawn });
    return true;
  }

  /** Aktualizacja obiektu źródłowego po zakończeniu spotkania (blokadę zwalnia encounterService). */
  private onBattleEnd(actorId: string | null, outcome: EncounterOutcome): void {
    this.lastBump = null;
    const a = this.actors.find((x) => x.id === actorId);
    if (!a) return;
    if (outcome === 'win' || outcome === 'caught' || outcome === 'lose') {
      this.removeActor(a);
    } else {
      a.engaged = false;
      a.aggressive = false;
      a.noticed = false;
      // Pętla Phasera śpi podczas walki, więc czas sceny jest nieaktualny — odnowienie liczymy od pierwszej klatki po powrocie.
      a.cooldownUntil = -1;
    }
  }

  // ───────────────────────────── dzikie stworzenia ─────────────────────────────

  private collectZoneTiles(zone: ZoneDef): Point[] {
    const out: Point[] = [];
    for (let y = zone.rect.y; y < zone.rect.y + zone.rect.h; y++) {
      for (let x = zone.rect.x; x < zone.rect.x + zone.rect.w; x++) {
        if (zone.spawnTiles.includes(this.charAt(x, y))) out.push({ x, y });
      }
    }
    return out;
  }

  private maintainSpawns(): void {
    if (this.disposed || useUi.getState().gameMode !== 'EXPLORATION') return;
    for (const zone of this.mapDef.zones) {
      const count = this.actors.filter((a) => a.zone.id === zone.id && !a.removed).length;
      if (count >= zone.maxActive || this.spawning.has(zone.id)) continue;
      this.spawning.add(zone.id);
      this.spawnInZone(zone)
        .catch((e) => console.warn('Nie udało się utworzyć stworzenia', e))
        .finally(() => this.spawning.delete(zone.id));
    }
  }

  private async spawnInZone(zone: ZoneDef): Promise<void> {
    const table = ENCOUNTER_TABLES[zone.table];
    if (!table) return;
    let entries = table.entries;
    if (!isOnline()) {
      const cached = await Promise.all(entries.map((e) => isPokemonCached(e.pokemon)));
      entries = entries.filter((_, i) => cached[i]);
      if (!entries.length) return;
    }
    const entry = gameRng.weighted(entries);
    const spawn = await buildWild(entry, table, zone, gameRng);
    if (this.disposed) return;
    const tex = await ensureCreatureTexture(this, spawn.pokemon, spawn.creature.shiny, useGame.getState().settings.useApiSprites);
    if (this.disposed) return;
    const tile = this.pickSpawnTile(zone);
    if (!tile) return;
    this.createActor(zone, spawn, tile, tex);
  }

  private pickSpawnTile(zone: ZoneDef): Point | null {
    const candidates = (this.zoneTiles.get(zone.id) ?? []).filter(
      (p) => this.isFreeForActor(p.x, p.y) && Math.abs(p.x - this.tx) + Math.abs(p.y - this.ty) >= 4,
    );
    return candidates.length ? gameRng.pick(candidates) : null;
  }

  private createActor(zone: ZoneDef, spawn: WildSpawn, tile: Point, tex: CreatureTexture): void {
    const mighty = spawn.creature.mighty;
    const parts: Phaser.GameObjects.GameObject[] = [this.add.ellipse(0, -1, 14, 5, 0x000000, 0.25)];
    let aura: Phaser.GameObjects.Ellipse | null = null;
    if (mighty) {
      aura = this.add.ellipse(0, -2, 28, 10, 0xf2b84b, 0.55);
      parts.push(aura);
    }
    const scale = tex.isBlob ? BLOB_SCALE * (mighty ? 1.25 : 1) : mighty ? MIGHTY_SCALE : WILD_SCALE;
    const image = this.add
      .image(0, 0, tex.key)
      .setOrigin(0.5, tex.isBlob ? 1 : 0.92)
      .setScale(scale);
    parts.push(image);
    const container = this.add.container(tileCenterX(tile.x), tileBottomY(tile.y), parts);
    container.setDepth(tileBottomY(tile.y) + 5);
    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 350 });
    if (aura) this.tweens.add({ targets: aura, alpha: 0.15, duration: 700, yoyo: true, repeat: -1 });
    if (spawn.creature.shiny) this.tweens.add({ targets: image, alpha: 0.6, duration: 260, yoyo: true, repeat: 3 });

    this.actors.push({
      id: `wild-${++this.actorSeq}`,
      zone,
      spawn,
      tx: tile.x,
      ty: tile.y,
      container,
      image,
      moving: false,
      nextThink: this.time.now + gameRng.int(500, 1800),
      aggressive: spawn.aggressive,
      noticed: false,
      cooldownUntil: 0,
      engaged: false,
      removed: false,
    });
  }

  private removeActor(a: WildActor): void {
    if (a.removed) return;
    a.removed = true;
    this.tweens.killTweensOf(a.container);
    this.tweens.add({
      targets: a.container,
      alpha: 0,
      duration: 300,
      onComplete: () => a.container.destroy(),
    });
    this.actors = this.actors.filter((x) => x !== a);
  }

  private updateActors(time: number): void {
    for (const a of this.actors) {
      if (a.cooldownUntil < 0) {
        a.cooldownUntil = time + ACTOR_RETREAT_COOLDOWN_MS;
        a.nextThink = time + 300;
      }
      if (a.removed || a.moving || a.engaged || time < a.nextThink) continue;
      const dist = Math.abs(a.tx - this.tx) + Math.abs(a.ty - this.ty);
      const chasing = a.aggressive && time >= a.cooldownUntil && dist <= 4;
      if (chasing && !a.noticed) {
        a.noticed = true;
        this.showAlert(a);
        a.nextThink = time + 550;
        continue;
      }
      if (!chasing && dist > 6) a.noticed = false;

      let dir: Dir | null = null;
      if (chasing) {
        const dx = this.tx - a.tx;
        const dy = this.ty - a.ty;
        const primary: Dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        const secondary: Dir | null = Math.abs(dx) >= Math.abs(dy) ? (dy === 0 ? null : dy > 0 ? 'down' : 'up') : dx === 0 ? null : dx > 0 ? 'right' : 'left';
        dir = primary;
        const px = a.tx + DIRS[primary].x;
        const py = a.ty + DIRS[primary].y;
        const hitsPlayer = px === this.tx && py === this.ty;
        if (!hitsPlayer && !this.canActorEnter(a, px, py, true) && secondary) dir = secondary;
      } else if (gameRng.chance(0.65)) {
        dir = gameRng.pick(['up', 'down', 'left', 'right'] as const);
      }
      a.nextThink = time + (chasing ? 420 : gameRng.int(900, 2400));
      if (!dir) continue;

      const nx = a.tx + DIRS[dir].x;
      const ny = a.ty + DIRS[dir].y;
      if (nx === this.tx && ny === this.ty) {
        if (chasing && !this.moving && this.startEncounter(a)) return;
        continue;
      }
      if (!this.canActorEnter(a, nx, ny, chasing)) continue;
      this.moveActor(a, nx, ny, chasing ? 200 : 280);
    }
  }

  private moveActor(a: WildActor, nx: number, ny: number, duration: number): void {
    if (nx !== a.tx) a.image.setFlipX(nx > a.tx); // sprite'y „frontowe” patrzą zwykle w lewo
    a.tx = nx;
    a.ty = ny;
    a.moving = true;
    a.container.setDepth(tileBottomY(ny) + 5);
    this.tweens.add({
      targets: a.container,
      x: tileCenterX(nx),
      y: tileBottomY(ny),
      duration,
      onComplete: () => {
        a.moving = false;
      },
    });
    this.tweens.add({ targets: a.image, y: -3, duration: duration / 2, yoyo: true });
  }

  private showAlert(a: WildActor): void {
    const t = this.add
      .text(a.container.x, a.container.y - 30, '!', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#ef6461',
        padding: { x: 3, y: 0 },
      })
      .setOrigin(0.5, 1)
      .setDepth(10_000);
    this.tweens.add({ targets: t, y: t.y - 4, duration: 180, yoyo: true });
    this.time.delayedCall(800, () => t.destroy());
  }

  private canActorEnter(a: WildActor, x: number, y: number, chasing: boolean): boolean {
    if (!this.isFreeForActor(x, y)) return false;
    const r = a.zone.rect;
    const margin = chasing ? 3 : 0;
    return x >= r.x - margin && x < r.x + r.w + margin && y >= r.y - margin && y < r.y + r.h + margin;
  }

  private isFreeForActor(x: number, y: number): boolean {
    if (!this.isWalkable(x, y)) return false;
    if (x === this.tx && y === this.ty) return false;
    if (this.followerTile && this.followerTile.x === x && this.followerTile.y === y) return false;
    if (this.mapDef.doors[`${x},${y - 1}`]) return false; // nie blokuj wejść do budynków
    return !this.actorAt(x, y);
  }

  private actorAt(x: number, y: number): WildActor | undefined {
    return this.actors.find((a) => !a.removed && a.tx === x && a.ty === y);
  }

  // ───────────────────────────── towarzysz ─────────────────────────────

  private refreshFollower(): void {
    const s = useGame.getState();
    const lead = leadCreature(s.party);
    if (!s.settings.showFollower || !lead) {
      this.destroyFollower();
      return;
    }
    const key = `${lead.uid}|${lead.pokemon}|${lead.shiny}|${s.settings.useApiSprites}`;
    if (key === this.followerKey && this.follower) return;
    this.followerKey = key;
    const req = ++this.followerReq;
    getPokemon(lead.pokemon)
      .then((data) => ensureCreatureTexture(this, data, lead.shiny, s.settings.useApiSprites))
      .then((tex) => {
        if (this.disposed || req !== this.followerReq) return;
        if (!this.follower || !this.followerImage) {
          const shadow = this.add.ellipse(0, -1, 12, 4, 0x000000, 0.25);
          this.followerImage = this.add.image(0, 0, tex.key);
          this.follower = this.add.container(0, 0, [shadow, this.followerImage]);
          this.placeFollowerBehind();
        }
        this.followerImage
          .setTexture(tex.key)
          .setOrigin(0.5, tex.isBlob ? 1 : 0.92)
          .setScale(tex.isBlob ? BLOB_SCALE * 0.8 : FOLLOWER_SCALE);
      })
      .catch(() => {
        /* offline bez danych — po prostu bez towarzysza */
      });
  }

  private destroyFollower(): void {
    this.followerReq += 1;
    this.followerKey = '';
    this.follower?.destroy();
    this.follower = null;
    this.followerImage = null;
    this.followerTile = null;
  }

  private placeFollowerBehind(): void {
    if (!this.follower) return;
    const spot = followerSpotBehind(this.grid, { x: this.tx, y: this.ty }, this.facing, (x, y) => !!this.actorAt(x, y));
    this.followerTile = spot;
    this.tweens.killTweensOf(this.follower);
    this.follower.setPosition(tileCenterX(spot.x), tileBottomY(spot.y));
    this.follower.setDepth(tileBottomY(spot.y) + 4);
  }

  private moveFollower(toX: number, toY: number, duration: number): void {
    if (!this.follower || !this.followerTile || !this.followerImage) return;
    const from = this.followerTile;
    const plan = nextFollowerMove(from, { x: toX, y: toY });
    if (plan.kind === 'none') return;
    if (plan.kind === 'reposition') {
      this.placeFollowerBehind();
      return;
    }
    if (toX !== from.x) this.followerImage.setFlipX(toX > from.x);
    this.followerTile = { x: toX, y: toY };
    this.follower.setDepth(tileBottomY(toY) + 4);
    this.tweens.add({ targets: this.follower, x: tileCenterX(toX), y: tileBottomY(toY), duration });
  }

  // ───────────────────────────── mapa ─────────────────────────────

  private charAt(x: number, y: number): string {
    return charAt(this.grid, x, y);
  }

  private isWalkable(x: number, y: number): boolean {
    return isWalkable(this.grid, x, y);
  }

  private animateWater(): void {
    if (!this.layer) return;
    if (this.waterAlt) this.layer.replaceByIndex(WATER_ALT_INDEX, WATER_INDEX);
    else this.layer.replaceByIndex(WATER_INDEX, WATER_ALT_INDEX);
    this.waterAlt = !this.waterAlt;
  }

  private applyZoom(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const target = Math.min(w, h * 0.85) / (TILE_SIZE * 10);
    const zoom = Math.max(1.5, Math.min(6, Math.round(target * 2) / 2));
    this.cameras.main.setZoom(zoom);
  }

  private onResize(size: Phaser.Structs.Size): void {
    if (this.disposed) return;
    this.cameras.main.setSize(size.width, size.height);
    this.applyZoom();
  }
}
