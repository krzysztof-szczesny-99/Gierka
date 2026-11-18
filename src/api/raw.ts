// Częściowe typy surowych odpowiedzi PokéAPI v2 — tylko pola używane w grze.

export interface NamedRef {
  name: string;
  url: string;
}

export interface RawName {
  name: string;
  language: NamedRef;
}

export interface RawPokemon {
  id: number;
  name: string;
  base_experience: number | null;
  height: number;
  weight: number;
  is_default: boolean;
  species: NamedRef;
  types: { slot: number; type: NamedRef }[];
  stats: { base_stat: number; effort: number; stat: NamedRef }[];
  abilities: { ability: NamedRef; is_hidden: boolean; slot: number }[];
  moves: {
    move: NamedRef;
    version_group_details: {
      level_learned_at: number;
      move_learn_method: NamedRef;
      version_group: NamedRef;
    }[];
  }[];
  sprites: RawSprites;
}

export interface RawSprites {
  front_default: string | null;
  back_default: string | null;
  front_shiny: string | null;
  back_shiny: string | null;
  other?: {
    showdown?: {
      front_default: string | null;
      back_default: string | null;
      front_shiny: string | null;
      back_shiny: string | null;
    };
  };
  versions?: {
    'generation-v'?: {
      'black-white'?: {
        animated?: {
          front_default: string | null;
          back_default: string | null;
          front_shiny: string | null;
          back_shiny: string | null;
        };
      };
    };
  };
}

export interface RawSpecies {
  id: number;
  name: string;
  names: RawName[];
  capture_rate: number;
  base_happiness: number | null;
  gender_rate: number;
  is_legendary: boolean;
  is_mythical: boolean;
  is_baby: boolean;
  growth_rate: NamedRef;
  generation: NamedRef;
  evolution_chain: { url: string } | null;
  varieties: { is_default: boolean; pokemon: NamedRef }[];
}

export interface RawMove {
  id: number;
  name: string;
  names: RawName[];
  accuracy: number | null;
  power: number | null;
  pp: number | null;
  priority: number;
  effect_chance: number | null;
  damage_class: NamedRef | null;
  target: NamedRef | null;
  type: NamedRef;
  meta: {
    ailment: NamedRef | null;
    category: NamedRef | null;
    min_hits: number | null;
    max_hits: number | null;
    min_turns: number | null;
    max_turns: number | null;
    drain: number | null;
    healing: number | null;
    crit_rate: number | null;
    ailment_chance: number | null;
    flinch_chance: number | null;
    stat_chance: number | null;
  } | null;
  stat_changes: { change: number; stat: NamedRef }[];
}

export interface RawType {
  name: string;
  damage_relations: {
    double_damage_to: NamedRef[];
    half_damage_to: NamedRef[];
    no_damage_to: NamedRef[];
  };
}

export interface RawGrowthRate {
  name: string;
  levels: { level: number; experience: number }[];
}

export interface RawList {
  count: number;
  results: NamedRef[];
}
