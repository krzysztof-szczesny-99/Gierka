// Rejestracja tekstur w Phaserze: proceduralny tileset, postać gracza, sylwetki zastępcze, sprite'y z PokéAPI.

import * as Phaser from 'phaser';
import { TYPE_COLOR } from '../config/text';
import type { PokemonData } from '../engine/types';
import { drawBlob, drawFallenTree, drawHero, drawTile, HERO_FRAMES, TRAINER_PALETTES } from './art';
import { TILE_COUNT, TILE_SIZE } from './tiles';

export const TILESET_KEY = 'tiles';
/** Tekstura przeszkody na zamkniętym przejściu (Sprint 6). */
export const FALLEN_TREE_KEY = 'lock-fallen-tree';

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  tex.refresh();
}

export function createTileset(scene: Phaser.Scene): void {
  canvasTexture(scene, TILESET_KEY, TILE_SIZE * TILE_COUNT, TILE_SIZE, (ctx) => {
    for (let i = 0; i < TILE_COUNT; i++) drawTile(ctx, i, i * TILE_SIZE, 0);
  });
}

export function createHeroTextures(scene: Phaser.Scene): void {
  for (const frame of Object.keys(HERO_FRAMES)) {
    canvasTexture(scene, `hero-${frame}`, 16, 16, (ctx) => drawHero(ctx, frame));
    for (const [look, palette] of Object.entries(TRAINER_PALETTES)) {
      canvasTexture(scene, `trainer-${look}-${frame}`, 16, 16, (ctx) => drawHero(ctx, frame, 0, 0, palette));
    }
  }
  // Przeszkoda na zamkniętym przejściu (Sprint 6).
  canvasTexture(scene, FALLEN_TREE_KEY, 16, 16, (ctx) => drawFallenTree(ctx));
}

export function blobKey(type: string): string {
  return `blob-${type}`;
}

export function ensureBlobTexture(scene: Phaser.Scene, type: string): string {
  const key = blobKey(type);
  canvasTexture(scene, key, 32, 32, (ctx) => drawBlob(ctx, TYPE_COLOR[type] ?? '#9a9a86'));
  return key;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Nie udało się wczytać obrazka: ${url}`));
      img.src = url;
    });
    imageCache.set(url, p);
    p.catch(() => imageCache.delete(url));
  }
  return p;
}

export interface CreatureTexture {
  key: string;
  isBlob: boolean;
}

/**
 * Tekstura stworzenia na mapę: sprite z PokéAPI (jeśli włączone i dostępne),
 * w przeciwnym razie oryginalna sylwetka w kolorze typu.
 */
export async function ensureCreatureTexture(
  scene: Phaser.Scene,
  pokemon: PokemonData,
  shiny: boolean,
  useApiSprites: boolean,
): Promise<CreatureTexture> {
  const fallback = (): CreatureTexture => ({ key: ensureBlobTexture(scene, pokemon.types[0] ?? 'normal'), isBlob: true });
  const url = useApiSprites ? ((shiny ? pokemon.sprites.frontShiny : null) ?? pokemon.sprites.front) : null;
  if (!url) return fallback();
  const key = `poke:${url}`;
  if (scene.textures.exists(key)) return { key, isBlob: false };
  try {
    const img = await loadImage(url);
    if (!scene.textures.exists(key)) scene.textures.addImage(key, img);
    return { key, isBlob: false };
  } catch {
    return fallback();
  }
}
