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
};
const TRIGGER_LABEL: Record<string, string> = {
  trade: 'wymiana',
  shed: 'zrzucenie skorupy',
  spin: 'obrót',
  'three-critical-hits': 'trzy trafienia krytyczne',
  'take-damage': 'otrzymane obrażenia',
};
/** Pola szczegółu, które model obsługuje (pozostałe ustawione = warunek nieobsługiwany). */
const HANDLED = new Set(['trigger', 'min_level', 'item', 'gender']);

const isSet = (v: unknown) => v !== null && v !== undefined && v !== false && v !== '' && !(Array.isArray(v) && v.length === 0);
const speciesIdFromUrl = (url: string) => Number(/\/(\d+)\/?$/.exec(url)?.[1] ?? 0);

/** Jeden szczegół PokéAPI → jedna opcja lokalnego modelu. */
export function normalizeEvolutionDetail(from: string, to: RawRef, d: RawEvolutionDetail): EvolutionOption {
  const unsupported: string[] = [];
  for (const [key, value] of Object.entries(d)) {
    if (HANDLED.has(key) || !isSet(value)) continue;
    unsupported.push(CONDITION_LABEL[key] ?? key.replace(/_/g, ' '));
  }
  const trigger = d.trigger?.name ?? '';
  const gender: Gender | null = d.gender === 1 ? 'F' : d.gender === 2 ? 'M' : null;
  const base = { from, to: to.name, toSpeciesId: speciesIdFromUrl(to.url), gender, minLevel: d.min_level ?? null, itemApi: d.item?.name ?? null };
  if (trigger === 'level-up' && d.min_level && !unsupported.length) return { ...base, method: 'LEVEL', unsupported };
  if (trigger === 'use-item' && d.item && !unsupported.length) return { ...base, method: 'ITEM', unsupported };
  if (trigger === 'level-up' && !d.min_level && !unsupported.length) unsupported.push('awans bez określonego poziomu');
  if (trigger !== 'level-up' && trigger !== 'use-item') unsupported.unshift(TRIGGER_LABEL[trigger] ?? (trigger || 'nieznany warunek'));
  return { ...base, method: 'NOT_IMPLEMENTED', unsupported };
}

export function normalizeEvolutionChain(raw: RawEvolutionChain): EvolutionChainData {
  const options: EvolutionOption[] = [];
  const walk = (link: RawChainLink) => {
    for (const next of link.evolves_to) {
      const details = next.evolution_details.length ? next.evolution_details : [{ trigger: null } as RawEvolutionDetail];
      for (const d of details) options.push(normalizeEvolutionDetail(link.species.name, next.species, d));
      walk(next);
    }
  };
  walk(raw.chain);
  return { id: raw.id, options };
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
  c: Pick<Creature, 'level' | 'gender'>,
  speciesName: string,
  isDefaultForm: boolean,
  chain: EvolutionChainData,
): EvolutionCheck[] {
  const out: EvolutionCheck[] = [];
  for (const option of chain.options) {
    if (option.from !== speciesName) continue;
    if (option.gender && option.gender !== c.gender) continue;
    if (!isDefaultForm) {
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
