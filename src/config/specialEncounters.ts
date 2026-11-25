// Specjalne spotkania (Sprint 7) — dane. Jedyne stworzenia widoczne na mapie: stoją nieruchomo na swoim polu,
// kontakt (wejście w nie albo Akcja) rozpoczyna walkę przez centralną blokadę spotkań. Logika: src/game/specialEncounters.ts.
// Sprint 2 opisywał je w danych mapy (staticEncounters + tabela „grove-guardian”) — teraz mają własny model.

import { staticDoneFlag } from './encounters';
import { GROTA_ID, POLANA_ID } from './world';

/**
 * Stan spotkania po wyniku walki:
 * GONE — znika na stałe (zapisane wydarzenie ukończenia — nie wraca także po ponownym uruchomieniu gry);
 * HIDDEN_UNTIL_REENTRY — znika do ponownego wejścia gracza do lokacji (albo ponownego uruchomienia gry);
 * REMAINS — zostaje na miejscu (kolejny kontakt po krótkim odnowieniu).
 */
export type SpecialEncounterState = 'GONE' | 'HIDDEN_UNTIL_REENTRY' | 'REMAINS';
export const SPECIAL_ENCOUNTER_STATES: readonly SpecialEncounterState[] = ['GONE', 'HIDDEN_UNTIL_REENTRY', 'REMAINS'];

/**
 * Polityka powtórzeń:
 * ONE_ATTEMPT — jedna walka: każdy wynik, także ucieczka, kończy spotkanie na stałe;
 * UNTIL_RESOLVED — ucieczka (lub przegrana) nie kończy spotkania; kończy je złapanie albo pokonanie;
 * REPEATABLE — spotkanie wraca zawsze (także po złapaniu i pokonaniu) — tylko dla oneTime: false.
 */
export type SpecialRepeatPolicy = 'ONE_ATTEMPT' | 'UNTIL_RESOLVED' | 'REPEATABLE';
export const SPECIAL_REPEAT_POLICIES: readonly SpecialRepeatPolicy[] = ['ONE_ATTEMPT', 'UNTIL_RESOLVED', 'REPEATABLE'];

export interface SpecialEncounterDef {
  id: string;
  /** Nazwa spotkania (Dziennik, miejsce spotkania złapanego stworzenia). */
  name: string;
  /** Nazwa wariantu w PokéAPI. Stworzenia legendarne i mityczne są dozwolone wyłącznie tutaj. */
  pokemonId: string;
  level: number;
  /** „Potężny okaz” (poziom + premia, złota aura) — Strażnik Cichego Gaju był taki od Sprintu 2. */
  mighty?: boolean;
  locationId: string;
  position: { x: number; y: number };
  /** Strefa mapy (nazwa w Atlasie, postęp zadań — np. flaga „grove-done” Cichego Gaju). */
  zoneId?: string;
  /** Wymagania pojawienia się na mapie (wszystkie naraz). */
  requiredBadges: string[];
  requiredItems: string[];
  requiredEvents: string[];
  /** Złapanie i pokonanie kończą spotkanie na zawsze (wydarzenie ukończenia w zapisie). */
  oneTime: boolean;
  repeatPolicy: SpecialRepeatPolicy;
  /** Flaga zapisu ustawiana, gdy spotkanie znika na stałe (stan GONE). */
  completionEventId: string;
  stateAfterCapture: SpecialEncounterState;
  stateAfterDefeat: SpecialEncounterState;
  /** Także po przegranej gracza (gracz opuszcza miejsce — jak przy ucieczce). */
  stateAfterEscape: SpecialEncounterState;
}

export const SPECIAL_ENCOUNTERS: readonly SpecialEncounterDef[] = [
  {
    // Sprint 2 → nowy model: zachowanie bez zmian (ta sama flaga ukończenia, potężny okaz, po ucieczce zostaje).
    id: 'gaj-straznik',
    name: 'Strażnik Cichego Gaju',
    pokemonId: 'growlithe',
    level: 8,
    mighty: true,
    locationId: POLANA_ID,
    position: { x: 36, y: 28 },
    zoneId: 'grove',
    requiredBadges: [],
    requiredItems: [],
    requiredEvents: [],
    oneTime: true,
    repeatPolicy: 'UNTIL_RESOLVED',
    completionEventId: staticDoneFlag('gaj-straznik'),
    stateAfterCapture: 'GONE',
    stateAfterDefeat: 'GONE',
    stateAfterEscape: 'REMAINS',
  },
  {
    // Ukryta Grota Echa (Sprint 7): rzadkie stworzenie, jednorazowe; po ucieczce wraca dopiero po ponownym wejściu.
    id: 'grota-absol',
    name: 'Cień Groty Echa',
    pokemonId: 'absol',
    level: 16,
    locationId: GROTA_ID,
    position: { x: 7, y: 2 },
    requiredBadges: [],
    requiredItems: [],
    requiredEvents: [],
    oneTime: true,
    repeatPolicy: 'UNTIL_RESOLVED',
    completionEventId: 'special:grota-absol:done',
    stateAfterCapture: 'GONE',
    stateAfterDefeat: 'GONE',
    stateAfterEscape: 'HIDDEN_UNTIL_REENTRY',
  },
];

/**
 * Stworzenia legendarne i mityczne (podstawowe nazwy z PokéAPI; formy jak „giratina-altered” pasują po prefiksie).
 * Nie mogą trafić do zwykłych tabel spotkań — tylko do spotkań specjalnych. Dodatkowo kod sprawdza dane gatunku
 * z PokéAPI (is_legendary / is_mythical) przy budowaniu każdego losowego stworzenia.
 */
export const LEGENDARY_OR_MYTHICAL: readonly string[] = [
  'articuno', 'zapdos', 'moltres', 'mewtwo', 'mew',
  'raikou', 'entei', 'suicune', 'lugia', 'ho-oh', 'celebi',
  'regirock', 'regice', 'registeel', 'latias', 'latios', 'kyogre', 'groudon', 'rayquaza', 'jirachi', 'deoxys',
  'uxie', 'mesprit', 'azelf', 'dialga', 'palkia', 'heatran', 'regigigas', 'giratina', 'cresselia', 'phione', 'manaphy', 'darkrai', 'shaymin', 'arceus',
  'victini', 'cobalion', 'terrakion', 'virizion', 'tornadus', 'thundurus', 'reshiram', 'zekrom', 'landorus', 'kyurem', 'keldeo', 'meloetta', 'genesect',
  'xerneas', 'yveltal', 'zygarde', 'diancie', 'hoopa', 'volcanion',
  'type-null', 'silvally', 'tapu-koko', 'tapu-lele', 'tapu-bulu', 'tapu-fini', 'cosmog', 'cosmoem', 'solgaleo', 'lunala', 'necrozma', 'magearna', 'marshadow', 'zeraora', 'meltan', 'melmetal',
  'zacian', 'zamazenta', 'eternatus', 'kubfu', 'urshifu', 'zarude', 'regieleki', 'regidrago', 'glastrier', 'spectrier', 'calyrex', 'enamorus',
  'wo-chien', 'chien-pao', 'ting-lu', 'chi-yu', 'koraidon', 'miraidon', 'walking-wake', 'iron-leaves', 'okidogi', 'munkidori', 'fezandipiti', 'ogerpon',
  'gouging-fire', 'raging-bolt', 'iron-boulder', 'iron-crown', 'terapagos', 'pecharunt',
];

export function isLegendaryOrMythicalId(pokemonId: string): boolean {
  return LEGENDARY_OR_MYTHICAL.some((n) => pokemonId === n || pokemonId.startsWith(`${n}-`));
}
