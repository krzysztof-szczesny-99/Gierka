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
zapis, zbuforowane dane i sprite'y; na mapie pojawiają się tylko gatunki, które były już pobrane.

## Sterowanie

- **Pad** (lewy dolny róg) — działa jak drążek: przesuwaj kciuk w stronę kierunku.
- **Dotknięcie mapy** — postać sama dojdzie w wybrane miejsce (także do stworzenia, tabliczki, drzwi).
- **A** — interakcja (tabliczki, drzwi, stworzenie przed tobą). Dotknięcie własnej postaci działa tak samo.
- **B** — przełącza bieg.
- Klawiatura (komputer): strzałki, Spacja = A, Shift = bieg.
- W walce: dotknięcie areny lub okna komunikatu przyspiesza komunikaty.

## Funkcje gotowe (etap 1)

- Wybór startera spośród trzech stworzeń z każdej z 9 generacji (dane i grafiki pobierane z PokéAPI po otwarciu generacji).
- Oryginalna mapa testowa 40×32 (Polana Startowa) z czterema strefami: Łąka, Brzeg Stawu, Skalny Zakątek, Cichy Gaj.
- Ruch po siatce: pad, dotknięcie celu (wyszukiwanie ścieżki BFS), klawiatura; bieg; kamera z dopasowaniem przybliżenia.
- Stworzenia widoczne na mapie: wędrują po strefach, część podchodzi do gracza („!”), rzadkie „Potężne okazy”,
  błyszczące warianty; odradzanie; formy regionalne (np. `rattata-alola`, `wooper-paldea`).
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

- Etap 2: ewolucje, natury, pierwsze zdolności, przedmioty trzymane, trenerzy z AI, druga mapa i przejścia, import map z Tiled.
- Etap 3: walki podwójne, ruchy wieloturowe, pogoda, współdzielony EXP, lepszy magazyn.
- Etap 4: otwarte strefy (rzut kapsułą z mapy, unik, zachowania stworzeń), pora dnia, zadania badawcze.
- Etap 5: pierwsza przygoda (8 prób), drugi region, megaewolucje, interakcje z towarzyszem.
- Etap 6: Wieża Prób, Turniej Mistrzów Szlaku, Rozdarcie, wyspy, spotkania legendarne.
- Etap 7: oryginalne audio, dostępność, testy E2E.

## Znane ograniczenia etapu 1

- Zdolności i przedmioty trzymane są zapisywane, ale jeszcze nie działają w walce.
- Ruchy wieloturowe (np. ładowanie, odpoczynek po ataku) działają jak zwykły atak; pogoda i pola bitwy — brak.
- Brak ewolucji i trenerów (dane są już przygotowane w modelu).
- Nazwy stworzeń i ruchów są angielskie (PokéAPI nie ma języka polskiego).
- Przerwana walka (zamknięcie aplikacji) nie jest wznawiana — wracasz na mapę sprzed walki.

## Rozwiązywanie problemów

- **„Pierwsze uruchomienie wymaga internetu”** — gra musi raz pobrać tabelę typów i krzywe EXP.
- **Brak stworzeń na mapie** — sprawdź połączenie; offline pojawiają się tylko zbuforowane gatunki.
- **Stara wersja po aktualizacji** — service worker aktualizuje się sam; w razie potrzeby zamknij i otwórz aplikację.
- **Czyste dane** — Menu → „Wyczyść bufor danych” (dane API) lub „Usuń zapis” (postęp).
