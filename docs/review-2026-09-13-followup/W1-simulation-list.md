# W1 — P2: Simulations pollhiba eltünteti az utolsó jó listát

Alap: main@72fec82. Hely: `client/src/components/dd-page-simulations.ts:177–198,261–264`. Örökölt hiba, a V4 kért adatmegőrzési feltételének maradéka.

Reprodukció: `/simulations` három betöltött futammal; ugyanennek az oldalnak a következő GET-je 503. A hibaüzenet megjelenik, de az összes futamsor és a lista többi része eltűnik. A `_list()` az `_error` esetén a `_heldFor` vizsgálata előtt visszatér.

Szűk javítás: a hibajelzés és az érvényes, azonos lekérdezéshez tartozó utolsó jó lista együtt jelenjen meg. Más lap adatai továbbra se látszódjanak az új lap alatt. Ne törölj minden adatot minden kérés indításakor.

Elfogadás:

- A `followup.spec.ts` W1 zöld, a meglévő query-identity Simulations betöltés/hiba esetek zöldek.
- Első betöltés hibája nem mutat kitalált üres listát; azonos lap pollhibája megőrzi a jó listát a hibajelzéssel.
- Sikeres következő poll törli a hibát és frissíti a listát.

Külön commit; érintett fájl + célzott public-simulations/query-identity tesztek. Szerver- vagy DTO-módosítás nem indokolt.
