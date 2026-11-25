# Szlaki Dziczy — plan architektury (prototyp)

Niekomercyjny, przeglądarkowy prototyp RPG o kolekcjonowaniu stworzeń. Mobile-first, PWA.
Dane o gatunkach, ruchach, typach i krzywych doświadczenia pochodzą z PokéAPI (https://pokeapi.co/docs/v2).
Mapy, interfejs, teksty, grafiki postaci i kafelków oraz cały kod są oryginalne.

---

## 1. Co można pobrać bezpośrednio z PokéAPI

| Dane | Endpoint | Użycie w grze |
|---|---|---|
| Statystyki bazowe, typy, zdolności, EV yield, bazowe EXP | `/pokemon/{name}` | wyliczanie statystyk, typy w walce, EXP za pokonanie |
| Ruchy uczone przez poziom (per wersja gry) | `/pokemon/{name}` → `moves[].version_group_details` | zestaw 4 ruchów, nauka nowych ruchów |
| Sprite'y (statyczne, shiny, animowane) | `/pokemon/{name}` → `sprites` | mapa i walka (opcjonalnie, patrz §7) |
| Formy regionalne i alternatywne, megaewolucje jako formy | `/pokemon-species/{id}` → `varieties`, `/pokemon-form/{id}` | spotkania z formami (np. `rattata-alola`) |
| Wskaźnik łapania, krzywa EXP, płeć, legendarność, generacja, łańcuch ewolucji | `/pokemon-species/{id}` | łapanie, poziomy, filtry spotkań |
| Tabela doświadczenia dla poziomów 1–100 | `/growth-rate/{name}` | zdobywanie poziomów |
| Moc, celność, PP, priorytet, klasa obrażeń, cel, meta (status, szansa, drenaż, leczenie, wielokrotne trafienia, krytyk, flinch), zmiany statystyk | `/move/{name}` | silnik walki |
| Relacje typów (×2, ×½, ×0) | `/type/{name}` | tabela skuteczności |
| Łańcuchy ewolucji i warunki | `/evolution-chain/{id}` | etap 2 |
| Natury | `/nature/{name}` | etap 2 |
| Przedmioty (ceny, kategorie, atrybuty) | `/item/{name}` | etap 2+ (sklep, przedmioty trzymane) |
| Generacje i lista gatunków | `/generation/{id}`, `/pokemon-species?limit=…` | Atlas, pule spotkań |

Zasady fair use PokéAPI: brak limitu zapytań, ale wymóg lokalnego buforowania; dozwolone są wyłącznie zapytania GET
i parametry `limit`/`offset`. Klient w grze: kolejka (maks. 4 równoległe zapytania), deduplikacja, ponowienia z backoffem,
bufor w IndexedDB (TTL 30 dni, przy braku sieci zwraca przeterminowane dane).

## 2. Dane przechowywane lokalnie (brak ich w PokéAPI albo nie należy ich kopiować)

- Oryginalne mapy, strefy spotkań i tabele spotkań (`src/game/maps`, `src/config/encounters.ts`).
- Wzory: obrażenia, łapanie, ucieczka, EXP, kolejność ruchów, efekty statusów — zaimplementowane od zera na podstawie
  ogólnie znanych zasad gatunku, z konfigurowalnymi stałymi (`src/config/rules.ts`, bazą jest 4. generacja).
- Przedmioty prototypu (Kapsuła, Napar, Balsam) z własnymi nazwami i parametrami (`src/config/items.ts`).
- Wyjątki dla ruchów o stałych obrażeniach (`src/config/moveOverrides.ts`).
- Działanie zdolności i przedmiotów trzymanych (API zawiera tylko opisy tekstowe) — etap 2+.
- Mapowanie megakamień → forma mega (API ma formy, ale nie ma bezpośredniego powiązania z przedmiotem) — etap 5.
- Trenerzy, AI, zadania, dialogi, fabuła — w całości oryginalne.
- Polskie nazwy typów, statusów i opisy ruchów generowane z danych (PokéAPI nie ma języka polskiego dla nazw gatunków).
- Zapis gry (IndexedDB/Dexie), ustawienia, Atlas, postęp zadań.

## 3. Architektura

```
┌──────────────────────── React (UI DOM, dotyk) ────────────────────────┐
│ Ekrany: Tytuł · Starter · HUD/joystick · Walka · Drużyna · Torba · … │
└───────────▲──────────────────────────────▲────────────────────────────┘
            │ selektory Zustand            │ akcje
┌───────────┴───────────┐      ┌───────────┴─────────────┐
│ state/ (Zustand)      │◄────►│ services/ (orkiestracja)│
│ gameStore · uiStore · │      │ spotkania, koniec walki,│
│ battleStore           │      │ budowa stworzeń, boot   │
└───────────▲───────────┘      └──────┬───────────▲──────┘
            │                         │           │
┌───────────┴───────────┐   ┌─────────▼──────┐ ┌──┴───────────────────┐
│ game/ (Phaser 3)      │   │ engine/ (czysty│ │ data/ + api/         │
│ mapa, ruch, stworzenia│   │ TS: walka, EXP,│ │ PokéAPI → normalizacja│
│ na mapie, towarzysz   │   │ łapanie, typy) │ │ → Dexie (bufor+zapis)│
└───────────────────────┘   └────────────────┘ └──────────────────────┘
          ▲  eventBus (encounter, battle-start/end, dialog, door, teleport)
```

Kluczowe decyzje:
- **Phaser tylko do eksploracji** (mapa, kamera, animacje, kolizje). Walka i menu to React/DOM: większa czytelność,
  dostępność, łatwy responsywny układ, duże przyciski.
- **Silnik walki jako czyste funkcje**: `resolveTurn(stan, akcja, rng) → { stan, zdarzenia[] }`. UI odtwarza zdarzenia
  (komunikaty, paski HP, animacje). Łatwe testy i przyszłe walki podwójne (strony mają tablice aktywnych slotów).
- **Normalizacja danych API**: zapisujemy zwięzłe rekordy zamiast surowych odpowiedzi (pojedynczy `/pokemon` ma
  kilkaset KB przez listę ruchów).
- **Bufor dwupoziomowy**: JSON w IndexedDB (Dexie), obrazki w Cache Storage (Workbox, CacheFirst).
- **Zapis**: autozapis (debounce 2 s), natychmiastowy zapis przy ukryciu karty/wyjściu, eksport/import JSON.

### Stack
Zostaje proponowany stack: TypeScript, React 19, Vite 6, Phaser 3.90, Zustand 5, Dexie 4, vite-plugin-pwa.
Jedna zmiana z uzasadnieniem: **czysty CSS zamiast Tailwind** — mniej zależności i konfiguracji, a interfejs gry
korzysta z niewielkiego zestawu własnych komponentów i zmiennych CSS. Tailwind można dodać później bez przebudowy.
Rozważane alternatywy: PixiJS (lżejszy, ale brak gotowych tilemap/kamery/tweenów), Kaplay (prostszy, słabszy przy
większych mapach), Phaser 4 (nowsze API, mniej materiałów; migracja możliwa później, bo Phaser jest odizolowany w `game/`).

## 4. Model danych (skrót)

```ts
PokemonData  { id, name, speciesId, types[], baseStats, evYield, baseExp, abilities[], levelMoves[{name, level}],
               learnsetVersion, sprites{front, back, *Shiny, anim*} }
SpeciesData  { id, name, displayName, captureRate, growthRate, genderRate, isLegendary, isMythical, generation,
               evolutionChainId, varieties[{name, isDefault}] }
MoveData     { name, displayName, type, power, accuracy, pp, priority, damageClass, target,
               meta{ailment, ailmentChance, category, minHits, maxHits, drain, healing, critRate, flinchChance, statChance},
               statChanges[{stat, change}] }
Creature     { uid, pokemon (wariant/forma), speciesId, name, nickname?, types[], level, exp, growthRate,
               ivs, evs, stats, hp, status, sleepTurns, moves[{name, pp, maxPp}], nature, abilityId, gender, shiny,
               heldItemId, evolutionState{cancelledAtLevel, evolvedFrom}, friendship, metLevel, metAt, caughtAt, mighty }
EvolutionChainData { id, options[{from, to, toSpeciesId, method: LEVEL|ITEM|NOT_IMPLEMENTED, minLevel, itemApi,
               gender, unsupported[]}] }   // z PokéAPI /evolution-chain → src/engine/evolution.ts
BattleState  { turn, sides[2]{kind, party[], active[]}, boosts{uid}, volatiles{uid}, pokemon{}, moves{}, growth{},
               typeChart, captureRate, participants[], awaitingSwitch, outcome, caught, pendingLearns[] }
SaveData v3  { version: 3, savedAt, player{name, regionId, locationId, spawnPointId, x, y, facing, money, steps, playTimeMs},
               party[], storage[], bag{}, dex{speciesId: {seen, caught, name, sprite, types}},
               stats{}, questsClaimed{}, flags{}, settings{} }
Dexie        cache(key, kind, data, fetchedAt) · saves(id, data, updatedAt)
Migracja     v2 → v3: ability → abilityId, heldItem → heldItemId, natura neutralna (stała z uid — statystyki bez zmian),
             pusty evolutionState.
             v1 → v2 (src/data/migrations.ts): player.mapId → regionId + locationId + spawnPointId 'start', pozycja bez zmian;
             nieznana mapa/lokacja → lokacja startowa; wersja nowsza niż obsługiwana → błąd (zapis nie jest nadpisywany).

// Model świata (Sprint 3) — dane w src/config/world.ts, logika i walidacja w src/game/world.ts
RegionDef    { id, name, generationReference, startLocationId, locationIds[], unlockRequirements, status }
LocationDef  { id, name, regionId, type, status, mapReference, connections[], spawnPoints[], encounterTableIds[],
               availableEncounterMethods[], requiredBadges[], requiredItems[], requiredEvents[], hidden, healingPoint }
               status: IMPLEMENTED | DATA_ONLY | PLANNED | BLOCKED_BY_MISSING_ASSET
               type:   TOWN | CITY | ROUTE | FOREST | CAVE | WATER | BUILDING | CHALLENGE | SPECIAL
Connection   { id, sourceLocationId, destinationLocationId, sourceTrigger{kind:'tile', x, y}, destinationSpawnPoint,
               requirements{badges?, items?, events?}, blockedMessage[] }
SpawnPoint   { id, x, y, facing }        HealingPoint { locationId, spawnPointId }
```

Lokacje (Sprint 3): **Polana Startowa** (`polana-startowa`, TOWN, mapa `polana`, tabele meadow/pond/rocks/grove + Strażnik)
⇄ **Szepczący Zagajnik** (`szepczacy-zagajnik`, FOREST, mapa `zagajnik`, tabela `zagajnik`) → **Wzgórza Wiatru**
(`wzgorza-wiatru`, ROUTE, PLANNED — przejście zablokowane komunikatem). Walidacja danych (`validateWorld`): duplikaty ID,
brakujące lokacje/regiony/mapy/punkty pojawienia się/tabele, błędne połączenia (wyzwalacz na przeszkodzie, brak drogi
powrotnej), punkty na przeszkodzie lub na wyjściu, osiągalność lokacji. Uruchamiana w testach jednostkowych i w trybie `?debug` (błędy trafiają do konsoli).

## 5. Struktura folderów

```
szlaki-dziczy/
├─ index.html · package.json · vite.config.ts · vitest.config.ts · tsconfig.json · README.md
├─ public/            favicon.svg, icons/ (ikony PWA 192/512/maskable, apple-touch-icon)
├─ docs/              PLAN.md (ten dokument), KOD-ETAPU-1.md (pełny listing kodu)
└─ src/
   ├─ main.tsx · App.tsx · vite-env.d.ts
   ├─ api/        pokeapi.ts (kolejka, retry, offline) · raw.ts (typy API) · normalize.ts
   ├─ data/       db.ts (Dexie) · repository.ts (bufor pamięć→IndexedDB→API) · saveGame.ts (zapis/autozapis) · migrations.ts (wersje zapisu)
   ├─ config/     rules.ts · items.ts (także przedmioty trzymane i kamienie) · natures.ts · abilities.ts · encounters.ts · world.ts (regiony, lokacje, połączenia, zamknięte przejścia) · trainers.ts (trenerzy) · challenges.ts (Próby Szlaku, liderzy, odznaki) · quests.ts · moveOverrides.ts · text.ts
   ├─ engine/     types.ts · rng.ts · stats.ts (z naturą) · typeChart.ts · experience.ts · moves.ts · creature.ts · evolution.ts
   │  ├─ battle/  types.ts · damage.ts · status.ts · catch.ts · ai.ts (profile BASIC/BALANCED/AGGRESSIVE, zmiana stworzenia) · effects.ts (zdolności i przedmioty) · battleEngine.ts (walka z dzikim i z trenerem)
   │  └─ __tests__/ engine.test.ts · fixtures.ts
   ├─ game/       PhaserGame.tsx · eventBus.ts · input.ts (joystick) · movement.ts (reguły ruchu) · encounterZones.ts (tereny i losowanie) · world.ts (przejścia, wymagania, bezpieczne wejście, walidacja świata) · trainers.ts (wzrok, podejście, wydarzenia, walidacja trenerów) · challenges.ts (stan Próby, odznaka raz, odblokowania, walidacja) · tiles.ts · art.ts · textures.ts
   │  ├─ maps/    index.ts (rejestr map) · testMap.ts (Polana Startowa) · zagajnik.ts (Szepczący Zagajnik) · straznica.ts (Wietrzna Strażnica — Próba Wiatru) · wzgorza.ts (Wzgórza Wiatru)
   │  └─ scenes/  BootScene.ts · OverworldScene.ts
   ├─ services/   creatureService.ts · encounterService.ts · evolutionService.ts · updateService.ts · bootService.ts
   ├─ state/      gameStore.ts · uiStore.ts · battleStore.ts
   └─ ui/         components/ (common, CreatureSprite, Controls, Overlays) · screens/ (Title, Starter,
                  Overworld, Battle) · menus/ (Party, Bag, Atlas, Journal, Shop, Options, LearnMove, Evolution, ModalHost)
                  · styles/global.css
```

## 6. Etapy

1. **MVP (ten etap)** — mapa testowa, ruch dotykowy (joystick; tap-to-move wyłączony w Sprincie 1), losowe spotkania w terenie (Sprint 2; widoczne tylko spotkania specjalne), przejście do walki,
   walka 1v1, 4 ruchy, typy, obrażenia, HP, statusy, łapanie, drużyna 6 + magazyn, EXP i poziomy, nauka ruchów,
   zapis w IndexedDB, PWA. Dodatkowo: towarzysz za graczem, sklep, Atlas, dziennik zadań, tryb offline.
2. **Rozwój stworzeń i świat** — ewolucje (`/evolution-chain`), natury, ~40 najprostszych zdolności, przedmioty
   trzymane, trenerzy na mapie z linią wzroku i AI, druga mapa + przejścia, import map z Tiled (JSON).
3. **Walki podwójne i pełniejszy silnik** — wybór celów, ruchy obszarowe, ruchy wieloturowe, pogoda, zmiana
   stworzenia przez AI, współdzielony EXP, przegląd magazynu.
4. **Otwarte strefy** — zachowania stworzeń (płochliwe/agresywne/potężne), rzut kapsułą z mapy, unik, pora dnia,
   zadania badawcze w Atlasie, dynamiczne przejścia eksploracja ↔ walka.
5. **Pierwsza przygoda i region 2** — czytelna struktura 8 prób, samouczek, drugi region, formy regionalne
   przypisane do regionów, megaewolucje (lokalne mapowanie kamień → forma), interakcje z towarzyszem.
6. **Zawartość końcowa** — Wieża Prób (rosnąca trudność), Turniej Mistrzów Szlaku, Rozdarcie (obszar z własnymi
   zasadami ruchu), dodatkowe wyspy, spotkania legendarne, pule spotkań ze wszystkich generacji.
7. **Szlif** — oryginalne proceduralne audio (WebAudio), dostępność, wydajność, testy E2E, opcjonalny zapis w chmurze.

## 7. Ograniczenia prawne i techniczne

Prawne (to nie jest porada prawna):
- Nazwy, projekty stworzeń, sprite'y i znaki towarowe należą do Nintendo / Creatures Inc. / GAME FREAK. PokéAPI udostępnia
  dane i sprite'y, ale nie udziela licencji na tę własność intelektualną. Projekt jest więc do prywatnej, niekomercyjnej
  zabawy: bez monetyzacji, bez publikacji w sklepach z aplikacjami, bez słowa „Pokémon” w nazwie i oprawie.
  Publiczne udostępnienie zwiększa ryzyko żądania usunięcia.
- Mechaniki gry (zasady, wzory) implementujemy własnym kodem na podstawie ogólnych opisów — nie kopiujemy kodu gier.
- Nie wyświetlamy opisów z Pokédexu (oficjalne teksty) ani oficjalnych artworków. Opisy ruchów generujemy po polsku z danych.
- Grafiki stworzeń z PokéAPI są **opcjonalne**: wyłączenie opcji „Grafiki stworzeń z PokéAPI” w Menu podmienia je na
  oryginalne, proceduralne sylwetki w kolorze typu (dobre do publicznych pokazów).

Zamienniki zamiast kopiowania:

| Element oryginalny | Zamiennik w prototypie |
|---|---|
| Poké Ball | **Kapsuła** — własny kształt (pionowa kapsuła z klejnotem) |
| Centrum Pokémon | **Stacja Opieki** (miętowy dach z sercem) |
| Poké Mart | **Kram** (bursztynowy dach z monetą) |
| Pokédex | **Atlas** (wyłącznie dane liczbowe) |
| Trener | **Tropiciel** |
| Pokédolary | **Żetony ◆** |
| Alfa (Legends) | **Potężny okaz** (wyższy poziom, złota poświata) |
| Battle Frontier / PWT | **Wieża Prób** / **Turniej Mistrzów Szlaku** |
| Distortion World | **Rozdarcie** |
| Muzyka | brak w MVP; później oryginalne dźwięki WebAudio |
| Mapy regionów | oryginalne mapy ASCII + proceduralne kafelki |
| Interfejs gier | własny układ kart i dużych przycisków pod dotyk |

Techniczne:
- Service worker i instalacja PWA wymagają HTTPS (lub `localhost`). Przez `http://IP:port` w sieci Wi-Fi gra działa,
  ale bez instalacji i trybu offline — obejścia w README.
- iOS: brak `beforeinstallprompt` (instalacja ręczna przez „Udostępnij → Do ekranu początkowego”), brak wibracji,
  możliwe czyszczenie danych witryn nieużywanych przez 7 dni (zainstalowana PWA jest chroniona lepiej).
- Pierwsze uruchomienie wymaga sieci (dane z API). Offline pojawiają się tylko gatunki już zbuforowane.
- PokéAPI nie ma polskich nazw gatunków i ruchów — używamy angielskich nazw z API.
- Zdolności i efekty przedmiotów są w API wyłącznie tekstem — wymagają ręcznej implementacji (stopniowo).
- Sprite'y nowszych form mogą nie istnieć — wtedy pokazujemy grafikę zastępczą.
