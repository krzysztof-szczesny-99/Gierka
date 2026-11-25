// Oryginalna mapa „Szepczący Zagajnik” (26×18 kafelków) — druga lokacja Krainy Szlaków.
// Legenda jak w testMap.ts. Wejście/wyjście: zachodnia ścieżka (do Polany Startowej), wschodnia ścieżka
// (do Wietrznej Strażnicy — Próba Wiatru) i północna ścieżka na Wzgórza Wiatru — zamknięta (zwalone drzewo),
// dopóki gracz nie zdobędzie Odznaki Wiatru (Sprint 6).
// Bezpieczna polanka przy wejściu; spotkania w paprociach (wysoka trawa) — tabela „zagajnik”.

import { ENCOUNTER_CONFIG } from '../../config/encounters';
import { ZAGAJNIK_ID } from '../../config/world';
import type { MapDef } from './testMap';

export const ZAGAJNIK_MAP: MapDef = {
  id: 'zagajnik',
  name: 'Szepczący Zagajnik',
  layout: [
    'TTTTTTTTTTTTT=TTTTTTTTTTTT',
    'TTTTTTTT,,,T.=.T,,,TTTTTTT',
    'TTT,,,,,,,,,.=.,,,,,,,,TTT',
    'TT,,,,TT,,,,.=.,,,,,,,,,TT',
    'TT,,,,TT,,,f.=.f,,,,TT,,TT',
    'TT,,,,,,,,,..=..,,,,TT,,TT',
    'TT...,,,,,...=...,,,,,,,TT',
    'TT.f........S=.....ff...TT',
    'TT....=========.......R.TT',
    '=======.ff....=....~~~..TT',
    'TT.S..........=...~~~~~.TT',
    'TT.f...,,,,,..=....~~~..TT',
    'TT....,,,,,,,.=.........TT',
    'TT...,,,,TT,,,=..,,,,,..TT',
    'TT..,,,,,TT,,,=.,,,,,,,.TT',
    'TT...,,,,,,,,.=.,,,,,,,STT',
    'TT........R...============',
    'TTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  zones: [
    {
      id: 'paprocie',
      name: 'Paprociowy Gąszcz',
      rect: { x: 0, y: 0, w: 26, h: 18 },
      locationId: ZAGAJNIK_ID,
      terrainType: 'TALL_GRASS',
      encounterTableId: 'zagajnik',
      baseEncounterRate: ENCOUNTER_CONFIG.baseRates.TALL_GRASS,
      stepDistance: ENCOUNTER_CONFIG.defaultStepDistance,
    },
  ],
  staticEncounters: [],
  signs: {
    '3,10': ['Szepczący Zagajnik.', 'W paprociach szeleszczą leśne stworzenia. Ścieżką na zachód wrócisz na Polanę Startową.'],
    '12,7': ['Na północ: Wzgórza Wiatru.', 'Uwaga: za zakrętem drogę zagradza zwalone drzewo.'],
    '23,15': ['Na wschód: Wietrzna Strażnica.', 'Przewodniczka Wera prowadzi tam Próbę Wiatru dla tropicieli, którzy pokonali Zielarkę Igę.'],
  },
  doors: {},
};
