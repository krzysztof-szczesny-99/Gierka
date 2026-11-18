// Definicje kafelków mapy (znak ASCII → indeks w proceduralnym tilesecie + właściwości).

export const TILE_SIZE = 16;

export type TileKind = 'tall' | 'water' | 'door' | 'sign' | 'path';

export interface TileDef {
  index: number;
  solid: boolean;
  kind?: TileKind;
  label: string;
}

export const TILE_DEFS: Record<string, TileDef> = {
  '.': { index: 0, solid: false, label: 'trawa' },
  ',': { index: 1, solid: false, kind: 'tall', label: 'wysoka trawa' },
  '=': { index: 2, solid: false, kind: 'path', label: 'ścieżka' },
  '~': { index: 3, solid: true, kind: 'water', label: 'woda' },
  s: { index: 5, solid: false, label: 'piasek' },
  T: { index: 6, solid: true, label: 'drzewo' },
  R: { index: 7, solid: true, label: 'głaz' },
  r: { index: 8, solid: false, label: 'skalisty grunt' },
  f: { index: 9, solid: false, label: 'kwiaty' },
  C: { index: 10, solid: true, label: 'dach Stacji Opieki' },
  c: { index: 11, solid: true, label: 'godło Stacji Opieki' },
  w: { index: 12, solid: true, label: 'ściana' },
  D: { index: 13, solid: true, kind: 'door', label: 'drzwi Stacji Opieki' },
  M: { index: 14, solid: true, label: 'dach Kramu' },
  m: { index: 15, solid: true, label: 'godło Kramu' },
  E: { index: 16, solid: true, kind: 'door', label: 'drzwi Kramu' },
  S: { index: 17, solid: true, kind: 'sign', label: 'tabliczka' },
  F: { index: 18, solid: true, label: 'płot' },
  B: { index: 19, solid: false, label: 'kładka' },
};

/** Druga klatka animacji wody. */
export const WATER_ALT_INDEX = 4;
export const TILE_COUNT = 20;

export function tileDef(ch: string): TileDef {
  return TILE_DEFS[ch] ?? TILE_DEFS['.'];
}
