# Studio Deník

Týdenní reporty, hlídání tiskových termínů a stav zakázek pro malé grafické
studio. Úkoly se odškrtávají během týdne, report se z nich pak sestaví sám.

## Na čem to stojí

Celá aplikace se točí kolem jedné otázky: **u koho zrovna leží míč.**

Každý úkol má typ a typ určuje, kolik kroků má jeho štafeta:

| Typ | Kroky |
|---|---|
| Interní | Zadáno → Dělám → Hotovo |
| S klientem | + U klienta |
| Tiskový | + Ke schválení → V tisku → Dodáno → Předáno |

Z kroku, na kterém úkol stojí, se **dopočítá** vlastník míče — u nás, u klienta,
nebo u dodavatele. Nikam se neukládá, takže nemůže přestat sedět se skutečností.

Díky tomu report rozliší „nestihli jsme to“ od „čeká se na tiskárnu“, což je
přesně ten rozdíl, který má příjemce vidět.

## Rozvržení

```
app/(app)/          obrazovky pod přihlášením — Dnes, Úkoly, Tisk, Klienti, Report
app/prihlaseni/     přihlášení odkazem v e-mailu
app/api/report/     streamované generování textu reportu
lib/domain.ts       štafeta a pravidlo „u koho leží míč“
lib/ai.ts           Claude i Gemini, přepínatelně
supabase/migrations schéma, práva a spouštěče
scripts/            ověření nastavení a testy
```

`lib/domain.ts` a `supabase/migrations/0001_schema.sql` popisují **totéž
pravidlo dvakrát** — jednou pro prohlížeč, jednou pro databázi. Hlídá to test
`npm run test:ukoly`, který vloží úkol na každý krok a porovná obě strany.

## Spuštění

```bash
npm install
cp .env.local.example .env.local     # a vyplnit hodnoty
npm run dev
```

### Co vyplnit

| Proměnná | Kde ji vzít |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API Keys |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | tamtéž, klíč `anon` / `sb_publishable_…` |
| `SUPABASE_SERVICE_ROLE_KEY` | tamtéž, klíč `service_role` / `sb_secret_…` |
| `GEMINI_API_KEY` | aistudio.google.com |
| `ANTHROPIC_API_KEY` | console.anthropic.com |

Stačí jeden z těch dvou AI klíčů — aplikace nabídne jen model, ke kterému má
přístup. Model jde přepnout přes `GEMINI_MODEL` nebo `ANTHROPIC_MODEL`, aniž
by se sahalo do kódu.

### Databáze

V Supabase → SQL Editor spusť postupně všechny skripty z
`supabase/migrations/` v pořadí podle čísla. Jdou pouštět opakovaně.

Pohledy musí mít `security_invoker = true`. Bez toho se pohled vykonává
právy svého vlastníka, práva na úrovni řádků se přeskočí a pohled vydá data
všech organizací komukoliv přihlášenému. Hlídá to `npm run test:izolace`.

Kdyby aplikace tvrdila, že tabulky neexistují, ačkoliv v Supabase jsou, chybí
obnovit vyrovnávací paměť:

```sql
notify pgrst, 'reload schema';
```

## Ověření

```bash
npm test             # celá sada proti skutečné databázi

npm run overit         # připojení, schéma, shoda pravidla, dostupnost AI
npm run test:izolace   # vidí člověk z jedné organizace do druhé?
npm run test:ukoly     # štafeta, spouštěče, historie, ochrana rozsahu
npm run test:uprava    # úprava úkolu a přepnutí typu mezi průchody
npm run test:mazani    # kaskáda — mizí i historie a tisková zakázka
npm run test:verejny   # co pustí sdílený odkaz nepřihlášenému návštěvníkovi
npm run test:pozvanky  # pozvání kolegy až po jeho první přihlášení
npm run test:report    # kvalita textu reportu
npm run test:stream    # jestli text opravdu teče průběžně
```

Testy pracují v dočasné organizaci a s dočasnými účty, které po sobě smažou.

Tři z nich se schválně ptají **veřejným klíčem** nebo pod **skutečně
přihlášeným účtem**, ne servisním klíčem — servisní klíč obchází veškerá
práva, takže by měřily něco jiného, než co potká skutečný uživatel.
`test:izolace` běží první: nemá smysl mít pečlivě otestovanou štafetu, když
by se organizace navzájem viděly.

## Poznámky k provozu

**Report se generuje streamovaně.** Model začne odpovídat i po osmi vteřinách
a hostingy omezují, jak dlouho smí funkce běžet. Stream ten limit obchází,
protože odpověď začne odcházet okamžitě.

**Bezplatná úroveň Gemini nemá kvótu na modely `pro`** — vracejí 429 hned
při prvním požadavku. Výchozí je proto `gemini-3.6-flash`. Modely bývají
i přetížené (503), takže se pokus třikrát opakuje.

**PDF vzniká tiskem stránky, ne knihovnou.** Report je navržený jako papírový
arch a tiskový styl schová rozhraní — výsledek je tedy shodný s obrazovkou
a dokument neexistuje ve dvou verzích, které by se rozcházely.
