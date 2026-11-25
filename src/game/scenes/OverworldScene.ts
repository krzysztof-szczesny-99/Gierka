// Scena eksploracji: mapa kafelkowa, ruch po siatce (joystick ekranowy, opcjonalnie klawiatura),
// towarzysz za graczem, losowe spotkania po kroku w terenie (wysoka trawa, skalisty grunt) oraz
// nieruchome spotkania specjalne (jedyne stworzenia widoczne na mapie — zwykłe dzikie stworzenia nie chodzą po mapie).
// Spotkanie zaczyna się wyłącznie przez centralną blokadę: useUi.registerEncounterStep (po kroku) albo
// useUi.tryStartEncounter (kontakt ze stworzeniem specjalnym).

import * as Phaser from 'phaser';
import { ENCOUNTER_CONFIG } from '../../config/encounters';
import { trainerActorId, type TrainerDef } from '../../config/trainers';
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
import { checkTravel, connectionAt, getLocation, isConnectionOpen, mapOf, resolveSafeEntry, startLocation, type WorldPosition } from '../world';
import { challengeState, getChallenge } from '../challenges';
import { approachPath, canChallenge, eventTriggerAt, facingTo, seesPlayer, sightLine, talkKind, trainersIn, type TalkKind } from '../trainers';
import type { TrainerTrigger } from '../eventBus';
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
import { ensureCreatureTexture, FALLEN_TREE_KEY, TILESET_KEY, type CreatureTexture } from '../textures';
import { tileDef, TILE_SIZE, WATER_ALT_INDEX } from '../tiles';

const WATER_INDEX = 3;
const WILD_SCALE = 0.45;
const MIGHTY_SCALE = 0.6;
const FOLLOWER_SCALE = 0.36;
const BLOB_SCALE = 0.75;

/** Widoczne, nieruchome stworzenie specjalne (nie wędruje i nie goni gracza). */
/** Trener na mapie (Sprint 5). */
interface TrainerActor {
  def: TrainerDef;
  tx: number;
  ty: number;
  dir: Dir;
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  /** Trwa interakcja (podejście, dialog, walka) — inne wyzwalacze tego trenera są ignorowane. */
  engaged: boolean;
}

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
  private trainers: TrainerActor[] = [];
  /** Widoczne przeszkody na zamkniętych przejściach (Sprint 6) — klucz: id przejścia. */
  private lockObstacles = new Map<string, Phaser.GameObjects.Image>();
  /** Odmowa lidera po wejściu na arenę bez wymagań — raz na wizytę w lokacji (rozmowa zawsze działa). */
  private refusalShown = new Set<string>();
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
    this.trainers = [];
    this.lockObstacles = new Map();
    this.refusalShown = new Set();
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
    this.spawnTrainers();
    this.refreshLockObstacles();
    useUi.getState().protectSteps(ENCOUNTER_CONFIG.mapEnterSafeSteps);

    // Towarzysz (prowadzący drużynę)
    this.refreshFollower();

    const unsubGame = useGame.subscribe((s, prev) => {
      if (s.party !== prev.party || s.settings !== prev.settings) this.refreshFollower();
      if (s.unlockedConnections !== prev.unlockedConnections) this.refreshLockObstacles();
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
      bus.on('trainer-event', (p) => {
        const t = this.trainers.find((x) => x.def.id === p.trainerId);
        if (t) this.beginTrainer(t, 'event');
      }),
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
    const plan = planStep(this.grid, { x: this.tx, y: this.ty }, dir, (x, y) => this.occupied(x, y));

    if (plan.kind === 'contact') {
      this.setHeroFrame(false);
      const trainer = this.trainerAt(plan.x, plan.y);
      if (trainer) {
        // Dotknięcie trenera = rozmowa (jednorazowo na dane pole, jak tabliczki).
        const key = `${plan.x},${plan.y}`;
        if (this.lastBump !== key) {
          this.lastBump = key;
          this.beginTrainer(trainer, 'talk');
        }
        return;
      }
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
    // Trenerzy: wydarzenie (pole-wyzwalacz) albo wzrok. Gdy trener zaczyna interakcję, losowania nie ma.
    if (this.checkTrainers()) return;
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
    const check = checkTravel(conn, { flags: g.flags, bag: g.bag, earnedBadges: g.earnedBadges, unlockedConnections: g.unlockedConnections });
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

  /**
   * Przeszkody na zamkniętych przejściach (np. zwalone drzewo): widoczne, dopóki przejście nie zostanie
   * odblokowane odznaką. Odświeżane przy wejściu na mapę i przy zmianie listy odblokowań w zapisie.
   */
  private refreshLockObstacles(): void {
    if (this.disposed) return;
    const unlocked = useGame.getState().unlockedConnections;
    for (const c of this.location.connections) {
      const shown = this.lockObstacles.get(c.id);
      const needed = !!c.lockVisual && !isConnectionOpen(c, { unlockedConnections: unlocked });
      if (needed && !shown) {
        const { x, y } = c.sourceTrigger;
        const img = this.add.image(tileCenterX(x), tileBottomY(y), FALLEN_TREE_KEY).setOrigin(0.5, 1);
        img.setDepth(tileBottomY(y) + 5);
        this.lockObstacles.set(c.id, img);
      } else if (!needed && shown) {
        shown.destroy();
        this.lockObstacles.delete(c.id);
      }
    }
  }

  /** Widoczne przeszkody na zamkniętych przejściach (diagnostyka i testy E2E). */
  lockObstacleInfo(): { connectionId: string; x: number; y: number }[] {
    return [...this.lockObstacles.keys()].map((id) => {
      const c = this.location.connections.find((k) => k.id === id)!;
      return { connectionId: id, x: c.sourceTrigger.x, y: c.sourceTrigger.y };
    });
  }

  // ───────────────────────────── interakcje ─────────────────────────────

  private interactFront(): void {
    const nx = this.tx + DIRS[this.facing].x;
    const ny = this.ty + DIRS[this.facing].y;
    const trainer = this.trainerAt(nx, ny);
    if (trainer) {
      this.beginTrainer(trainer, 'talk');
      return;
    }
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
    const t = this.trainers.find((x) => trainerActorId(x.def.id) === actorId);
    if (t) {
      // Po walce (każdy wynik) trener wraca na swoje miejsce; pokonany nie wyzwala już walki wzrokiem.
      this.placeTrainer(t, t.def.position.x, t.def.position.y, t.def.direction);
      t.engaged = false;
      return;
    }
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

  private trainerAt(x: number, y: number): TrainerActor | undefined {
    return this.trainers.find((t) => t.tx === x && t.ty === y);
  }

  /** Pole zajęte przez postać (stworzenie specjalne albo trener). */
  private occupied(x: number, y: number): boolean {
    return !!this.actorAt(x, y) || !!this.trainerAt(x, y);
  }

  // ───────────────────────────── trenerzy (Sprint 5) ─────────────────────────────

  private spawnTrainers(): void {
    for (const def of trainersIn(this.location.id)) {
      const shadow = this.add.ellipse(0, -1, 11, 4, 0x000000, 0.28);
      const sprite = this.add.image(0, 0, `trainer-${def.look}-down-0`).setOrigin(0.5, 1);
      const container = this.add.container(0, 0, [shadow, sprite]);
      const t: TrainerActor = { def, tx: def.position.x, ty: def.position.y, dir: def.direction, container, sprite, engaged: false };
      this.trainers.push(t);
      this.placeTrainer(t, def.position.x, def.position.y, def.direction);
    }
    // Towarzysz nie może stać na polu trenera.
    if (this.followerTile && this.trainerAt(this.followerTile.x, this.followerTile.y)) this.placeFollowerBehind();
  }

  private placeTrainer(t: TrainerActor, x: number, y: number, dir: Dir): void {
    this.tweens.killTweensOf(t.container);
    t.tx = x;
    t.ty = y;
    this.faceTrainer(t, dir);
    t.container.setPosition(tileCenterX(x), tileBottomY(y));
    t.container.setDepth(tileBottomY(y) + 9);
  }

  private faceTrainer(t: TrainerActor, dir: Dir): void {
    t.dir = dir;
    const base = dir === 'left' ? 'right' : dir;
    t.sprite.setTexture(`trainer-${t.def.look}-${base}-0`);
    t.sprite.setFlipX(dir === 'left');
  }

  /** Pole przezroczyste dla wzroku: dostępne i bez innej postaci (gracz jest sprawdzany osobno). */
  private sightOpen = (x: number, y: number): boolean => isWalkable(this.grid, x, y) && !this.occupied(x, y);

  /** Wyzwalacze trenerów po kroku gracza: najpierw wydarzenie, potem wzrok (w kolejności z danych). */
  private checkTrainers(): boolean {
    const flags = useGame.getState().flags;
    const evt = eventTriggerAt(
      this.trainers.map((t) => t.def),
      this.tx,
      this.ty,
      flags,
    );
    if (evt) {
      const t = this.trainers.find((x) => x.def.id === evt.id);
      if (t && this.beginTrainer(t, 'event')) return true;
    }
    for (const t of this.trainers) {
      if (t.engaged || !canChallenge(t.def, flags) || t.def.sightRange <= 0) continue;
      if (seesPlayer({ x: t.tx, y: t.ty }, t.dir, t.def.sightRange, { x: this.tx, y: this.ty }, this.sightOpen) === null) continue;
      if (this.beginTrainer(t, 'sight')) return true;
    }
    return false;
  }

  /**
   * Interakcja z trenerem — wspólna dla rozmowy, wzroku i wydarzenia. Walka przejmuje centralną blokadę
   * (useUi.tryStartEncounter): gracz zamiera, inne wyzwalacze są zablokowane, trener podchodzi (jeśli jest
   * bezpieczna ścieżka), pojawia się dialog, a po nim — dokładnie jedna walka.
   */
  private beginTrainer(t: TrainerActor, trigger: TrainerTrigger): boolean {
    if (this.disposed || t.engaged) return false;
    const flags = useGame.getState().flags;
    // Lider Próby (Sprint 6): najpierw stan Próby — wymagania niespełnione → odmowa bez walki.
    const challenge = t.def.challengeId ? getChallenge(t.def.challengeId) : undefined;
    if (challenge) {
      const state = challengeState(challenge, useGame.getState());
      if (state === 'UNAVAILABLE') return false;
      if (state === 'LOCKED') {
        if (trigger !== 'talk' && this.refusalShown.has(t.def.id)) return false;
        this.refusalShown.add(t.def.id);
        this.faceTrainer(t, facingTo({ x: t.tx, y: t.ty }, { x: this.tx, y: this.ty }));
        this.setHeroFrame(false);
        bus.emit('dialog', { lines: challenge.dialogue.locked.map((l) => `${t.def.name}: „${l}”`) });
        return true;
      }
      if (state === 'COMPLETED' && trigger !== 'talk') return false;
    }
    let kind: TalkKind;
    if (trigger === 'talk') kind = talkKind(t.def, flags);
    else if (canChallenge(t.def, flags)) kind = 'battle';
    else return false;

    if (kind === 'after') {
      // Pokonany trener (ONCE) — zwykła rozmowa, bez walki.
      this.faceTrainer(t, facingTo({ x: t.tx, y: t.ty }, { x: this.tx, y: this.ty }));
      bus.emit('dialog', { lines: t.def.dialogueAfter.map((l) => `${t.def.name}: „${l}”`) });
      return true;
    }

    const encounterId = useUi.getState().tryStartEncounter(trainerActorId(t.def.id), { explicit: trigger === 'talk' });
    if (!encounterId) return false;
    t.engaged = true;
    // Gracz zamiera od razu (palec na joysticku nie porusza postaci aż do końca spotkania).
    releaseInput('lock');
    this.input.keyboard?.resetKeys();
    this.setHeroFrame(false);
    if (trigger !== 'talk') this.showAlertAt(t.container.x, t.container.y);

    const player = { x: this.tx, y: this.ty };
    // Lider czeka na arenie (nie podchodzi); zwykły trener podchodzi, jeśli ma bezpieczną ścieżkę.
    const path = challenge ? [] : (approachPath({ x: t.tx, y: t.ty }, player, (x, y) => this.trainerCanWalk(t, x, y)) ?? []);
    const afterWalk = () => {
      if (this.disposed || useUi.getState().activeEncounterId !== encounterId) return;
      this.faceTrainer(t, facingTo({ x: t.tx, y: t.ty }, player));
      // Gracz patrzy na trenera, jeśli stoją obok siebie.
      if (Math.abs(t.tx - this.tx) + Math.abs(t.ty - this.ty) === 1) {
        this.facing = facingTo(player, { x: t.tx, y: t.ty });
        this.setHeroFrame(false);
      }
      const lines = kind === 'rematch' ? (t.def.dialogueRematch ?? t.def.dialogueBefore) : t.def.dialogueBefore;
      let started = false;
      useUi.getState().showDialog(
        lines.map((l) => `${t.def.name}: „${l}”`),
        () => {
          // Walka rozpoczyna się dokładnie raz i tylko dla wciąż aktywnej blokady tego spotkania.
          if (started || this.disposed || useUi.getState().activeEncounterId !== encounterId) return;
          started = true;
          const cam = this.cameras.main;
          cam.flash(220, 255, 255, 255);
          cam.shake(180, 0.004);
          bus.emit('encounter', { encounterId, source: { kind: 'trainer', actorId: trainerActorId(t.def.id), trainerId: t.def.id, rematch: kind === 'rematch' } });
        },
      );
    };
    this.walkTrainer(t, path, afterWalk);
    return true;
  }

  /** Pole dostępne dla podchodzącego trenera: bez przeszkód, postaci, towarzysza i wyjść z mapy. */
  private trainerCanWalk(t: TrainerActor, x: number, y: number): boolean {
    if (!isWalkable(this.grid, x, y)) return false;
    if (this.actorAt(x, y)) return false;
    const other = this.trainerAt(x, y);
    if (other && other !== t) return false;
    if (this.followerTile && this.followerTile.x === x && this.followerTile.y === y) return false;
    return !connectionAt(this.location, x, y);
  }

  private walkTrainer(t: TrainerActor, path: { x: number; y: number }[], done: () => void): void {
    const next = path.shift();
    if (!next || this.disposed) {
      done();
      return;
    }
    this.faceTrainer(t, facingTo({ x: t.tx, y: t.ty }, next));
    t.tx = next.x;
    t.ty = next.y;
    t.container.setDepth(tileBottomY(next.y) + 9);
    this.tweens.add({
      targets: t.container,
      x: tileCenterX(next.x),
      y: tileBottomY(next.y),
      duration: stepDurationMs(false),
      onComplete: () => this.walkTrainer(t, path, done),
    });
  }

  private showAlertAt(x: number, y: number): void {
    const t = this.add
      .text(x, y - 18, '!', {
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

  /** Diagnostyka i testy: trener stoi na polu, widzi je albo pole wyzwala wydarzenie (null — pole „spokojne”). */
  trainerSightAt(x: number, y: number): string | null {
    const flags = useGame.getState().flags;
    for (const t of this.trainers) {
      if (t.tx === x && t.ty === y) return t.def.id;
      if (!canChallenge(t.def, flags)) continue;
      if ((t.def.eventTriggers ?? []).some((e) => e.x === x && e.y === y)) return t.def.id;
      if (sightLine({ x: t.tx, y: t.ty }, t.dir, t.def.sightRange, (px, py) => isWalkable(this.grid, px, py)).some((p) => p.x === x && p.y === y)) return t.def.id;
    }
    return null;
  }

  /** Diagnostyka i testy: stan trenerów na mapie. */
  trainerInfo(): { id: string; x: number; y: number; dir: Dir; engaged: boolean }[] {
    return this.trainers.map((t) => ({ id: t.def.id, x: t.tx, y: t.ty, dir: t.dir, engaged: t.engaged }));
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
    const spot = followerSpotBehind(this.grid, { x: this.tx, y: this.ty }, this.facing, (x, y) => this.occupied(x, y));
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
