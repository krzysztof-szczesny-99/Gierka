// Oryginalna mapa „Wzgórza Wiatru” (22×16 kafelków) — trasa za zamkniętym przejściem z Zagajnika (Sprint 6).
// Legenda jak w testMap.ts. Ścieżka biegnie z południa (wejście z Zagajnika) na północ, wśród wysokiej trawy,
// głazów i skalistych łat. Spotkania: wysoka trawa — tabela „wzgorza”. Dalszy szlak na północ nie jest jeszcze
// zbudowany (tabliczka mówi o tym wprost; brzeg mapy to drzewa, więc nie da się utknąć).

import { ENCOUNTER_CONFIG } from '../../config/encounters';
import { WZGORZA_ID } from '../../config/world';
import type { MapDef } from './testMap';

export const WZGORZA_MAP: MapDef = {
  id: 'wzgorza',
  name: 'Wzgórza Wiatru',
  layout: [
    'TTTTTTTTTTTTTTTTTTTTTT',
    'TTTR,,,,,.S..,,,,,RTTT',
    'TTR,,,,,,...,,,,,,,RTT',
    'TT,,,rr,,..=..,,rr,,TT',
    'TT,,RR,,,..=..,,,RR,TT',
    'TT,,,,,,,..=..,,,,,,TT',
    'TTT,,,ff...=...ff,,TTT',
    'TT,,,,.....=......,,TT',
    'TT,,,,,R...=...R,,,,TT',
    'TT,,,,,,,..=..,,,,,,TT',
    'TTrrr,,,,..=..,,,,rrTT',
    'TTrR,,,,,..=..,,,,,RTT',
    'TT,,,,,,...=...,,,,,TT',
    'TTT,,,,....=....,,,TTT',
    'TTTTT,.....=.....,TTTT',
    'TTTTTTTTTTT=TTTTTTTTTT',
  ],
  zones: [
    {
      id: 'wietrzne-zbocza',
      name: 'Wietrzne Zbocza',
      rect: { x: 0, y: 0, w: 22, h: 16 },
      locationId: WZGORZA_ID,
      terrainType: 'TALL_GRASS',
      encounterTableId: 'wzgorza',
      baseEncounterRate: ENCOUNTER_CONFIG.baseRates.TALL_GRASS,
      stepDistance: ENCOUNTER_CONFIG.defaultStepDistance,
    },
  ],
  signs: {
    '10,1': [
      'Wzgórza Wiatru.',
      'Dalej na północ szlak ginie w chmurach — ta część Krainy Szlaków nie jest jeszcze przetarta.',
      'Ścieżką na południe wrócisz do Szepczącego Zagajnika.',
    ],
  },
  doors: {},
};
