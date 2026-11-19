# Sprint 0 — audyt repozytorium „Gierka” (Szlaki Dziczy)

Data: 19.11.2026. Zakres: stan gałęzi `main` = `991a40b` („Wybór startera z każdej z 9 generacji”).
Gałąź sprintu: `sprint-0-audyt`. Mechaniki gry nie były zmieniane.

Dowody pochodzą z trzech źródeł:
- **kod** — analiza plików (ścieżki i numery linii poniżej),
- **CI** — workflow `ci.yml` na gałęzi sprintu (kontrola typów, testy, build, E2E),
- **sondy** — `e2e/audit-probes.mjs` uruchomione na prawdziwym buildzie z Phaserem i PokéAPI w Chromium
  (ekran 390×844, dotyk). Oznaczenia `P1`…`P15` odnoszą się do wyników sond.

---

## 1. Zweryfikowana architektura

### Zależności (rozwiązane w CI, `npm ls --depth=0`)

| Pakiet | Deklaracja | Zainstalowano |
|---|---|---|
| react / react-dom | ^19.1.0 | 19.3.1 |
| phaser | ^3.90.0 | 3.90.0 |
| zustand | ^5.0.5 | 5.1.0 |
| dexie | ^4.0.11 | 4.4.7 |
| vite | ^6.3.5 | 6.4.6 |
| vite-plugin-pwa | ^1.0.0 | 1.3.0 |
| workbox-build / workbox-window | ^7.3.0 | 7.4.1 |
| typescript | ~5.8.3 | 5.8.3 |
| vitest | ^3.2.0 | 3.2.7 |
| @vitejs/plugin-react | ^4.5.0 | 4.7.0 |

Brak `package-lock.json`: każdy build rozwiązuje wersje od nowa.

### Struktura

- `src/api` — klient PokéAPI (`pokeapi.ts`: kolejka maks. 4 zapytań, 2 ponowienia, timeout 15 s, wykrywanie offline),
  typy surowe (`raw.ts`), normalizacja (`normalize.ts`).
- `src/data` — Dexie (`db.ts`: baza `szlaki-dziczy`, `version(1)`, tabele `cache` i `saves`), bufor
  (`repository.ts`: pamięć → IndexedDB → API, TTL 30 dni, klucze z prefiksem `v1:`, przy braku sieci zwraca
  przeterminowane dane), zapis (`saveGame.ts`).
- `src/engine` — czysty TS: statystyki, typy, EXP, ruchy, tworzenie stworzeń, silnik walki (`battle/`).
- `src/game` — Phaser: `PhaserGame.tsx` (tworzy `Phaser.Game`, niszczy przy odmontowaniu), `scenes/BootScene.ts`
  (tekstury proceduralne), `scenes/OverworldScene.ts` (eksploracja), `eventBus.ts`, `input.ts`, `tiles.ts`,
  `art.ts`, `textures.ts`, `pathfinding.ts`, `maps/testMap.ts`.
- `src/services` — orkiestracja: `encounterService.ts` (start i koniec walki, drzwi), `creatureService.ts`
  (budowa stworzeń), `bootService.ts`.
- `src/state` — Zustand: `gameStore.ts` (dane trwałe), `uiStore.ts` (tryb, okna, dialog, przejście, kolejka nauki),
  `battleStore.ts` (stan silnika, model widoku, odtwarzanie zdarzeń).
- `src/ui` — React: ekrany, menu, komponenty, `styles/global.css`.
- `src/debug.ts` — tryb `?debug` udostępnia `window.__szlaki` (gra, store'y, bus) dla testów E2E.
- `e2e/` — `smoke.mjs` (E2E), `audit-probes.mjs` (sondy Sprintu 0).
- `.github/workflows/` — `deploy.yml` (main → GitHub Pages), `e2e.yml` (main → test i zrzuty na gałąź
  `e2e-results`), `ci.yml` (gałęzie robocze, bez publikacji; dodany w Sprincie 0).

### Integracja React ↔ Phaser

- `App.tsx:33` montuje `OverworldScreen` (z `PhaserGame`) w trybach `overworld` i `battle`; walka (`BattleScreen`)
  jest nakładką DOM nad płótnem. Wyjście do ekranu tytułowego niszczy grę Phasera.
- Komunikacja: `eventBus.ts` (zdarzenia `encounter`, `battle-start`, `battle-end`, `dialog`, `door`, `teleport`)
  oraz subskrypcje Zustand w scenie (`OverworldScene.ts:152–160`: odświeżanie towarzysza, usypianie pętli Phasera
  na czas walki: `game.loop.sleep()` / `wake(true)`).
- Sterowanie ekranowe przekazywane przez moduł `game/input.ts` (`virtualInput`), poza Zustandem.

### PWA

- `vite.config.ts`: `registerType: 'autoUpdate'`, `injectRegister: false` (rejestracja w `main.tsx` tylko w
  bezpiecznym kontekście), precache 18 plików (≈1,98 MB), `navigateFallback: index.html`, CacheFirst dla sprite'ów
  z `raw.githubusercontent.com/PokeAPI/sprites`, manifest z ikonami 192/512/maskable, `orientation: any`.
- Sonda P11: service worker gotowy i kontrolujący stronę; po przejściu offline gra startuje, wczytuje zapis,
  pokazuje 12 stworzeń z bufora i towarzysza.

---

## 2. Mapa przepływu: eksploracja → walka → eksploracja

| Etap | Plik | Funkcja / store / zdarzenie |
|---|---|---|
| Eksploracja | `game/scenes/OverworldScene.ts` | `update()` (183): `isOverworldBlocked()` z `uiStore`, lokalne `encounterLock`; `tryStep()` (242); `updateActors()` (545); `maintainSpawns()` (455) co 1,8 s |
| Wykrycie kontaktu | `OverworldScene.ts` | 1) gracz wchodzi na pole stworzenia: `tryStep` → `actorAt` (247) → `startEncounter` (250); 2) przycisk A / dotknięcie własnej postaci: `interactFront()` (339) → `startEncounter` (344); 3) dotknięcie stworzenia: `onPointerUp()` (368) → ścieżka BFS z `pathTargetActor`, ostatni krok = 1); 4) agresywne stworzenie: `updateActors()` → `startEncounter` (579), tylko gdy gracz nie jest w ruchu |
| Inicjacja spotkania | `OverworldScene.startEncounter()` (410) | `encounterLock = true`, `actor.engaged = true`, błysk i wstrząs kamery, `bus.emit('encounter', { actorId, spawn })` |
| | `services/encounterService.ts` | `installEncounterHandlers()` (176) → `startWildEncounter()` (21): sprawdza `uiStore.mode === 'overworld'` i `!transition`; `setTransition(true)`; dane z bufora (`getTypeChart`, `getPokemon`, `loadMovesSafe`, `getGrowthTables`); `createWildBattle()` (`engine/battle/battleEngine.ts:231`); `markSeen`; min. 750 ms przejścia |
| Interfejs walki | `state/battleStore.ts` | `begin()` (245) → odtwarzanie zdarzeń `play()` (220) → faza `choose`; `uiStore.setMode('battle')` → scena usypia pętlę Phasera; `App.tsx:34` montuje `BattleScreen` |
| Przebieg walki | `battleStore.submit()` (252) / `chooseSwitch()` (260) | `resolveTurn()` (`battleEngine.ts:284`) / `forceSwitch()` (336); aktywny przeciwnik: `battleStore.engine.sides[1]`, metadane: `battleStore.meta` (`actorId`, `zoneId`, `enemySpecies`) |
| Wynik walki | `battleEngine.ts` | `setOutcome()` (124): `win` (`handleFaints` 705), `caught` (`useItem` 390), `fled` (`tryRun` 344), `lose` (`handleFaints`); faza `ended` (`battleStore.ts:228`) |
| Zakończenie | `ui/screens/BattleScreen.tsx:194` | przycisk „Dalej” → `finishBattle()` (`encounterService.ts:70`): `updateCreatures`, nagrody i liczniki, złapanie (`addCreature`, `markCaught`), porażka (leczenie, kara, `setPosition`), nauka ruchów (`await getMove`), `battle.clear()`, `setMode('overworld')` |
| Powrót do eksploracji | `encounterService.ts:142–149` | `bus.emit('battle-end', { actorId, outcome })`, przy porażce `bus.emit('teleport')`, dialog z podsumowaniem, kolejka nauki ruchów, `saveNow()` |
| | `OverworldScene.onBattleEnd()` (427) | `encounterLock = false`; `win`/`caught`/`lose` → `removeActor()`; `fled`/`cancel` → stworzenie zostaje, 6 s odnowienia, przestaje być agresywne; `teleport()` (321) |

---

## 3. Działające mechaniki (z dowodem)

| Mechanika | Dowód |
|---|---|
| Wybór startera (9 generacji, dane pobierane po otwarciu zakładki) | E2E smoke (gen. IX, V), sonda S0 |
| Mapa, kolizje, strefy, towarzysz | E2E smoke, S0, P11 |
| Pad, klawiatura, dotknięcie celu, bieg | E2E smoke; P3 (pointercancel zatrzymuje ruch), P4b (klawiatura zatrzymuje się po utracie fokusu) |
| Stworzenia na mapie: pojawianie się, ruch, pościg, odnowienie po ucieczce | E2E smoke, P8 |
| Jedno spotkanie przy dwóch kontaktach w tej samej klatce; brak ruchu w przejściu | P6a, P6b |
| Walka (zwycięstwo, awans), ucieczka, przegrana z powrotem do Stacji Opieki | E2E smoke, P8, P9 |
| Zapis IndexedDB i wczytanie po przeładowaniu | P10 |
| Bufor PokéAPI: każdy zasób pobrany najwyżej raz; menu nie wysyła zapytań; chodzenie nie wysyła zapytań | P12 (93 zapytania, 93 unikalne), P1, P2 |
| PWA i offline po pierwszym uruchomieniu | P11 |
| Silnik walki (statystyki, typy, obrażenia, łapanie, EXP, wymuszona zmiana) | 14 testów jednostkowych |
| Brak błędów i ostrzeżeń konsoli | E2E smoke (0 problemów), P14 |

Mechaniki działające według kodu, ale niezweryfikowane automatycznie w Sprincie 0: łapanie przez interfejs
na prawdziwym buildzie, sklep, torba poza walką, dziennik i odbieranie nagród, nauka ruchu z wyborem
(okno `LearnMoveModal`), eksport i import zapisu.

---

## 4. Mechaniki brakujące i częściowe

Istnieje tylko model danych albo kod niepodłączony do rozgrywki. Nie należy ich oznaczać jako ukończonych.

- Walki podwójne: `BattleState.format` ma tylko `'single'`; strony mają tablice `active`, ale silnik obsługuje 1 slot.
- Trenerzy: `SideKind 'trainer'`, AI w trybie `smart` (`engine/battle/ai.ts`), komunikaty o tropicielach — brak
  trenerów w grze.
- Zdolności: pole `Creature.ability` jest wyświetlane, efekty nie działają.
- Przedmioty trzymane: pole `heldItem` nieużywane.
- Ewolucje: `SpeciesData.evolutionChainId` pobierane, brak logiki.
- Przyjaźń (`friendship`), natury (brak), formy (`varieties`), legendarność (`isLegendary`) — tylko dane.
- Ruchy wieloturowe, pogoda, pola — brak (działają jak zwykły atak albo „nic się nie dzieje”).
- Wznowienie przerwanej walki po zamknięciu aplikacji — brak (znane ograniczenie).
- Deterministyczny seed rozgrywki: brak (patrz problem J4).

Nieużywane eksporty: `getMoves` (`data/repository.ts`, zastąpione przez `loadMovesSafe`), `hasSave`
(`data/saveGame.ts`), `isFainted` i `recalcStats` (`engine/creature.ts`).
Puste funkcje, atrapy, `TODO`: nie znaleziono.

---

## 5. Problemy

### Krytyczne

**K1. Podwójne „Dalej” dubluje wynik walki** (sonda P7, powtórzone w każdym z 4 przebiegów sond)
`BattleScreen.tsx:194` wywołuje `finishBattle()` bez blokady. `finishBattle` (`encounterService.ts:70`) przed
`battle.clear()` czeka na `getMove()` dla ruchów do nauczenia (122–136). Drugie dotknięcie w tym czasie
uruchamia całą funkcję ponownie.
Wynik sondy: zwycięstwo policzone 2 razy (`battlesWon` 0 → 2), nagroda w żetonach dodana dwukrotnie.
Z kodu wynika, że przy złapaniu do drużyny trafiłyby dwie kopie stworzenia.
Warunek: awans z nowym ruchem na końcu walki. Bez oczekującej nauki ruchu funkcja kończy się synchronicznie
i problem nie występuje.

**K2. Blokada spotkań nie ma właściciela i jest rozproszona** (sonda P6c, powtórzone w każdym z 4 przebiegów sond)
Stan blokady jest w trzech miejscach: `OverworldScene.encounterLock` (boolean), `uiStore.mode`/`transition`
oraz `battleStore.phase`. `onBattleEnd()` zwalnia blokadę dla dowolnego `actorId`. Sonda wysłała drugie
zdarzenie `encounter` w trakcie przejścia: zostało anulowane, a jego `battle-end: cancel` zwolniło blokadę
trwającego spotkania (`lockPoObcymAnulowaniu: false`). Dziś jedynym źródłem spotkań są stworzenia na mapie
i scena sama się pilnuje, więc skutek jest ukryty. Przy kolejnych źródłach (trawa, trenerzy, rzut kapsułą)
to błąd krytyczny. Nie spełnia zasady 17 (jeden centralny mechanizm blokady).

**K3. Po obrocie ekranu gra nie dopasowuje rozmiaru** (sondy P5, P5b, przyczyna potwierdzona w kodzie Phasera)
Po zmianie 390×844 → 844×390 rodzic płótna (`.phaser-root`) ma od razu 844×390, a `game.scale` i kamera
zostają przy 390×844 (pomiar do 1,6 s). Gra nadrabia dopiero przy następnym obrocie, więc zawsze jest
„o jeden obrót do tyłu”. Przyczyna w Phaser 3.90 (`ScaleManager.startListeners`, linia 1531): listener
`orientationchange` wywołuje `refresh()` z nieaktualnym `parentSize`. `updateScale()` (≈1168) pobiera nowy
rozmiar rodzica, ale nie odświeża już gry, a `step()` (1694) nie widzi potem zmiany.
Kod gry tego nie obsługuje (brak `ResizeObserver` i ręcznego `scale.refresh()`).
Wynik dotyczy emulacji telefonu w Chromium. Na prawdziwym iPhonie nie było testu, ale tam też
`orientationchange` przychodzi przed przeliczeniem układu.

**K4. Pad nie zatrzymuje ruchu po utracie fokusu** (sonda P4a, powtórzone w każdym z 4 przebiegów sond)
`ui/components/Controls.tsx` zeruje kierunek tylko na `pointerup`, `pointercancel`, `lostpointercapture`
i przy odmontowaniu. Brak obsługi `blur` i `visibilitychange` dla `virtualInput` (`game/input.ts`).
Po `blur` postać szła dalej (np. z [8,6] do [8,11] w 900 ms). Klawiatura zatrzymuje się poprawnie (P4b),
bo Phaser sam czyści klawisze przy utracie fokusu.

### Poważne (proces i jakość)

- **J1. Publikacja nie czeka na testy.** `deploy.yml`: kontrola typów ma `continue-on-error: true`, a E2E
  (`e2e.yml`) działa równolegle i nie blokuje publikacji. Narusza zasadę 22.
- **J2. E2E kończyło się sukcesem mimo problemów.** `smoke.mjs` nie ustawiał kodu wyjścia. Naprawione na
  gałęzi `sprint-0-audyt`; na `main` trafi po zatwierdzeniu.
- **J3. Brak `package-lock.json`** — wersje się zmieniają (tabela w sekcji 1), buildy nie są powtarzalne.
- **J4. Losowość rozgrywki bez seeda.** `gameRng = createRng()` (`engine/rng.ts:45`) używa `Date.now()`;
  korzystają z niego odradzanie i AI stworzeń, wybór starterów, walki i nagrody. Silnik da się testować
  z seedem, ale gry i E2E nie (każdy przebieg ma inne stworzenia). Narusza zasadę 16.
- **J5. Testy jednostkowe tylko dla silnika walki (14).** Brak testów dla store'ów, `saveGame`
  (migracje), `encounterService`, `pathfinding`, normalizacji i bufora.
- **J6. Luki w E2E.** Spotkanie jest wywoływane przez `?debug` (`sc.startEncounter`), a nie przez dotknięcie.
  Smoke nie obejmuje łapania, przegranej, zapisu ani offline (sondy obejmują część z nich, tylko informacyjnie).

### Drobne

- **D1.** Odradzanie trwa przy otwartym oknie lub dialogu (P15: od 4 do 13 stworzeń w 6 s przy otwartym Atlasie).
  `maintainSpawns()` sprawdza tylko `encounterLock`.
- **D2.** Przełącznik „Grafiki stworzeń z PokéAPI” nie odświeża stworzeń już widocznych na mapie (z kodu).
- **D3.** Autozapis co ok. 10 s, bo licznik czasu gry zmienia `player` (`saveGame.ts`, `setInterval`).
- **D4.** `registerType: 'autoUpdate'` może przeładować aplikację w trakcie gry, także w walce (z konfiguracji,
  niesprawdzone).
- **D5.** Przerwana walka nie jest wznawiana (znane ograniczenie).
- **D6.** Nieużywane eksporty (sekcja 4).

---

## 6. Miejsca ryzyka regresji

- `OverworldScene.ts`: `update`, `tryStep`, `updateActors`, `startEncounter`, `onBattleEnd` — wspólny stan
  ruchu, ścieżki, aktorów i blokady.
- `encounterService.ts`: `startWildEncounter` i `finishBattle` — nagrody, złapanie, porażka, nauka ruchów, zapis.
- `battleStore.ts`: fazy (`intro`, `playing`, `choose`, `forcedSwitch`, `ended`) i odtwarzanie zdarzeń.
- `uiStore.isOverworldBlocked()` — używane przez scenę do blokowania ruchu, wejścia i dotknięć.
- Usypianie i budzenie pętli Phasera (`OverworldScene.ts:157–160`) — zależne od `uiStore.mode`.
- Zapis: `GameData` (`SAVE_VERSION = 1`), `loadData()` (scalanie z domyślnymi), `migrate()` (tylko sprawdzenie wersji).
- Pad i przyciski A/B (`Controls.tsx`) — mobilny dotyk, przechwytywanie wskaźnika.
- Tryb `?debug` — E2E i sondy zależą od nazw pól sceny (`tx`, `ty`, `actors`, `encounterLock`, `startEncounter`).

---

## 7. Pliki do zmiany w Sprincie 1

| Plik | Zmiana |
|---|---|
| `src/state/uiStore.ts` | centralna blokada interakcji ze stanem i właścicielem (rozszerzenie istniejącego store'u) |
| `src/game/scenes/OverworldScene.ts` | korzystanie z centralnej blokady zamiast `encounterLock`; wstrzymanie odradzania przy blokadzie |
| `src/game/eventBus.ts` | identyfikator spotkania w `encounter` / `battle-end` |
| `src/services/encounterService.ts` | weryfikacja właściciela; idempotentne `finishBattle` |
| `src/state/battleStore.ts` | faza `finishing` |
| `src/ui/screens/BattleScreen.tsx` | „Dalej” zablokowane podczas kończenia |
| `src/game/input.ts`, `src/ui/components/Controls.tsx` | zerowanie wejścia przy `blur`, `visibilitychange`, `pagehide` |
| `src/game/PhaserGame.tsx` | `ResizeObserver` na `.phaser-root` → `game.scale.getParentBounds()` + `refresh()` |
| `src/engine/rng.ts`, `src/debug.ts` | ustawianie seeda (np. `?debug&seed=123`) |
| `src/**/__tests__/*.test.ts` | testy regresji (blokada, idempotentne zakończenie, seed) |
| `e2e/smoke.mjs`, `e2e/audit-probes.mjs` | sondy P4a, P5b, P6c, P7 jako twarde asercje regresji |
| `.github/workflows/deploy.yml` | publikacja dopiero po kontroli typów, testach i E2E |
| `docs/PLAN.md` | aktualizacje z sekcji 10 |

---

## 8. Minimalny plan Sprintu 1 (sterowanie i spotkania)

1. **Centralna blokada interakcji** w `uiStore`: stan
   `explore | encounter-starting | battle | battle-ending` z identyfikatorem właściciela.
   API: `requestEncounter(sourceId) → token | null` oraz `releaseEncounter(token)`.
   Każde źródło spotkania przechodzi przez to API. Scena i serwis nie trzymają już własnych flag.
2. **Idempotentne zakończenie walki**: faza `finishing` w `battleStore`, `finishBattle` wykonuje się raz,
   przycisk zablokowany.
3. **Odporne sterowanie**: zerowanie `virtualInput` przy `blur`, `visibilitychange` (ukrycie) i `pagehide`.
4. **Obrót ekranu**: `ResizeObserver` w `PhaserGame.tsx` wymusza `scale.refresh()` po zmianie rozmiaru rodzica.
5. **Seed**: możliwość ustawienia seeda `gameRng` w trybie testowym. Domyślne zachowanie gry bez zmian.
6. **Testy**: jednostkowe dla pkt 1, 2, 5 (z `vi.mock` zapisu, bez nowych zależności) oraz E2E dla pkt 1–4.
7. **Proces**: `deploy.yml` publikuje dopiero po kontroli typów, testach jednostkowych i E2E.

Poza zakresem Sprintu 1: nowe źródła spotkań, trenerzy, walki podwójne, zmiana formatu zapisu.

---

## 9. Kryteria akceptacji Sprintu 1

1. P7: podwójne dotknięcie „Dalej” z oczekującą nauką ruchu zwiększa licznik wyniku dokładnie o 1;
   złapane stworzenie dodane raz.
2. P6c: anulowanie innego spotkania nie zwalnia blokady trwającego. Blokadę zwalnia tylko jej właściciel.
3. W kodzie zdarzenie `encounter` wysyła wyłącznie centralny mechanizm (sprawdzane `grep`em w CI).
4. P6a i P6b bez zmian: jedno spotkanie przy dwóch kontaktach, brak ruchu w przejściu.
5. P4a: po `blur` i po ukryciu strony pad zatrzymuje postać najpóźniej po bieżącym kroku.
6. P5/P5b: po trzech kolejnych obrotach rozmiar gry i kamery równa się rozmiarowi rodzica w ciągu 500 ms.
7. Ten sam seed daje te same pierwsze 3 stworzenia (gatunek, poziom, pole) w dwóch przebiegach.
8. Bez regresji: E2E smoke 0 problemów, P1, P2, P3, P4b, P8–P12 i P14 = OK, testy jednostkowe (14 + nowe)
   przechodzą, kontrola typów 0 błędów, build przechodzi.
9. Zapis v1 wczytuje się bez zmian (test z przykładowym zapisem). Format zapisu się nie zmienia; gdyby
   musiał, to z `SAVE_VERSION = 2`, migracją i testem.
10. Publikacja na GitHub Pages następuje dopiero po przejściu wszystkich kontroli.

---

## 10. Co zaktualizować w `docs/PLAN.md`

- **Sekcja 3 (stack):** dopisać rzeczywiste wersje z tabeli w sekcji 1 i brak `package-lock.json`;
  hosting na GitHub Pages przez GitHub Actions.
- **Sekcja 5 (struktura):** dopisać `src/debug.ts`, `e2e/` (smoke, sondy), `.github/workflows/`
  (deploy, e2e, ci), `docs/mapa-podglad.png`, `docs/AUDYT-SPRINT-0.md`. Usunąć `KOD-ETAPU-1.md`
  (nie ma go w repozytorium).
- **Sekcja 6 (etapy):** etap 1 obejmuje już wybór starterów z 9 generacji, publikację i E2E.
  Dodać harmonogram sprintów (Sprint 1: sterowanie i spotkania).
- **Sekcja 7 (ograniczenia techniczne):** osobny zapis dla aplikacji na ekranie głównym iOS i dla Safari;
  znany problem obrotu ekranu (K3); brak wznawiania walki.
- **Nowa sekcja „Jakość”:** potok CI (typy → testy → build → E2E → publikacja), tryb `?debug`, seed.
