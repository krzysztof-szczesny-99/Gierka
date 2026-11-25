// Oryginalna grafika pikselowa rysowana proceduralnie na canvasie (bez plików graficznych).
// Moduł nie zależy od Phasera — można go podejrzeć w zwykłej przeglądarce.

type Ctx = CanvasRenderingContext2D;

function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function speckle(ctx: Ctx, ox: number, oy: number, seed: number, dark: string, light: string, dRate = 0.08, lRate = 0.05) {
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      const r = hash(i, j, seed);
      if (r < dRate) px(ctx, ox + i, oy + j, 1, 1, dark);
      else if (r > 1 - lRate) px(ctx, ox + i, oy + j, 1, 1, light);
    }
  }
}

function disc(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, ox: number, oy: number) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(ctx, ox + x, oy + y, 1, 1, color);
    }
  }
}

// ───────── kafelki 16×16 ─────────

function grass(ctx: Ctx, ox: number, oy: number) {
  px(ctx, ox, oy, 16, 16, '#5aa34a');
  speckle(ctx, ox, oy, 1, '#4c9140', '#6bb85a');
  for (const [x, y] of [
    [3, 4],
    [11, 11],
    [12, 3],
  ]) {
    px(ctx, ox + x, oy + y, 1, 2, '#447f39');
    px(ctx, ox + x + 1, oy + y - 1, 1, 2, '#447f39');
  }
}

function tallGrass(ctx: Ctx, ox: number, oy: number) {
  px(ctx, ox, oy, 16, 16, '#3f8a3a');
  speckle(ctx, ox, oy, 2, '#357a31', '#4d9a45', 0.1, 0.04);
  const clump = (x: number, y: number) => {
    px(ctx, ox + x, oy + y + 1, 1, 4, '#2c6a29');
    px(ctx, ox + x + 1, oy + y, 1, 5, '#2c6a29');
    px(ctx, ox + x + 2, oy + y + 1, 1, 4, '#2c6a29');
    px(ctx, ox + x + 1, oy + y, 1, 1, '#79c46a');
    px(ctx, ox + x, oy + y + 1, 1, 1, '#63b257');
    px(ctx, ox + x + 2, oy + y + 1, 1, 1, '#63b257');
  };
  clump(1, 1);
  clump(9, 0);
  clump(5, 6);
  clump(12, 8);
  clump(1, 10);
  clump(8, 11);
}

function path(ctx: Ctx, ox: number, oy: number) {
  px(ctx, ox, oy, 16, 16, '#c9b07a');
  speckle(ctx, ox, oy, 3, '#b39a64', '#dcc690', 0.07, 0.06);
  px(ctx, ox + 4, oy + 5, 2, 1, '#a88f5a');
  px(ctx, ox + 11, oy + 12, 2, 1, '#a88f5a');
}

function water(ctx: Ctx, ox: number, oy: number, frame: number) {
  px(ctx, ox, oy, 16, 16, '#3f7fd0');
  speckle(ctx, ox, oy, 4, '#3570bd', '#4a8ad9', 0.06, 0.05);
  const f = frame ? 2 : 0;
  px(ctx, ox + 2 + f, oy + 3, 4, 1, '#7fb2ec');
  px(ctx, ox + 9 - f, oy + 8, 5, 1, '#7fb2ec');
  px(ctx, ox + 3 + f, oy + 13, 4, 1, '#7fb2ec');
  px(ctx, ox + 12 - f, oy + 14, 2, 1, '#a9cdf3');
}

function sand(ctx: Ctx, ox: number, oy: number) {
  px(ctx, ox, oy, 16, 16, '#e3cf92');
  speckle(ctx, ox, oy, 5, '#cdb676', '#f0e2b0', 0.07, 0.06);
}

function rocky(ctx: Ctx, ox: number, oy: number) {
  px(ctx, ox, oy, 16, 16, '#a39377');
  speckle(ctx, ox, oy, 6, '#8d7e64', '#b8a98c', 0.09, 0.06);
  px(ctx, ox + 2, oy + 6, 3, 1, '#7d6f57');
  px(ctx, ox + 5, oy + 7, 1, 1, '#7d6f57');
  px(ctx, ox + 10, oy + 12, 3, 1, '#7d6f57');
}

function tree(ctx: Ctx, ox: number, oy: number) {
  grass(ctx, ox, oy);
  px(ctx, ox + 6, oy + 11, 4, 5, '#6b4a2b');
  px(ctx, ox + 6, oy + 11, 1, 5, '#57391f');
  disc(ctx, 8, 7, 7.5, 6.8, '#1f5a29', ox, oy);
  disc(ctx, 8, 6.6, 6.5, 5.8, '#2e7d3a', ox, oy);
  disc(ctx, 6, 4.6, 3, 2.4, '#3f9748', ox, oy);
  px(ctx, ox + 5, oy + 3, 2, 1, '#5cb563');
  px(ctx, ox + 11, oy + 9, 1, 1, '#24642e');
  px(ctx, ox + 4, oy + 9, 1, 1, '#24642e');
}

function boulder(ctx: Ctx, ox: number, oy: number) {
  rocky(ctx, ox, oy);
  disc(ctx, 8, 9.5, 7, 5.8, '#5d5b57', ox, oy);
  disc(ctx, 8, 9, 6, 5, '#8c8a85', ox, oy);
  disc(ctx, 6, 7, 2.8, 1.8, '#b2b0aa', ox, oy);
  px(ctx, ox + 9, oy + 9, 1, 3, '#6a6864');
  px(ctx, ox + 10, oy + 11, 2, 1, '#6a6864');
}

function flowers(ctx: Ctx, ox: number, oy: number) {
  grass(ctx, ox, oy);
  const flower = (x: number, y: number, c: string) => {
    px(ctx, ox + x, oy + y - 1, 1, 1, c);
    px(ctx, ox + x - 1, oy + y, 1, 1, c);
    px(ctx, ox + x + 1, oy + y, 1, 1, c);
    px(ctx, ox + x, oy + y + 1, 1, 1, c);
    px(ctx, ox + x, oy + y, 1, 1, '#c77d1a');
  };
  flower(3, 3, '#f4d35e');
  flower(11, 5, '#ef8fb5');
  flower(6, 10, '#ffffff');
  flower(13, 12, '#f4d35e');
  flower(2, 13, '#ef8fb5');
}

function roof(ctx: Ctx, ox: number, oy: number, base: string, line: string, edge: string) {
  px(ctx, ox, oy, 16, 16, base);
  for (let r = 0; r < 4; r++) {
    px(ctx, ox, oy + r * 4 + 3, 16, 1, line);
    const off = r % 2 === 0 ? 2 : 6;
    for (let x = off; x < 16; x += 8) px(ctx, ox + x, oy + r * 4, 1, 3, line);
  }
  px(ctx, ox, oy + 14, 16, 2, edge);
}

function heart(ctx: Ctx, ox: number, oy: number, color: string) {
  const rows = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') px(ctx, ox + x, oy + y, 1, 1, color);
  });
}

function careRoof(ctx: Ctx, ox: number, oy: number, emblem: boolean) {
  roof(ctx, ox, oy, '#57c7a4', '#3fa585', '#2f7f66');
  if (emblem) {
    disc(ctx, 8, 7, 6, 6, '#f7fff9', ox, oy);
    heart(ctx, ox + 5, oy + 5, '#e85d6a');
  }
}

function shopRoof(ctx: Ctx, ox: number, oy: number, emblem: boolean) {
  roof(ctx, ox, oy, '#e7a43c', '#c7862a', '#a96d1f');
  if (emblem) {
    disc(ctx, 8, 7, 6, 6, '#8a5a1b', ox, oy);
    disc(ctx, 8, 7, 5, 5, '#fff3c4', ox, oy);
    for (let i = 0; i < 3; i++) px(ctx, ox + 8 - i, oy + 5 + i, 1 + i * 2, 1, '#c7862a');
    for (let i = 0; i < 2; i++) px(ctx, ox + 7 + i, oy + 8 + i, 3 - i * 2, 1, '#c7862a');
  }
}

function wall(ctx: Ctx, ox: number, oy: number) {
  px(ctx, ox, oy, 16, 16, '#e8e1cf');
  px(ctx, ox, oy, 16, 2, '#c9bfa6');
  px(ctx, ox, oy + 14, 16, 2, '#b9ae95');
  px(ctx, ox + 4, oy + 5, 8, 6, '#6a5f4a');
  px(ctx, ox + 5, oy + 6, 6, 4, '#8fc3e3');
  px(ctx, ox + 5, oy + 6, 2, 1, '#d4ecf7');
  px(ctx, ox + 8, oy + 6, 1, 4, '#6a5f4a');
}

function door(ctx: Ctx, ox: number, oy: number, color: string, frame: string) {
  px(ctx, ox, oy, 16, 16, '#e8e1cf');
  px(ctx, ox, oy, 16, 2, '#c9bfa6');
  px(ctx, ox + 3, oy + 3, 10, 13, frame);
  px(ctx, ox + 4, oy + 4, 8, 12, color);
  px(ctx, ox + 8, oy + 4, 1, 12, frame);
  px(ctx, ox + 6, oy + 10, 1, 1, '#f2b84b');
  px(ctx, ox + 10, oy + 10, 1, 1, '#f2b84b');
  px(ctx, ox, oy + 15, 16, 1, '#b9ae95');
}

function sign(ctx: Ctx, ox: number, oy: number) {
  grass(ctx, ox, oy);
  px(ctx, ox + 7, oy + 9, 2, 7, '#6b4a2b');
  px(ctx, ox + 2, oy + 2, 12, 8, '#7a5530');
  px(ctx, ox + 3, oy + 3, 10, 6, '#c99b5f');
  px(ctx, ox + 4, oy + 4, 8, 1, '#8a6439');
  px(ctx, ox + 4, oy + 6, 6, 1, '#8a6439');
}

function fence(ctx: Ctx, ox: number, oy: number) {
  grass(ctx, ox, oy);
  px(ctx, ox, oy + 6, 16, 2, '#c9a46a');
  px(ctx, ox, oy + 11, 16, 2, '#c9a46a');
  px(ctx, ox, oy + 8, 16, 1, '#8f6c3a');
  px(ctx, ox, oy + 13, 16, 1, '#8f6c3a');
  for (const x of [2, 12]) {
    px(ctx, ox + x, oy + 4, 2, 11, '#9b7642');
    px(ctx, ox + x, oy + 4, 2, 1, '#c9a46a');
  }
}

function bridge(ctx: Ctx, ox: number, oy: number) {
  water(ctx, ox, oy, 0);
  px(ctx, ox + 1, oy, 14, 16, '#a87c4f');
  for (let y = 3; y < 16; y += 4) px(ctx, ox + 1, oy + y, 14, 1, '#7a5530');
  px(ctx, ox + 1, oy, 1, 16, '#6b4a2b');
  px(ctx, ox + 14, oy, 1, 16, '#6b4a2b');
}

/** Rysuje kafelek o danym indeksie (zgodnie z TILE_DEFS) w punkcie (ox, oy). */
export function drawTile(ctx: Ctx, index: number, ox: number, oy: number): void {
  switch (index) {
    case 0: return grass(ctx, ox, oy);
    case 1: return tallGrass(ctx, ox, oy);
    case 2: return path(ctx, ox, oy);
    case 3: return water(ctx, ox, oy, 0);
    case 4: return water(ctx, ox, oy, 1);
    case 5: return sand(ctx, ox, oy);
    case 6: return tree(ctx, ox, oy);
    case 7: return boulder(ctx, ox, oy);
    case 8: return rocky(ctx, ox, oy);
    case 9: return flowers(ctx, ox, oy);
    case 10: return careRoof(ctx, ox, oy, false);
    case 11: return careRoof(ctx, ox, oy, true);
    case 12: return wall(ctx, ox, oy);
    case 13: return door(ctx, ox, oy, '#3e7f6f', '#2b5a4f');
    case 14: return shopRoof(ctx, ox, oy, false);
    case 15: return shopRoof(ctx, ox, oy, true);
    case 16: return door(ctx, ox, oy, '#8a5a2b', '#5e3c1c');
    case 17: return sign(ctx, ox, oy);
    case 18: return fence(ctx, ox, oy);
    case 19: return bridge(ctx, ox, oy);
    default: return grass(ctx, ox, oy);
  }
}

// ───────── postać gracza 16×16 (oryginalny „Tropiciel”) ─────────

const HERO_PALETTE: Record<string, string> = {
  k: '#1d2a2b',
  h: '#f2b84b',
  H: '#c98f2e',
  b: '#8a3b2f',
  s: '#f1c9a0',
  S: '#d9a77d',
  e: '#1d2a2b',
  r: '#6b4a2b',
  w: '#e85d4a',
  j: '#2f8f83',
  J: '#236c63',
  g: '#8b6b43',
  p: '#34404d',
  o: '#5a3b25',
};

const HERO_HEAD = ['................', '.....kkkkkk.....', '....khhhhhhk....', '...khhhhhhhhk...'];

export const HERO_FRAMES: Record<string, string[]> = {
  'down-0': [
    ...HERO_HEAD,
    '..kbbbbbbbbbbk..',
    '.kHHHHHHHHHHHHk.',
    '..kssssssssssk..',
    '..kssessssessk..',
    '..kSssssssssSk..',
    '...kkwwwwwwkk...',
    '..kjjwwjjjjjjk..',
    '.ksjjjjjjjjjjsk.',
    '..kJjjjjjjjjJk..',
    '..kppppppppppk..',
    '..kppk....kppk..',
    '..kook....kook..',
  ],
  'down-1': [
    ...HERO_HEAD,
    '..kbbbbbbbbbbk..',
    '.kHHHHHHHHHHHHk.',
    '..kssssssssssk..',
    '..kssessssessk..',
    '..kSssssssssSk..',
    '...kkwwwwwwkk...',
    '..kjjwwjjjjjjk..',
    '.ksjjjjjjjjjjsk.',
    '..kJjjjjjjjjJk..',
    '..kppppppppppk..',
    '..kppk....kppk..',
    '..kkkk....kook..',
  ],
  'up-0': [
    ...HERO_HEAD,
    '..kbbbbbbbbbbk..',
    '.kHHHHHHHHHHHHk.',
    '..krrrrrrrrrrk..',
    '..krrrrrrrrrrk..',
    '...kSSSSSSSSk...',
    '...kkwwwwwwkk...',
    '..kjggggggggjk..',
    '.ksjggggggggjsk.',
    '..kJggggggggJk..',
    '..kppppppppppk..',
    '..kppk....kppk..',
    '..kook....kook..',
  ],
  'up-1': [
    ...HERO_HEAD,
    '..kbbbbbbbbbbk..',
    '.kHHHHHHHHHHHHk.',
    '..krrrrrrrrrrk..',
    '..krrrrrrrrrrk..',
    '...kSSSSSSSSk...',
    '...kkwwwwwwkk...',
    '..kjggggggggjk..',
    '.ksjggggggggjsk.',
    '..kJggggggggJk..',
    '..kppppppppppk..',
    '..kppk....kppk..',
    '..kkkk....kook..',
  ],
  'right-0': [
    ...HERO_HEAD,
    '...kbbbbbbbbbk..',
    '..kHHHHHHHHHHHHk',
    '...krrssssssk...',
    '...krsssssesk...',
    '...krSssssssk...',
    '....kwwwwwwk....',
    '...kggjjjjjjk...',
    '...kggjjjjsjk...',
    '...kggJjjjjJk...',
    '....kppppppk....',
    '....kppkkppk....',
    '....kookkook....',
  ],
  'right-1': [
    ...HERO_HEAD,
    '...kbbbbbbbbbk..',
    '..kHHHHHHHHHHHHk',
    '...krrssssssk...',
    '...krsssssesk...',
    '...krSssssssk...',
    '....kwwwwwwk....',
    '...kggjjjjjjk...',
    '...kggjjjjsjk...',
    '...kggJjjjjJk...',
    '....kppppppk....',
    '...kppk..kppk...',
    '..kook....kook..',
  ],
};

export function drawHero(ctx: Ctx, frame: string, ox = 0, oy = 0, palette: Partial<Record<string, string>> = {}): void {
  const rows = HERO_FRAMES[frame] ?? HERO_FRAMES['down-0'];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = palette[row[x]] ?? HERO_PALETTE[row[x]];
      if (c) px(ctx, ox + x, oy + y, 1, 1, c);
    }
  });
}

/** Trenerzy (Sprint 5): ta sama oryginalna postać co gracz, w innych barwach. */
export const TRAINER_PALETTES: Record<'scout' | 'herbalist' | 'warden', Partial<Record<string, string>>> = {
  scout: { h: '#4f7a3a', H: '#3b5c2b', b: '#2f4a24', w: '#f2d14b', j: '#7a5230', J: '#5c3d24', g: '#4a5a2f' },
  herbalist: { h: '#8e5bb5', H: '#6a3f8c', b: '#4d2a66', r: '#2b1d14', w: '#5fb87a', j: '#c96a8b', J: '#9c4d68', g: '#6b8f3e' },
  // Liderka Próby Wiatru: błękitna peleryna i srebrne włosy.
  warden: { h: '#5aa9d6', H: '#3f84ad', b: '#2c5f80', r: '#c9cdd6', w: '#f4f4f4', j: '#3b6fa0', J: '#2a5279', g: '#41566e' },
};

// ───────── zwalone drzewo 16×16 (Sprint 6): przeszkoda na zamkniętym przejściu ─────────

/** Leżący pień z gałązkami (oryginalny rysunek) — widoczny, dopóki przejście nie zostanie odblokowane. */
export function drawFallenTree(ctx: Ctx, ox = 0, oy = 0): void {
  const bark = '#6b4a2b';
  const barkDark = '#4a321c';
  const barkLight = '#8a6239';
  const ring = '#c9a36a';
  px(ctx, ox + 1, oy + 7, 14, 6, barkDark);
  px(ctx, ox + 1, oy + 8, 14, 4, bark);
  px(ctx, ox + 2, oy + 8, 11, 1, barkLight);
  for (const x of [4, 8, 11]) px(ctx, ox + x, oy + 10, 1, 2, barkDark);
  // słoje na ściętym końcu
  px(ctx, ox + 13, oy + 7, 3, 6, barkDark);
  px(ctx, ox + 14, oy + 8, 1, 4, ring);
  // gałązki z liśćmi
  px(ctx, ox + 3, oy + 4, 1, 3, barkDark);
  px(ctx, ox + 9, oy + 5, 1, 2, barkDark);
  px(ctx, ox + 1, oy + 2, 4, 3, '#3f7a35');
  px(ctx, ox + 2, oy + 1, 2, 1, '#5a9a47');
  px(ctx, ox + 8, oy + 3, 3, 2, '#3f7a35');
  px(ctx, ox + 9, oy + 2, 1, 1, '#5a9a47');
  // cień
  px(ctx, ox + 2, oy + 13, 12, 1, 'rgba(0,0,0,0.25)');
}

// ───────── odkryte ukryte wejście 16×16 (Sprint 7): ciemna szczelina w skale ─────────

/** Ciemna szczelina z chłodnym poblaskiem (oryginalny rysunek) — nakładana na głaz po odkryciu ukrytej lokacji. */
export function drawHiddenEntrance(ctx: Ctx, ox = 0, oy = 0): void {
  px(ctx, ox + 6, oy + 4, 4, 10, '#1b1d24');
  px(ctx, ox + 5, oy + 6, 6, 7, '#1b1d24');
  px(ctx, ox + 7, oy + 3, 2, 1, '#1b1d24');
  px(ctx, ox + 7, oy + 6, 2, 6, '#2d3442');
  px(ctx, ox + 7, oy + 8, 1, 3, '#5d7a9c');
  px(ctx, ox + 4, oy + 13, 8, 1, '#3a3d44');
}

// ───────── zastępcza sylwetka stworzenia 32×32 (oryginalna) ─────────

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function drawBlob(ctx: Ctx, color: string, ox = 0, oy = 0, back = false): void {
  disc(ctx, 16, 20, 13, 11, shade(color, -0.35), ox, oy);
  disc(ctx, 16, 20, 12, 10, color, ox, oy);
  disc(ctx, 12, 16, 5, 3.5, shade(color, 0.18), ox, oy);
  // „uszka” / grzebień — prosty, neutralny kształt
  disc(ctx, 9, 10, 3, 4, shade(color, -0.35), ox, oy);
  disc(ctx, 9, 10.5, 2, 3, color, ox, oy);
  disc(ctx, 23, 10, 3, 4, shade(color, -0.35), ox, oy);
  disc(ctx, 23, 10.5, 2, 3, color, ox, oy);
  if (!back) {
    px(ctx, ox + 11, oy + 18, 3, 4, '#ffffff');
    px(ctx, ox + 18, oy + 18, 3, 4, '#ffffff');
    px(ctx, ox + 12, oy + 19, 2, 3, '#1d2a2b');
    px(ctx, ox + 19, oy + 19, 2, 3, '#1d2a2b');
    px(ctx, ox + 15, oy + 24, 2, 1, shade(color, -0.45));
  }
  px(ctx, ox + 7, oy + 29, 18, 1, shade(color, -0.45));
}
