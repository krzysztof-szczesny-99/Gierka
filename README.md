# Szlaki Dziczy — prototyp (etap 1 / MVP)

Niekomercyjny, przeglądarkowy prototyp RPG o tropieniu i kolekcjonowaniu stworzeń. Mobile-first, PWA.
Dane o stworzeniach, ruchach, typach i krzywych doświadczenia pochodzą z [PokéAPI](https://pokeapi.co/docs/v2).
Mapa, interfejs, teksty, grafika postaci i kafelków (rysowana proceduralnie) oraz cały kod są oryginalne.

> Projekt fanowski do prywatnej zabawy. Nazwy i grafiki stworzeń należą do ich właścicieli (Nintendo / Creatures /
> GAME FREAK). Nie publikuj go komercyjnie ani w sklepach z aplikacjami. Szczegóły: `docs/PLAN.md`, sekcja 7.

## Wymagania

- Node.js 20 LTS lub nowszy (z npm)
- Przeglądarka: Chrome/Edge/Firefox/Safari (Android i iOS)
- Internet przy pierwszym uruchomieniu (pobranie danych z PokéAPI; potem są w IndexedDB)

## Instalacja i uruchomienie

```bash
npm install
npm run dev          # serwer deweloperski: http://localhost:5173 (+ adres w sieci LAN)
```

| Polecenie | Działanie |
|---|---|
| `npm run dev` | serwer deweloperski z odświeżaniem na żywo (bez service workera) |
| `npm run build` | build produkcyjny do `dist/` (z manifestem i service workerem) |
| `npm run preview` | podgląd buildu: http://localhost:4173 (+ adres w sieci LAN) |
| `npm run typecheck` | kontrola typów TypeScript |
| `npm test` | testy silnika gry (Vitest) |
| `node e2e/smoke.mjs <adres>` | test E2E w Chromium na ekranie telefonu (uruchamiany też automatycznie w GitHub Actions; zrzuty trafiają na gałąź `e2e-results`) |

## Test na telefonie w tej samej sieci Wi-Fi

1. Uruchom `npm run dev`. Vite wypisze adres `Network: http://192.168.x.x:5173`.
   (Adres IP komputera: Windows `ipconfig`, macOS `ipconfig getifaddr en0`, Linux `hostname -I`.)
2. Otwórz ten adres w przeglądarce telefonu. Gra działa w pełni (walki, zapis w IndexedDB).
3. Jeśli strona się nie otwiera: zezwól Node.js w zaporze systemu (Windows: „Zezwól na dostęp” przy pierwszym
   uruchomieniu) i upewnij się, że telefon nie jest w sieci „gościa” z izolacją urządzeń.

### Instalacja jako aplikacja (PWA) i tryb offline

Service worker i instalacja wymagają **HTTPS** (albo `localhost`). Zwykły adres `http://192.168.x.x` w sieci LAN
pozwala grać, ale nie zainstaluje aplikacji. Najpierw zbuduj grę:

```bash
npm run build
npm run preview      # http://localhost:4173
```

Następnie wybierz jedną z opcji:

- **Android, najprościej:** w Chrome na telefonie otwórz `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
  wpisz `http://192.168.x.x:4173`, włącz flagę i uruchom Chrome ponownie. Potem otwórz adres i wybierz
  „Zainstaluj aplikację” (albo przycisk w Menu gry).
- **Android przez USB:** Chrome na komputerze → `chrome://inspect` → *Port forwarding* `4173 → localhost:4173`.
  Na telefonie otwórz `http://localhost:4173`.
- **iOS i Android przez tunel HTTPS:** zainstaluj `cloudflared` i uruchom
  `cloudflared tunnel --url http://localhost:4173`. Otwórz na telefonie wypisany adres `https://…trycloudflare.com`
  (host jest już dozwolony w `vite.config.ts`). Na iOS: Safari → „Udostępnij” → „Do ekranu początkowego”.
- **Hosting statyczny:** wgraj zawartość `dist/` na dowolny hosting z HTTPS (np. Netlify, Cloudflare Pages).
  Zachowaj prywatny link — to projekt fanowski.

### Publikacja na GitHub Pages (bez komputera)

Repozytorium zawiera `.github/workflows/deploy.yml`: każde wypchnięcie na gałąź `main` buduje grę na serwerach
GitHuba (testy + build) i publikuje ją pod adresem `https://<login>.github.io/<repozytorium>/`.

1. Jednorazowo: repozytorium → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Postęp i ewentualne błędy budowania: zakładka **Actions**.
3. iPhone: otwórz adres gry w Safari → „Udostępnij” → „Do ekranu początkowego”. Android: Chrome → „Zainstaluj aplikację”.

Po pierwszym uruchomieniu przez HTTPS gra zgłosi „gotowa do działania offline”. Offline działają: aplikacja,
zapis, zbuforowane dane i sprite'y; w trawie spotkasz offline tylko gatunki, które były już pobrane.

## Sterowanie

- **Joystick** (lewy dolny róg) — przytrzymaj i przesuwaj kciuk; gałka pokazuje wychylenie. Małe wychylenie
  (martwa strefa) nie porusza postaci, puszczenie zatrzymuje ją na najbliższym polu. Ruch odbywa się po siatce
  w 4 kierunkach, więc wychylenie po przekątnej nie przyspiesza postaci.
- Joystick zatrzymuje się sam przy przełączeniu aplikacji, zablokowaniu ekranu i obrocie telefonu.
- **Dotknięcie mapy nie porusza postaci** (od Sprintu 1 głównym sterowaniem jest joystick).
- **A** — interakcja (tabliczki, drzwi, stworzenie przed tobą).
- **B** — przełącza bieg.
- Klawiatura (komputer): strzałki, Spacja = A, Shift = bieg.
- W walce: dotknięcie areny lub okna komunikatu przyspiesza komunikaty.

## Funkcje gotowe (etap 1)

- Wybór startera spośród trzech stworzeń z każdej z 9 generacji (dane i grafiki pobierane z PokéAPI po otwarciu generacji).
- Oryginalna mapa testowa 40×32 (Polana Startowa) z czterema strefami: Łąka, Brzeg Stawu, Skalny Zakątek, Cichy Gaj.
- Model świata (Sprint 3): region „Kraina Szlaków” i lokacje opisane danymi w `src/config/world.ts` (typ, status, mapa,
  połączenia, punkty pojawienia się, tabele spotkań, wymagania, punkt leczenia). Druga oryginalna mapa 26×18 —
  **Szepczący Zagajnik** (wejście ścieżką na wschodnim skraju Polany, przy drogowskazie). Ma własną tabelę spotkań
  w paprociach (m.in. caterpie, weedle, oddish, hoothoot, seedot, skwovet, rzadko fomantis). Północna ścieżka na
  Wzgórza Wiatru jest zablokowana komunikatem (lokacja w planach). Przejście: wygaszenie ekranu, zapis położenia,
  2 kroki ochronne po wejściu. Przegrana w Zagajniku przenosi do Stacji Opieki na Polanie.
- Rozwój stworzeń (Sprint 4):
  - **Natury** — 25 natur (5 neutralnych): +10% jednej statystyki i −10% innej. Widać je w Drużynie (▲/▼ przy statystykach).
  - **Zdolności** — działa 20 prostych zdolności (`src/config/abilities.ts`): wzmocnienie typu przy niskim PŻ, „Groźne
    spojrzenie”, ochrona statystyk, odporności na status, „Zrzucanie skóry”, „Chłonięcie wody”, „Gruby tłuszcz”,
    „Ucieczka”, „Pyłek osłonny”, „Ranny ptaszek”. Pozostałe zdolności są opisane w Drużynie jako „jeszcze nie działa”.
  - **Przedmioty trzymane** — 10 przedmiotów w Kramie (wzmacniacze typów, opaska, okulary, resztki, jagody, pazur,
    obciążnik). Zakładanie z Torby lub Drużyny zabiera 1 sztukę z torby, a zdjęcie ją zwraca.
  - **Ewolucje** — dane łańcucha z PokéAPI (bufor) przetwarzane do lokalnego modelu. Ewolucja przez poziom (okno po walce,
    „Ewoluuj” / „Przerwij”, przycisk w Drużynie) i przez kamień z Torby. Ruchy, poziom i doświadczenie zostają.
    Warunki, których silnik nie obsługuje (przyjaźń, pora dnia, wymiana, miejsce, formy regionalne), są oznaczone
    NOT_IMPLEMENTED.
- Zapis w formacie v3 (Sprint 4: natura, zdolność, przedmiot i stan ewolucji stworzeń; wcześniej v2 — położenie w świecie). Starsze zapisy (v1) są migrowane automatycznie —
  postęp i pozycja na Polanie zostają. Błędna lokacja lub pozycja w zapisie → bezpieczny punkt pojawienia się.
- Ruch po siatce: joystick ekranowy, opcjonalnie klawiatura; bieg; kamera z dopasowaniem przybliżenia.
- Spotkania przez jedną centralną blokadę (tylko jedno naraz, wynik walki liczony dokładnie raz, krótkie odnowienie po walce).
- Losowe spotkania po kroku (Sprint 2): wysoka trawa (Łąka, brzeg Stawu, Cichy Gaj) — 10% na krok, skalisty grunt
  Skalnego Zakątka (teren jaskini) — 8%; po walce 3 kroki bez spotkań, po wejściu na mapę 2 kroki ochronne.
  Osada, ścieżki i zwykła trawa są bezpieczne. Wartości i tabele: `src/config/encounters.ts`.
- Zwykłe dzikie stworzenia nie chodzą po mapie; widoczny jest tylko nieruchomy „Strażnik Cichego Gaju”
  (spotkanie specjalne — po wygranej lub złapaniu znika na stałe). Rzadkie „Potężne okazy”, błyszczące warianty,
  formy regionalne (np. `rattata-alola`, `wooper-paldea`).
- Towarzysz (prowadzący drużyny) podąża za graczem.
- Dynamiczne przejście eksploracja → walka (rozbłysk kamery + oryginalny efekt przejścia).
- Walka turowa 1 na 1: 4 ruchy, priorytet i szybkość, STAB, skuteczność typów (z PokéAPI), krytyki, celność i unik,
  wielokrotne trafienia, drenaż i odrzut, ruchy stałych obrażeń, leczenie, zmiany statystyk, statusy (paraliż, sen,
  zamrożenie, oparzenie, zatrucie) i dezorientacja, ruch awaryjny bez PP.
- Łapanie kapsułami (wzór zależny od HP, statusu i wskaźnika łapania) z animacją i podpowiedzią szansy.
- Drużyna maks. 6 + magazyn, zmiana stworzenia w walce, wymuszona zmiana po omdleniu, porażka → Stacja Opieki.
- Doświadczenie z krzywych PokéAPI, poziomy, przeliczanie statystyk, punkty wysiłku, nauka ruchów (wybór ruchu do zapomnienia).
- Stacja Opieki, Kram, torba (kapsuły, napary, balsam), Atlas (zobaczone/złapane), dziennik zadań z nagrodami.
- Zapis w IndexedDB: autozapis, zapis przy wyjściu z aplikacji, eksport/import JSON.
- PWA: manifest, ikony, service worker, bufor sprite'ów, tryb offline, przycisk instalacji (Android) i instrukcja dla iOS.
- Bufor danych PokéAPI w IndexedDB (TTL 30 dni, maks. 4 równoległe zapytania, ponowienia, obsługa braku sieci).
- Przełącznik oryginalnych grafik zastępczych zamiast sprite'ów z PokéAPI.

## Zaplanowane (kolejne etapy)

- Etap 2: trenerzy z AI, kolejne zdolności i przedmioty, trudniejsze warunki ewolucji, kolejne lokacje (Wzgórza Wiatru), import map z Tiled.
- Etap 3: walki podwójne, ruchy wieloturowe, pogoda, współdzielony EXP, lepszy magazyn.
- Etap 4: otwarte strefy (rzut kapsułą z mapy, unik, zachowania stworzeń), pora dnia, zadania badawcze.
- Etap 5: pierwsza przygoda (8 prób), drugi region, megaewolucje, interakcje z towarzyszem.
- Etap 6: Wieża Prób, Turniej Mistrzów Szlaku, Rozdarcie, wyspy, spotkania legendarne.
- Etap 7: oryginalne audio, dostępność, testy E2E.

## Znane ograniczenia etapu 1

- Działa 20 zdolności i 10 przedmiotów trzymanych — pozostałe zdolności z PokéAPI są tylko zapisywane.
- Ewolucje: tylko poziom i kamień (opcjonalnie z płcią); formy regionalne jeszcze nie ewoluują.
- Ruchy wieloturowe (np. ładowanie, odpoczynek po ataku) działają jak zwykły atak; pogoda i pola bitwy — brak.
- Brak trenerów (dane są już przygotowane w modelu).
- Nazwy stworzeń i ruchów są angielskie (PokéAPI nie ma języka polskiego).
- Przerwana walka (zamknięcie aplikacji) nie jest wznawiana — wracasz na mapę sprzed walki.

## Rozwiązywanie problemów

- **„Pierwsze uruchomienie wymaga internetu”** — gra musi raz pobrać tabelę typów i krzywe EXP.
- **Brak spotkań offline** — offline w trawie losowane są tylko gatunki, które były już pobrane.
- **Stara wersja po aktualizacji** — gra porównuje swoją wersję (Menu → „Wersja gry”) z plikiem `version.json` na serwerze.
  Gdy serwer ma nowszą, a telefon jej nie pobrał (iPhone potrafi trzymać stare pliki aplikacji z ekranu głównego),
  na ekranie tytułowym gra aktualizuje się sama, a w trakcie gry pokazuje baner „Aktualizuj teraz”. To samo robi
  przycisk „Sprawdź aktualizację” w Menu. Wymuszona aktualizacja zapisuje grę, usuwa bufor plików aplikacji (zapis
  i sprite'y zostają) i wczytuje stronę z serwera. Jeśli telefon ma wersję sprzed tej poprawki — uruchom iPhone'a
  ponownie i otwórz grę. Nie usuwaj ikony z ekranu głównego: na iPhonie usunęłoby to też zapis gry.
- **Czyste dane** — Menu → „Wyczyść bufor danych” (dane API) lub „Usuń zapis” (postęp).
