import { describe, expect, it } from 'vitest';
import {
  ENCOUNTER_CONFIG,
  ENCOUNTER_TABLES,
  TERRAIN_METHOD,
  TERRAIN_TYPES,
  staticDoneFlag,
  type EncounterEntry,
} from '../../config/encounters';
import { createRng, createSequenceRng, rngFromNext, type Rng } from '../../engine/rng';
import {
  activeStaticEncounters,
  assertAllowedSpecies,
  conditionsMet,
  eligibleEntries,
  encounterZoneAt,
  evaluateEncounterStep,
  pickEncounterEntry,
  rollLevel,
  terrainAt,
  type StepEncounterState,
} from '../encounterZones';
import { TEST_MAP } from '../maps/testMap';
import { isWalkable } from '../movement';

const grid = TEST_MAP.layout.map((row) => row.split(''));
const MEADOW = TEST_MAP.zones.find((z) => z.id === 'meadow')!;
const ROCKS = TEST_MAP.zones.find((z) => z.id === 'rocks')!;
const explore = (over: Partial<StepEncounterState> = {}): StepEncounterState => ({
  gameMode: 'EXPLORATION',
  activeEncounterId: null,
  cooldown: 0,
  progress: 0,
  ...over,
});

/** Licznik rzutów: każde next() to jeden rzut. */
function countingRng(value: number): Rng & { calls: number } {
  const r = { calls: 0 } as Rng & { calls: number };
  Object.assign(r, rngFromNext(() => {
    r.calls += 1;
    return value;
  }));
  return r;
}

function findTile(pred: (x: number, y: number) => boolean): { x: number; y: number } {
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[0].length; x++) if (pred(x, y)) return { x, y };
  throw new Error('brak kafelka');
}

describe('tereny i strefy Polany Startowej', () => {
  it('teren kafelka: wysoka trawa, skalisty grunt (jaskinia), woda, zwykłe pola', () => {
    expect(terrainAt([[',']], 0, 0)).toBe('TALL_GRASS');
    expect(terrainAt([['r']], 0, 0)).toBe('CAVE');
    expect(terrainAt([['~']], 0, 0)).toBe('WATER');
    for (const ch of ['.', '=', 's', 'f', 'B']) expect(terrainAt([[ch]], 0, 0)).toBe('NONE');
    expect(terrainAt([['.']], 5, 5)).toBe('NONE'); // poza mapą
  });

  it('wysoka trawa Łąki to strefa spotkań z domyślną szansą 10%', () => {
    const g = findTile((x, y) => grid[y][x] === ',' && x >= 18 && x < 38 && y >= 2 && y < 13);
    const z = encounterZoneAt(TEST_MAP, grid, g.x, g.y, {});
    expect(z?.id).toBe('meadow');
    expect(z?.terrainType).toBe('TALL_GRASS');
    expect(z?.baseEncounterRate).toBe(0.1);
  });

  it('bezpieczna strefa: osada, ścieżki i zwykła trawa nie mają spotkań', () => {
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x <= 16; x++) {
        if (y <= 16 && isWalkable(grid, x, y)) expect(encounterZoneAt(TEST_MAP, grid, x, y, {})).toBeNull();
      }
    }
    expect(encounterZoneAt(TEST_MAP, grid, TEST_MAP.spawn.x, TEST_MAP.spawn.y, {})).toBeNull();
    expect(encounterZoneAt(TEST_MAP, grid, TEST_MAP.healReturn.x, TEST_MAP.healReturn.y, {})).toBeNull();
    // Zwykła trawa wewnątrz prostokąta Łąki też jest bezpieczna.
    const plain = findTile((x, y) => grid[y][x] === '.' && x >= 18 && x < 38 && y >= 2 && y < 13);
    expect(encounterZoneAt(TEST_MAP, grid, plain.x, plain.y, {})).toBeNull();
  });

  it('skalisty grunt Skalnego Zakątka to teren CAVE z szansą 8%', () => {
    const r = findTile((x, y) => grid[y][x] === 'r' && x >= 24 && y >= 18 && y < 24);
    const z = encounterZoneAt(TEST_MAP, grid, r.x, r.y, {});
    expect(z?.id).toBe('rocks');
    expect(z?.baseEncounterRate).toBe(0.08);
    expect(ROCKS.terrainType).toBe('CAVE');
  });

  it('warunki strefy i wpisów działają na flagach zapisu', () => {
    expect(conditionsMet(undefined, {})).toBe(true);
    expect(conditionsMet({ flagsAll: ['a'] }, {})).toBe(false);
    expect(conditionsMet({ flagsAll: ['a'] }, { a: true })).toBe(true);
    expect(conditionsMet({ flagsNone: ['b'] }, { b: true })).toBe(false);
    const g = findTile((x, y) => grid[y][x] === ',' && x >= 18 && x < 38 && y >= 2 && y < 13);
    const gated = { zones: [{ ...MEADOW, conditions: { flagsAll: ['laka-otwarta'] } }] };
    expect(encounterZoneAt(gated, grid, g.x, g.y, {})).toBeNull();
    expect(encounterZoneAt(gated, grid, g.x, g.y, { 'laka-otwarta': true })?.id).toBe('meadow');
  });
});

describe('losowanie po kroku', () => {
  it('brak losowania poza trawą (teren bez spotkań)', () => {
    const rng = countingRng(0);
    const d = evaluateEncounterStep(explore(), { movedToNewTile: true, zone: null }, rng);
    expect(d).toMatchObject({ rolled: false, hit: false, reason: 'no-terrain' });
    expect(rng.calls).toBe(0);
  });

  it('brak losowania przy staniu i obrocie w miejscu', () => {
    const rng = countingRng(0);
    for (let i = 0; i < 50; i++) {
      const d = evaluateEncounterStep(explore(), { movedToNewTile: false, zone: MEADOW }, rng);
      expect(d.rolled).toBe(false);
    }
    expect(rng.calls).toBe(0);
  });

  it('maksymalnie jedno losowanie na krok', () => {
    for (const v of [0, 0.05, 0.5, 0.999]) {
      const rng = countingRng(v);
      const d = evaluateEncounterStep(explore(), { movedToNewTile: true, zone: MEADOW }, rng);
      expect(d.rolled).toBe(true);
      expect(rng.calls).toBe(1);
      expect(d.hit).toBe(v < 0.1);
    }
  });

  it('brak losowania podczas walki, przejścia i kończenia spotkania', () => {
    for (const gameMode of ['ENCOUNTER_STARTING', 'BATTLE', 'ENCOUNTER_ENDING']) {
      const rng = countingRng(0);
      const d = evaluateEncounterStep(explore({ gameMode, cooldown: 2, progress: 0 }), { movedToNewTile: true, zone: MEADOW }, rng);
      expect(d).toMatchObject({ rolled: false, reason: 'blocked', cooldown: 2 });
      expect(rng.calls).toBe(0);
    }
    const rng = countingRng(0);
    expect(evaluateEncounterStep(explore({ activeEncounterId: 'enc-1' }), { movedToNewTile: true, zone: MEADOW }, rng).rolled).toBe(false);
    expect(rng.calls).toBe(0);
  });

  it('brak losowania podczas odnowienia; każdy poprawny krok zmniejsza odnowienie o 1', () => {
    const rng = countingRng(0);
    let state = explore({ cooldown: ENCOUNTER_CONFIG.cooldownSteps });
    const seen: number[] = [];
    for (let i = 0; i < ENCOUNTER_CONFIG.cooldownSteps; i++) {
      const d = evaluateEncounterStep(state, { movedToNewTile: true, zone: MEADOW }, rng);
      expect(d).toMatchObject({ rolled: false, reason: 'cooldown' });
      seen.push(d.cooldown);
      state = { ...state, cooldown: d.cooldown, progress: d.progress };
    }
    expect(seen).toEqual([2, 1, 0]);
    expect(rng.calls).toBe(0);
    // Po odnowieniu — normalny rzut.
    expect(evaluateEncounterStep(state, { movedToNewTile: true, zone: MEADOW }, rng)).toMatchObject({ rolled: true, hit: true });
    // Stanie w miejscu nie zmniejsza odnowienia.
    expect(evaluateEncounterStep(explore({ cooldown: 3 }), { movedToNewTile: false, zone: MEADOW }, rng).cooldown).toBe(3);
  });

  it('domyślna konfiguracja: trawa 10%, jaskinia 8%, woda 8%, odnowienie 3 kroki, 2 kroki ochronne', () => {
    expect(ENCOUNTER_CONFIG.baseRates).toMatchObject({ TALL_GRASS: 0.1, CAVE: 0.08, WATER: 0.08, NONE: 0, SPECIAL: 0 });
    expect(ENCOUNTER_CONFIG.cooldownSteps).toBe(3);
    expect(ENCOUNTER_CONFIG.mapEnterSafeSteps).toBe(2);
    const water = { baseEncounterRate: ENCOUNTER_CONFIG.baseRates.WATER, stepDistance: 1 };
    expect(evaluateEncounterStep(explore(), { movedToNewTile: true, zone: water }, createSequenceRng([0.079])).hit).toBe(true);
    expect(evaluateEncounterStep(explore(), { movedToNewTile: true, zone: water }, createSequenceRng([0.08])).hit).toBe(false);
  });

  it('stepDistance: rzut dopiero po wymaganym dystansie', () => {
    const zone = { baseEncounterRate: 1, stepDistance: 3 };
    const rng = countingRng(0);
    let state = explore();
    const reasons: string[] = [];
    for (let i = 0; i < 6; i++) {
      const d = evaluateEncounterStep(state, { movedToNewTile: true, zone }, rng);
      reasons.push(d.reason);
      state = { ...state, cooldown: d.cooldown, progress: d.progress };
    }
    expect(reasons).toEqual(['distance', 'distance', 'hit', 'distance', 'distance', 'hit']);
    expect(rng.calls).toBe(2);
  });

  it('częstość spotkań w trawie ≈ 10% (ziarno — wynik powtarzalny)', () => {
    const run = () => {
      const rng = createRng(2026);
      let hits = 0;
      for (let i = 0; i < 20000; i++) if (evaluateEncounterStep(explore(), { movedToNewTile: true, zone: MEADOW }, rng).hit) hits++;
      return hits;
    };
    const hits = run();
    expect(hits / 20000).toBeGreaterThan(0.09);
    expect(hits / 20000).toBeLessThan(0.11);
    expect(run()).toBe(hits);
  });
});

describe('tabele spotkań', () => {
  const entry = (pokemonId: string, weight: number, extra: Partial<EncounterEntry> = {}): EncounterEntry => ({
    pokemonId,
    weight,
    minLevel: 2,
    maxLevel: 4,
    encounterMethod: 'grass',
    rarity: 'common',
    ...extra,
  });

  it('ważony wybór działa, gdy suma wag nie wynosi 100', () => {
    const entries = [entry('a', 1), entry('b', 3), entry('c', 0)];
    const rng = createRng(99);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 40000; i++) counts[pickEncounterEntry(entries, rng).pokemonId]++;
    expect(counts.c).toBe(0);
    expect(counts.a / 40000).toBeGreaterThan(0.23);
    expect(counts.a / 40000).toBeLessThan(0.27);
    expect(counts.b / 40000).toBeGreaterThan(0.73);
    // Granice: rzut 0 → pierwszy wpis, rzut tuż pod 1 → ostatni z dodatnią wagą.
    expect(pickEncounterEntry(entries, createSequenceRng([0])).pokemonId).toBe('a');
    expect(pickEncounterEntry(entries, createSequenceRng([0.9999])).pokemonId).toBe('b');
    expect(() => pickEncounterEntry([], rng)).toThrow();
  });

  it('tabela testowa Łąki: wagi sumują się do 36, a rozkład odpowiada wagom', () => {
    const table = ENCOUNTER_TABLES.meadow;
    const total = table.entries.reduce((s, e) => s + e.weight, 0);
    expect(total).toBe(36);
    const rng = createRng(7);
    const counts = new Map<string, number>();
    const N = 36000;
    for (let i = 0; i < N; i++) {
      const e = pickEncounterEntry(eligibleEntries(table, 'grass', {}), rng);
      counts.set(e.pokemonId, (counts.get(e.pokemonId) ?? 0) + 1);
    }
    for (const e of table.entries) expect(Math.abs((counts.get(e.pokemonId) ?? 0) / N - e.weight / total)).toBeLessThan(0.015);
  });

  it('zakres poziomów: zawsze w [min, max], oba końce osiągalne', () => {
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const lv = rollLevel({ minLevel: 3, maxLevel: 5 }, rng);
      expect(lv).toBeGreaterThanOrEqual(3);
      expect(lv).toBeLessThanOrEqual(5);
      seen.add(lv);
    }
    expect([...seen].sort()).toEqual([3, 4, 5]);
    expect(rollLevel({ minLevel: 7, maxLevel: 7 }, rng)).toBe(7);
  });

  it('wpisy filtrowane po metodzie spotkania i warunkach', () => {
    const table = { id: 't', entries: [entry('g', 1), entry('c', 1, { encounterMethod: 'cave' }), entry('f', 1, { conditions: { flagsAll: ['x'] } })] };
    expect(eligibleEntries(table, 'grass', {}).map((e) => e.pokemonId)).toEqual(['g']);
    expect(eligibleEntries(table, 'grass', { x: true }).map((e) => e.pokemonId)).toEqual(['g', 'f']);
    expect(eligibleEntries(table, 'cave', {}).map((e) => e.pokemonId)).toEqual(['c']);
  });

  it('konfiguracja jest spójna: wpisy, metody, strefy i tabele', () => {
    const methods = new Set(Object.values(TERRAIN_METHOD).filter(Boolean));
    for (const table of Object.values(ENCOUNTER_TABLES)) {
      expect(table.entries.length).toBeGreaterThan(0);
      for (const e of table.entries) {
        expect(e.weight).toBeGreaterThan(0);
        expect(e.minLevel).toBeGreaterThanOrEqual(1);
        expect(e.maxLevel).toBeGreaterThanOrEqual(e.minLevel);
        expect(e.maxLevel).toBeLessThanOrEqual(100);
        expect(methods.has(e.encounterMethod)).toBe(true);
        expect(['common', 'uncommon', 'rare', 'very-rare']).toContain(e.rarity);
      }
    }
    for (const z of TEST_MAP.zones) {
      expect(TERRAIN_TYPES).toContain(z.terrainType);
      expect(z.locationId).toBeTruthy();
      expect(z.stepDistance).toBeGreaterThanOrEqual(1);
      expect(z.baseEncounterRate).toBe(ENCOUNTER_CONFIG.baseRates[z.terrainType]);
      const method = TERRAIN_METHOD[z.terrainType]!;
      expect(eligibleEntries(ENCOUNTER_TABLES[z.encounterTableId], method, {}).length).toBeGreaterThan(0);
    }
  });

  it('zwykłe tabele nie zawierają stworzeń legendarnych ani mitycznych', () => {
    // Lista kontrolna gatunków legendarnych/mitycznych (fragment) + blokada w kodzie przy budowaniu stworzenia.
    const banned = ['articuno', 'zapdos', 'moltres', 'mewtwo', 'mew', 'raikou', 'entei', 'suicune', 'lugia', 'ho-oh', 'celebi', 'latias', 'latios', 'kyogre', 'groudon', 'rayquaza', 'jirachi', 'deoxys', 'dialga', 'palkia', 'giratina', 'arceus', 'zekrom', 'reshiram', 'kyurem', 'xerneas', 'yveltal', 'zygarde', 'solgaleo', 'lunala', 'necrozma', 'zacian', 'zamazenta', 'eternatus', 'koraidon', 'miraidon'];
    for (const t of Object.values(ENCOUNTER_TABLES)) for (const e of t.entries) expect(banned).not.toContain(e.pokemonId);
    expect(() => assertAllowedSpecies({ name: 'lugia', isLegendary: true, isMythical: false }, 'grass')).toThrow();
    expect(() => assertAllowedSpecies({ name: 'mew', isLegendary: false, isMythical: true }, 'cave')).toThrow();
    expect(() => assertAllowedSpecies({ name: 'pidgey', isLegendary: false, isMythical: false }, 'grass')).not.toThrow();
  });
});

describe('spotkanie specjalne (statyczne)', () => {
  it('Strażnik Cichego Gaju stoi na wolnym polu w Gaju i znika po ustawieniu flagi', () => {
    const [guard] = TEST_MAP.staticEncounters;
    expect(guard.terrainType).toBe('SPECIAL');
    expect(isWalkable(grid, guard.x, guard.y)).toBe(true);
    expect(TEST_MAP.zones.find((z) => z.id === guard.zoneId)?.name).toBe('Cichy Gaj');
    expect(eligibleEntries(ENCOUNTER_TABLES[guard.encounterTableId], 'static', {})).toHaveLength(1);
    expect(activeStaticEncounters(TEST_MAP, {}).map((s) => s.id)).toEqual(['gaj-straznik']);
    expect(activeStaticEncounters(TEST_MAP, { [staticDoneFlag('gaj-straznik')]: true })).toHaveLength(0);
  });

  it('pole stworzenia specjalnego nie losuje spotkań (teren SPECIAL, szansa 0)', () => {
    expect(ENCOUNTER_CONFIG.baseRates.SPECIAL).toBe(0);
    expect(TERRAIN_METHOD.SPECIAL).toBe('static');
    // Zwykłe tabele nie mają wpisów „static”, a tabela strażnika ma tylko je.
    for (const id of ['meadow', 'pond', 'rocks', 'grove']) expect(eligibleEntries(ENCOUNTER_TABLES[id], 'static', {})).toHaveLength(0);
  });
});
