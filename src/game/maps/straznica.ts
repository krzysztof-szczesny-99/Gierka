// Oryginalna mapa „Wietrzna Strażnica” (18×15 kafelków) — lokacja Próby Wiatru (Sprint 6).
// Legenda jak w testMap.ts. Kamienna arena (piasek otoczony murem, głazy jak kolumny) z bramą od południa.
// Lider stoi na arenie (src/config/challenges.ts); wejście w bramę lub rozmowa sprawdza wymagania Próby.
// Wyjście: zachodnia ścieżka do Szepczącego Zagajnika. Brak dzikich stworzeń (brak stref spotkań).

import type { MapDef } from './testMap';

export const STRAZNICA_MAP: MapDef = {
  id: 'straznica',
  name: 'Wietrzna Strażnica',
  layout: [
    'TTTTTTTTTTTTTTTTTT',
    'TTwwwwwwwwwwwwwwTT',
    'TTwRssssssssssRwTT',
    'TTwsssssssssssswTT',
    'TTwRssssssssssRwTT',
    'TTwsssssssssssswTT',
    'TTwRssssssssssRwTT',
    'TTwsssssssssssswTT',
    'TTwwwwww==wwwwwwTT',
    'TT......==......TT',
    'TT.f..S.==..f...TT',
    '==========......TT',
    'TT..f.......f...TT',
    'TT..............TT',
    'TTTTTTTTTTTTTTTTTT',
  ],
  zones: [],
  staticEncounters: [],
  signs: {
    '6,10': [
      'Wietrzna Strażnica — Próba Wiatru.',
      'Prowadzi: Przewodniczka Wera. Próbę podejmują tropiciele, którzy pokonali Zielarkę Igę z Szepczącego Zagajnika.',
      'Nagroda: Odznaka Wiatru.',
    ],
  },
  doors: {},
};
