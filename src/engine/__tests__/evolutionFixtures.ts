// Łańcuchy ewolucji w kształcie odpowiedzi PokéAPI (/evolution-chain) — dane testowe bez sieci.

import type { RawEvolutionChain, RawEvolutionDetail } from '../evolution';

export const ref = (name: string, id: number) => ({ name, url: `https://pokeapi.co/api/v2/pokemon-species/${id}/` });
/** Szczegół w kształcie odpowiedzi PokéAPI (wszystkie pola, domyślnie puste). */
export const detail = (o: Partial<RawEvolutionDetail>): RawEvolutionDetail => ({
  // Pola z bieżącej odpowiedzi PokéAPI (metadane wersji gier i nowsze warunki) — domyślnie puste.
  allowed_natures: null,
  condition_expression: null,
  evolved_pokemon_form: null,
  is_default: true,
  min_damage_taken: null,
  min_move_count: null,
  min_steps: null,
  near_special_rock: false,
  needs_multiplayer: false,
  region: null,
  required_pokemon_form: null,
  used_move: null,
  version_group: { name: 'red-blue', url: 'https://pokeapi.co/api/v2/version-group/1/' },
  gender: null,
  held_item: null,
  item: null,
  known_move: null,
  known_move_type: null,
  location: null,
  min_affection: null,
  min_beauty: null,
  min_happiness: null,
  min_level: null,
  needs_overworld_rain: false,
  party_species: null,
  party_type: null,
  relative_physical_stats: null,
  time_of_day: '',
  trade_species: null,
  trigger: { name: 'level-up', url: '' },
  turn_upside_down: false,
  ...o,
});
export const useItem = (item: string) => ({ trigger: { name: 'use-item', url: '' }, item: { name: item, url: '' } });

export const CATERPIE_CHAIN: RawEvolutionChain = {
  id: 4,
  chain: {
    species: ref('caterpie', 10),
    evolution_details: [],
    evolves_to: [
      {
        species: ref('metapod', 11),
        evolution_details: [detail({ min_level: 7 })],
        evolves_to: [{ species: ref('butterfree', 12), evolution_details: [detail({ min_level: 10 })], evolves_to: [] }],
      },
    ],
  },
};

export const EEVEE_CHAIN: RawEvolutionChain = {
  id: 67,
  chain: {
    species: ref('eevee', 133),
    evolution_details: [],
    evolves_to: [
      { species: ref('vaporeon', 134), evolution_details: [detail(useItem('water-stone'))], evolves_to: [] },
      { species: ref('jolteon', 135), evolution_details: [detail(useItem('thunder-stone'))], evolves_to: [] },
      { species: ref('espeon', 196), evolution_details: [detail({ min_happiness: 160, time_of_day: 'day' })], evolves_to: [] },
      { species: ref('glaceon', 471), evolution_details: [detail(useItem('ice-stone')), detail({ location: { name: 'ice-rock', url: '' } })], evolves_to: [] },
      { species: ref('sylveon', 700), evolution_details: [detail({ min_affection: 2, known_move_type: { name: 'fairy', url: '' } })], evolves_to: [] },
    ],
  },
};


const form = (name: string) => ({ name, url: `https://pokeapi.co/api/v2/pokemon-form/${name}/` });
const vg = (name: string) => ({ name, url: `https://pokeapi.co/api/v2/version-group/${name}/` });

/** Leafeon: kamień (dwie wersje gier) i „miejsce” (kilka wersji) — jak w PokéAPI. */
export const LEAFEON_CHAIN: RawEvolutionChain = {
  id: 670,
  chain: {
    species: ref('eevee', 133),
    evolution_details: [],
    evolves_to: [
      {
        species: ref('leafeon', 470),
        evolution_details: [
          detail({ version_group: vg('diamond-pearl'), is_default: false, location: { name: 'eterna-forest', url: '' }, near_special_rock: true, required_pokemon_form: form('eevee') }),
          detail({ version_group: vg('sword-shield'), is_default: true, ...useItem('leaf-stone'), required_pokemon_form: form('eevee') }),
          detail({ version_group: vg('brilliant-diamond-shining-pearl'), is_default: false, ...useItem('leaf-stone'), required_pokemon_form: form('eevee') }),
        ],
        evolves_to: [],
      },
      {
        species: ref('umbreon', 197),
        evolution_details: [
          detail({ version_group: vg('gold-silver'), min_happiness: 160, time_of_day: 'night', required_pokemon_form: form('eevee') }),
          detail({ version_group: vg('x-y'), is_default: false, min_happiness: 160, time_of_day: 'night', required_pokemon_form: form('eevee') }),
        ],
        evolves_to: [],
      },
    ],
  },
};

/** Formy regionalne: rattata → raticate oraz rattata-alola → raticate-alola (noc, forma docelowa). */
export const RATTATA_CHAIN: RawEvolutionChain = {
  id: 10,
  chain: {
    species: ref('rattata', 19),
    evolution_details: [],
    evolves_to: [
      {
        species: ref('raticate', 20),
        evolution_details: [
          detail({ min_level: 20, required_pokemon_form: form('rattata') }),
          detail({ min_level: 20, time_of_day: 'night', required_pokemon_form: form('rattata-alola'), evolved_pokemon_form: form('raticate-alola'), version_group: vg('sun-moon') }),
        ],
        evolves_to: [],
      },
    ],
  },
};

/** Forma regionalna z własną ewolucją do innego gatunku (wooper-paldea → clodsire). */
export const WOOPER_CHAIN: RawEvolutionChain = {
  id: 100,
  chain: {
    species: ref('wooper', 194),
    evolution_details: [],
    evolves_to: [
      { species: ref('quagsire', 195), evolution_details: [detail({ min_level: 20, required_pokemon_form: form('wooper') })], evolves_to: [] },
      { species: ref('clodsire', 980), evolution_details: [detail({ min_level: 20, required_pokemon_form: form('wooper-paldea'), version_group: vg('scarlet-violet') })], evolves_to: [] },
    ],
  },
};
