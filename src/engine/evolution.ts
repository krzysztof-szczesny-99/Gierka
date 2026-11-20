// Ewolucje (Sprint 4): lokalny model łańcucha ewolucji (przetworzony z PokéAPI /evolution-chain),
// ocena warunków dla konkretnego stworzenia i sama przemiana (czyste funkcje — testy bez sieci).
//
// Obsługiwane warunki: poziom (level-up + min_level) i przedmiot (use-item), oba opcjonalnie z płcią.
// Wszystko inne (przyjaźń, pora dnia, miejsce, wymiana, znany ruch, formy regionalne…) ma status
// NOT_IMPLEMENTED z opisem powodu — gra tego nie udaje.

import { evolutionItemForApi, type EvolutionItemId } from '../config/items';
import { formDisplayName } from './creature';
import { calcStats } from './stats';
import type { Creature, Gender, PokemonData, SpeciesData } from './types';

export type EvolutionMethod = 'LEVEL' | 'ITEM' | 'NOT_IMPLEMENTED';

/** Jedna droga ewolucji z łańcucha: gatunek → gatunek. */
export interface EvolutionOption {
  from: string;
  to: string;
  toSpeciesId: number;
  method: EvolutionMethod;
  minLevel: number | null;
  /** Nazwa przedmiotu w PokéAPI (metoda ITEM). */
  itemApi: string | null;
  /** Wymagana płeć (null — dowolna). */
  gender: Gender | null;
  /** Opis nieobsługiwanych warunków (metoda NOT_IMPLEMENTED). */
  unsupported: string[];
  /** Forma, której dotyczy ta droga (PokéAPI required_pokemon_form), np. „rattata-alola”. */
  requiredForm: string | null;
  /** Wpis oznaczony w PokéAPI jako domyślny (is_default) — przy kilku wersjach gier wybieramy go. */
  preferred: boolean;
}

export interface EvolutionChainData {
  id: number;
  options: EvolutionOption[];
}

// ───────────────────────────── normalizacja z PokéAPI ─────────────────────────────

interface RawRef {
  name: string;
  url: string;
}
export interface RawEvolutionDetail {
  trigger: RawRef | null;
  min_level?: number | null;
  item?: RawRef | null;
  gender?: number | null;
  /** Metadane wersji gier (nie są warunkiem). */
  version_group?: RawRef | null;
  is_default?: boolean | null;
  required_pokemon_form?: RawRef | null;
  evolved_pokemon_form?: RawRef | null;
  [key: string]: unknown;
}
export interface RawChainLink {
  species: RawRef;
  evolution_details: RawEvolutionDetail[];
  evolves_to: RawChainLink[];
}
export interface RawEvolutionChain {
  id: number;
  chain: RawChainLink;
}

/** Polskie opisy warunków, których silnik jeszcze nie obsługuje. */
const CONDITION_LABEL: Record<string, string> = {
  min_happiness: 'przyjaźń',
  min_affection: 'więź',
  min_beauty: 'piękno',
  time_of_day: 'pora dnia',
  location: 'miejsce',
  known_move: 'znany ruch',
  known_move_type: 'typ znanego ruchu',
  held_item: 'trzymany przedmiot',
  party_species: 'gatunek w drużynie',
  party_type: 'typ w drużynie',
  relative_physical_stats: 'stosunek ataku do obrony',
  needs_overworld_rain: 'deszcz',
  trade_species: 'wymiana',
  turn_upside_down: 'odwrócenie urządzenia',
  near_special_rock: 'specjalny kamień w pobliżu',
  needs_multiplayer: 'gra wieloosobowa',
  min_steps: 'liczba kroków',
  min_move_count: 'liczba użyć ruchu',
  min_damage_taken: 'otrzymane obrażenia',
  used_move: 'użyty ruch',
  allowed_natures: 'natura',
  region: 'region',
  condition_expression: 'złożony warunek',
};
const TRIGGER_LABEL: Record<string, string> = {
  trade: 'wymiana',
  shed: 'zrzucenie skorupy',
  spin: 'obrót',
  'three-critical-hits': 'trzy trafienia krytyczne',
  'take-damage': 'otrzymane obrażenia',
};
/**
 * Pola szczegółu, które model obsługuje albo które są metadanymi wersji gier (version_group, is_default).
 * Każde inne ustawione pole to warunek, którego silnik jeszcze nie obsługuje.
 */
const HANDLED = new Set(['trigger', 'min_level', 'item', 'gender', 'version_group', 'is_default', 'required_pokemon_form', 'evolved_pokemon_form']);

const isSet = (v: unknown) => v !== null && v !== undefined && v !== false && v !== '' && !(Array.isArray(v) && v.length === 0);
const speciesIdFromUrl = (url: string) => Number(/\/(\d+)\/?$/.exec(url)?.[1] ?? 0);

/** Jeden szczegół PokéAPI → jedna opcja lokalnego modelu. */
export function normalizeEvolutionDetail(from: string, to: RawRef, d: RawEvolutionDetail): EvolutionOption {
  const unsupported: string[] = [];
  for (const [key, value] of Object.entries(d)) {
    if (HANDLED.has(key) || !isSet(value)) continue;
    unsupported.push(CONDITION_LABEL[key] ?? key.replace(/_/g, ' '));
  }
  // Ewolucja do innej formy niż domyślna gatunku docelowego (np. forma regionalna) — jeszcze nieobsługiwana.
  const evolvedForm = d.evolved_pokemon_form?.name ?? null;
  if (evolvedForm && evolvedForm !== to.name) unsupported.push('forma docelowa');
  const trigger = d.trigger?.name ?? '';
  const gender: Gender | null = d.gender === 1 ? 'F' : d.gender === 2 ? 'M' : null;
  const base = {
    from,
    to: to.name,
    toSpeciesId: speciesIdFromUrl(to.url),
    gender,
    minLevel: d.min_level ?? null,
    itemApi: d.item?.name ?? null,
    requiredForm: d.required_pokemon_form?.name ?? null,
    preferred: d.is_default === true,
  };
  if (trigger === 'level-up' && d.min_level && !unsupported.length) return { ...base, method: 'LEVEL', unsupported };
  if (trigger === 'use-item' && d.item && !unsupported.length) return { ...base, method: 'ITEM', unsupported };
  if (trigger === 'level-up' && !d.min_level && !unsupported.length) unsupported.push('awans bez określonego poziomu');
  if (trigger !== 'level-up' && trigger !== 'use-item') unsupported.unshift(TRIGGER_LABEL[trigger] ?? (trigger || 'nieznany warunek'));
  return { ...base, method: 'NOT_IMPLEMENTED', unsupported };
}

/**
 * Cały łańcuch → lokalne opcje. PokéAPI podaje osobne szczegóły dla różnych wersji gier, więc:
 * identyczne opcje łączymy, a gdy do danego gatunku (i formy) prowadzi obsługiwana droga, pomijamy
 * nieobsługiwane alternatywy (np. Leafeon: kamień zamiast „miejsca”). Bez obsługiwanej drogi zostaje
 * jedna opcja NOT_IMPLEMENTED (preferowana ta oznaczona jako domyślna).
 */
export function normalizeEvolutionChain(raw: RawEvolutionChain): EvolutionChainData {
  const all: EvolutionOption[] = [];
  const walk = (link: RawChainLink) => {
    for (const next of link.evolves_to) {
      const details = next.evolution_details.length ? next.evolution_details : [{ trigger: null } as RawEvolutionDetail];
      for (const d of details) all.push(normalizeEvolutionDetail(link.species.name, next.species, d));
      walk(next);
    }
  };
  walk(raw.chain);

  const unique = new Map<string, EvolutionOption>();
  for (const o of all) {
    const key = JSON.stringify([o.from, o.to, o.requiredForm, o.method, o.minLevel, o.itemApi, o.gender, o.unsupported]);
    const prev = unique.get(key);
    if (prev) prev.preferred = prev.preferred || o.preferred;
    else unique.set(key, { ...o });
  }
  const groups = new Map<string, EvolutionOption[]>();
  for (const o of unique.values()) {
    const key = JSON.stringify([o.from, o.to, o.requiredForm]);
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const options: EvolutionOption[] = [];
  for (const group of groups.values()) {
    const supported = group.filter((o) => o.method !== 'NOT_IMPLEMENTED');
    if (supported.length) options.push(...supported);
    else options.push(group.find((o) => o.preferred) ?? group[0]);
  }
  return { id: raw.id, options };
}

const REGIONAL_FORM = /-(alola|galar|hisui|paldea)\b/;

/** Czy droga dotyczy formy tego stworzenia (required_pokemon_form). */
function formMatches(option: EvolutionOption, pokemonName: string, isDefaultForm: boolean): boolean {
  const req = option.requiredForm;
  if (!req || req === pokemonName) return true;
  // Forma domyślna może mieć nazwę formy z dopiskiem (np. „burmy-plant”) — ale nie formę regionalną.
  return isDefaultForm && !REGIONAL_FORM.test(req);
}

// ───────────────────────────── ocena warunków ─────────────────────────────

export type EvolutionStatus = 'READY' | 'WAITING' | 'NEEDS_ITEM' | 'NOT_IMPLEMENTED';

export interface EvolutionCheck {
  option: EvolutionOption;
  status: EvolutionStatus;
  /** Lokalny przedmiot dla metody ITEM. */
  itemId: EvolutionItemId | null;
  /** Krótki opis warunku po polsku. */
  condition: string;
}

/**
 * Drogi ewolucji dostępne dla stworzenia (gatunek `speciesName`). Formy inne niż domyślna (regionalne)
 * nie ewoluują w tej wersji — mają status NOT_IMPLEMENTED. Drogi wykluczone płcią są pomijane.
 */
export function evaluateEvolutions(
  c: Pick<Creature, 'level' | 'gender' | 'pokemon'>,
  speciesName: string,
  isDefaultForm: boolean,
  chain: EvolutionChainData,
): EvolutionCheck[] {
  const out: EvolutionCheck[] = [];
  for (const option of chain.options) {
    if (option.from !== speciesName) continue;
    if (option.gender && option.gender !== c.gender) continue;
    if (!formMatches(option, c.pokemon, isDefaultForm)) continue;
    // Forma niedomyślna (regionalna) ewoluuje tylko drogą wskazaną jawnie dla tej formy.
    if (!isDefaultForm && option.requiredForm !== c.pokemon) {
      out.push({ option, status: 'NOT_IMPLEMENTED', itemId: null, condition: 'forma regionalna — jeszcze nieobsługiwana' });
      continue;
    }
    if (option.method === 'LEVEL') {
      const lvl = option.minLevel ?? 1;
      out.push({ option, status: c.level >= lvl ? 'READY' : 'WAITING', itemId: null, condition: `poziom ${lvl}` });
    } else if (option.method === 'ITEM') {
      const itemId = option.itemApi ? evolutionItemForApi(option.itemApi) : null;
      if (itemId) out.push({ option, status: 'NEEDS_ITEM', itemId, condition: 'przedmiot' });
      else out.push({ option, status: 'NOT_IMPLEMENTED', itemId: null, condition: `przedmiot niedostępny w grze (${option.itemApi ?? '?'})` });
    } else {
      out.push({ option, status: 'NOT_IMPLEMENTED', itemId: null, condition: `warunek jeszcze nieobsługiwany: ${option.unsupported.join(', ')}` });
    }
  }
  return out;
}

/** Stały wybór spośród kilku jednocześnie spełnionych dróg (np. dwie ewolucje na tym samym poziomie). */
export function pickByUid<T>(uid: string, list: T[]): T | null {
  if (!list.length) return null;
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 33 + uid.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

/** Ewolucja przez poziom gotowa do zaproponowania po awansie (z uwzględnieniem anulowania). */
export function levelEvolutionToOffer(
  c: Pick<Creature, 'uid' | 'level' | 'gender' | 'hp' | 'evolutionState'>,
  checks: EvolutionCheck[],
): EvolutionCheck | null {
  if (c.hp <= 0) return null;
  const cancelled = c.evolutionState?.cancelledAtLevel;
  if (cancelled !== null && cancelled !== undefined && c.level <= cancelled) return null;
  return pickByUid(
    c.uid,
    checks.filter((x) => x.option.method === 'LEVEL' && x.status === 'READY'),
  );
}

// ───────────────────────────── przemiana ─────────────────────────────

/** Zdolność po ewolucji: ten sam slot (zwykły/ukryty), a gdy go brak — pierwsza zwykła. */
export function abilityAfterEvolution(abilityId: string, from: PokemonData, to: PokemonData): string {
  const fromNormal = from.abilities.filter((a) => !a.hidden);
  const toNormal = to.abilities.filter((a) => !a.hidden);
  const idx = fromNormal.findIndex((a) => a.name === abilityId);
  if (idx >= 0) return (toNormal[idx] ?? toNormal[0] ?? to.abilities[0])?.name ?? abilityId;
  const wasHidden = from.abilities.some((a) => a.hidden && a.name === abilityId);
  if (wasHidden) return (to.abilities.find((a) => a.hidden) ?? toNormal[0])?.name ?? abilityId;
  return (toNormal[0] ?? to.abilities[0])?.name ?? abilityId;
}

/**
 * Przemiana stworzenia: nowy gatunek, typy i statystyki bazowe; zostają poziom, doświadczenie, ruchy,
 * IV/EV, natura, przedmiot, płeć, przezwisko i pochodzenie. Utracone PŻ pozostają utracone.
 */
export function evolveCreature(c: Creature, from: PokemonData, to: PokemonData, toSpecies: SpeciesData): Creature {
  const stats = calcStats(to.baseStats, c.ivs, c.evs, c.level, c.nature);
  const lost = c.stats.hp - c.hp;
  const hp = c.hp <= 0 ? 0 : Math.max(1, stats.hp - lost);
  return {
    ...c,
    pokemon: to.name,
    speciesId: toSpecies.id,
    name: formDisplayName(to, toSpecies),
    types: [...to.types],
    stats,
    hp,
    moves: c.moves.map((m) => ({ ...m })),
    abilityId: abilityAfterEvolution(c.abilityId, from, to),
    evolutionState: { cancelledAtLevel: null, evolvedFrom: c.pokemon },
  };
}
