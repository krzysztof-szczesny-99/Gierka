// Scena eksploracji: mapa kafelkowa, ruch po siatce (joystick ekranowy, opcjonalnie klawiatura),
// towarzysz za graczem, losowe spotkania po kroku w terenie (wysoka trawa, skalisty grunt) oraz
// nieruchome spotkania specjalne (jedyne stworzenia widoczne na mapie — zwykłe dzikie stworzenia nie chodzą po mapie).
// Spotkanie zaczyna się wyłącznie przez centralną blokadę: useUi.registerEncounterStep (po kroku) albo
// useUi.tryStartEncounter (kontakt ze stworzeniem specjalnym).

import * as Phaser from 'phaser';
import { ENCOUNTER_CONFIG } from '../../config/encounters';
import { getPokemon } from '../../data/repository';
import type { Dir } from '../../engine/types';
import type { WildSpawn } from '../../services/creatureService';
import { buildStaticSpawn, encounterStepRng } from '../../services/encounterService';
import { leadCreature, useGame } from '../../state/gameStore';
import { isOverworldBlocked, useUi } from '../../state/uiStore';
import { activeStaticEncounters, encounterZoneAt } from '../encounterZones';
import { bus, type EncounterOutcome } from '../eventBus';
import { consumeAction, releaseInput, resetVirtualInput, virtualInput } from '../input';
import type { LocationConnection, LocationDef } from '../../config/world';
import { saveNow } from '../../data/saveGame';
import { TEST_MAP, type MapDef, type StaticEncounterDef, type ZoneDef } from '../maps/testMap';
import { checkTravel, connectionAt, getLocation, mapOf, resolveSafeEntry, startLocation, type WorldPosition } from '../world';
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

/** Widoczne, nieruchome stworzenie specjalne (nie wędruje i nie goni gracza). */
interface StaticActor {
  id: string;
  def: StaticEncounterDef;
  spawn: WildSpawn;
  tx: number;
  ty: number;
  container: Phaser.GameObjects.Container;
  image: Phaser.GameObjects.Image;
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
  /** Bieżąca lokacja z modelu świata (src/config/world.ts) i jej mapa. */
  private location!: LocationDef;
  private mapDef: MapDef = TEST_MAP;
  /** Trwa przejście do innej lokacji (wygaszanie ekranu przed przeładowaniem sceny). */
  private traveling = false;
  /** Scena została uruchomiona ponownie po przejściu między mapami. */
  private arrivedByTravel = false;
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
  private actors: StaticActor[] = [];
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

  /** Phaser wywołuje init przed create — także przy przeładowaniu sceny po zmianie mapy: zerujemy stan. */
  init(data?: { travel?: boolean }): void {
    this.arrivedByTravel = !!data?.travel;
    this.traveling = false;
    this.moving = false;
    this.stepToggle = false;
    this.lastBump = null;
    this.follower = null;
    this.followerImage = null;
    this.followerTile = null;
    this.followerKey = '';
    this.followerReq += 1;
    this.actors = [];
    this.layer = null;
    this.waterAlt = false;
    this.cleanups = [];
  }

  create(): void {
    this.disposed = false;
    // Nowa scena mapy zawsze startuje w eksploracji (bez pozostałości po poprzedniej grze).
    if (useUi.getState().mode === 'overworld') useUi.getState().resetEncounterState();
    // Lokacja z zapisu + bezpieczny punkt wejścia (nieistniejąca lokacja lub zła pozycja → punkt pojawienia się).
    const entry = resolveSafeEntry(useGame.getState().player);
    const p0 = useGame.getState().player;
    if (p0.locationId !== entry.locationId || p0.x !== entry.x || p0.y !== entry.y || p0.spawnPointId !== entry.spawnPointId) {
      useGame.getState().setLocation(entry);
    }
    const g = useGame.getState();
    this.location = getLocation(entry.locationId) ?? startLocation();
    this.mapDef = mapOf(this.location) ?? TEST_MAP;
    this.grid = this.mapDef.layout.map((row) => row.split(''));

    const data = this.grid.map((row) => row.map((ch) => tileDef(ch).index));
    const map = this.make.tilemap({ data, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = map.addTilesetImage(TILESET_KEY, TILESET_KEY, TILE_SIZE, TILE_SIZE, 0, 0);
    if (tileset) this.layer = map.createLayer(0, tileset, 0, 0);
    this.layer?.setDepth(0);

    // Gracz
    this.tx = g.player.x;
    this.ty = g.player.y;
    this.facing = g.player.facing;
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

    // Animacja wody; spotkania specjalne (jedyne widoczne stworzenia, nieruchome); kroki ochronne po wejściu na mapę.
    this.time.addEvent({ delay: 650, loop: true, callback: () => this.animateWater() });
    this.spawnStaticEncounters();
    useUi.getState().protectSteps(ENCOUNTER_CONFIG.mapEnterSafeSteps);

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
      bus.on('travel', (p) => this.travelTo(p)),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.dispose());

    // Koniec przejścia między mapami: rozjaśnienie i odblokowanie wejścia.
    if (this.arrivedByTravel) {
      cam.fadeIn(220, 0, 0, 0);
      useUi.getState().setTransition(false);
    }
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    // Przy zmianie mapy zachowujemy przełącznik biegu; przy zamknięciu gry — pełne zerowanie.
    if (this.traveling) releaseInput('reset');
    else resetVirtualInput();
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

    if (this.moving) return;

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
    // Wyjście z lokacji: przejście albo komunikat o blokadzie (wtedy bez losowania spotkania).
    const conn = connectionAt(this.location, this.tx, this.ty);
    if (conn) {
      this.useConnection(conn);
      return;
    }
    // Losowe spotkanie: sprawdzane wyłącznie po wejściu na nowe pole (najwyżej jeden rzut na krok).
    const zone = encounterZoneAt(this.mapDef, this.grid, this.tx, this.ty, useGame.getState().flags);
    const { encounterId } = useUi.getState().registerEncounterStep({ movedToNewTile: true, zone }, encounterStepRng());
    if (encounterId && zone) this.beginStepEncounter(encounterId, zone);
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
    // Przeniesienie (np. do Stacji Opieki) = wejście w nowe miejsce: kroki ochronne.
    useUi.getState().protectSteps(ENCOUNTER_CONFIG.mapEnterSafeSteps);
  }

  // ───────────────────────────── przejścia między mapami ─────────────────────────────

  private useConnection(conn: LocationConnection): void {
    const g = useGame.getState();
    const check = checkTravel(conn, { flags: g.flags, bag: g.bag });
    if (!check.ok) {
      this.setHeroFrame(false);
      bus.emit('dialog', { lines: check.message });
      return;
    }
    this.travelTo(check.position);
  }

  /**
   * Przejście do innej lokacji (albo w obrębie tej samej — wtedy zwykłe przeniesienie): zapis położenia,
   * wygaszenie ekranu i przeładowanie sceny z mapą nowej lokacji. Wejście jest zablokowane do końca przejścia.
   */
  private travelTo(pos: WorldPosition): void {
    if (this.disposed || this.traveling) return;
    if (pos.locationId === this.location.id) {
      useGame.getState().setLocation(pos);
      this.teleport(pos.x, pos.y, pos.facing);
      return;
    }
    this.traveling = true;
    const ui = useUi.getState();
    ui.setTransition(true);
    releaseInput('lock');
    this.input.keyboard?.resetKeys();
    this.setHeroFrame(false);
    useGame.getState().setLocation(pos);
    saveNow().catch(() => undefined);
    const cam = this.cameras.main;
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      if (!this.disposed) this.scene.restart({ travel: true });
    });
    cam.fadeOut(220, 0, 0, 0);
  }

  /** Czy pole jest wyzwalaczem przejścia (diagnostyka i testy). */
  exitAt(x: number, y: number): string | null {
    return connectionAt(this.location, x, y)?.id ?? null;
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

  /** Wejście w spotkanie (blokada już przejęta): natychmiastowe zatrzymanie wejścia i efekt przejścia. */
  private lockInputForEncounter(): void {
    releaseInput('lock');
    this.input.keyboard?.resetKeys();
    this.setHeroFrame(false);
    const cam = this.cameras.main;
    cam.flash(220, 255, 255, 255);
    cam.shake(180, 0.004);
  }

  /** Spotkanie wylosowane po kroku — blokadę przejęło już useUi.registerEncounterStep. */
  private beginStepEncounter(encounterId: string, zone: ZoneDef): void {
    if (this.disposed) return;
    this.lockInputForEncounter();
    bus.emit('encounter', {
      encounterId,
      source: {
        kind: 'step',
        locationId: zone.locationId,
        zoneId: zone.id,
        zoneName: zone.name,
        terrainType: zone.terrainType,
        encounterTableId: zone.encounterTableId,
      },
    });
  }

  /**
   * Kontakt ze stworzeniem specjalnym (wejście w nie albo przycisk A).
   * Najpierw przejmuje centralną blokadę — gdy się nie uda (trwa inne spotkanie, odnowienie, okno), nic nie robi.
   */
  private startEncounter(actor: StaticActor): boolean {
    if (this.disposed || actor.removed || actor.engaged) return false;
    const encounterId = useUi.getState().tryStartEncounter(actor.id);
    if (!encounterId) return false;
    actor.engaged = true;
    const d = dirBetween(this.tx, this.ty, actor.tx, actor.ty);
    if (d) this.facing = d;
    this.lockInputForEncounter();
    this.showAlert(actor);
    bus.emit('encounter', { encounterId, source: { kind: 'static', actorId: actor.id, staticId: actor.def.id, spawn: actor.spawn } });
    return true;
  }

  /** Aktualizacja obiektu źródłowego po zakończeniu spotkania (blokadę zwalnia encounterService). */
  private onBattleEnd(actorId: string | null, outcome: EncounterOutcome): void {
    this.lastBump = null;
    const a = this.actors.find((x) => x.id === actorId);
    if (!a) return;
    // Po wygranej lub złapaniu stworzenie specjalne znika na stałe (flaga w zapisie); inaczej zostaje na miejscu.
    if (outcome === 'win' || outcome === 'caught') this.removeActor(a);
    else a.engaged = false;
  }

  // ───────────────────────────── stworzenia specjalne ─────────────────────────────

  private spawnStaticEncounters(): void {
    const flags = useGame.getState().flags;
    for (const def of activeStaticEncounters(this.mapDef, flags)) {
      const zoneName = this.mapDef.zones.find((z) => z.id === def.zoneId)?.name ?? this.mapDef.name;
      buildStaticSpawn(def, zoneName)
        .then(async (spawn) => {
          if (this.disposed) return;
          const tex = await ensureCreatureTexture(this, spawn.pokemon, spawn.creature.shiny, useGame.getState().settings.useApiSprites);
          if (this.disposed || this.actors.some((a) => a.def.id === def.id)) return;
          this.createActor(def, spawn, tex);
        })
        .catch((e) => console.warn('Nie udało się przygotować spotkania specjalnego', e));
    }
  }

  private createActor(def: StaticEncounterDef, spawn: WildSpawn, tex: CreatureTexture): void {
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
    const container = this.add.container(tileCenterX(def.x), tileBottomY(def.y), parts);
    container.setDepth(tileBottomY(def.y) + 5);
    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 350 });
    if (aura) this.tweens.add({ targets: aura, alpha: 0.15, duration: 700, yoyo: true, repeat: -1 });
    if (spawn.creature.shiny) this.tweens.add({ targets: image, alpha: 0.6, duration: 260, yoyo: true, repeat: 3 });

    this.actors.push({ id: `static:${def.id}`, def, spawn, tx: def.x, ty: def.y, container, image, engaged: false, removed: false });
    // Towarzysz nie może stać na polu stworzenia.
    if (this.followerTile && this.followerTile.x === def.x && this.followerTile.y === def.y) this.placeFollowerBehind();
  }

  private removeActor(a: StaticActor): void {
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

  private showAlert(a: StaticActor): void {
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

  private actorAt(x: number, y: number): StaticActor | undefined {
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

  /** Czy pole jest dostępne (używane też w testach E2E). */
  isWalkable(x: number, y: number): boolean {
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
