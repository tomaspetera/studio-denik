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
npm run test:ares      # kontrolní číslice IČO a dohledání v rejstříku
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

**U Gemini se platí předem.** Projekt, kterému patří `GEMINI_API_KEY`, má
v AI Studiu předplacený kredit. Když dojde, každé volání skončí chybou 402
a appka to řekne česky (`AiNoCredit` v `lib/ai.ts`) — dobíjí se v AI Studiu
v části Billing.

**Pošta a AI.** Přehled pošty se obejde bez AI a čte z Gmailu jen hlavičky.
Text zprávy se načte jen na kliknutí („Udělat úkol“, „Návrh odpovědi“) a jen
se souhlasem majitele schránky (`mail_accounts.ai_consent_at`); posílá se
výhradně do Gemini a nikam se neukládá. Z e-mailu vzniká návrh úkolu,
poptávky nebo odpovědi — vždycky jen návrh, který člověk potvrdí, a odpověď
appka nikdy neodesílá. Návrh odpovědi podepisuje appka sama jménem z profilu
(`profiles.full_name`, do AI se neposílá); při registraci je to začátek
e-mailové adresy, mění se v Pošta → Nastavení.

**E-mail píše někdo cizí.** Text zprávy se k AI posílá jako data, ne jako
pokyny, a u návrhu odpovědi jde pokyn uživatele odděleným kanálem se značkou,
kterou odesílatel nezná (`lib/mail-reply.ts`). Návrh odpovědi navíc běží na
větším modelu (`GEMINI_MODEL`), nikdy na lehkém: ten se v měření nechal
textem e-mailu přemluvit zhruba v každém čtvrtém pokusu, větší ani jednou.
Živá zkouška včetně pokusů o podvrh: `npm run test:aiposta` (vymyšlené
e-maily, volá skutečný model, není v `npm test`). Třídění má vlastní,
levnější: `npm run test:aitrideni`.

**Třídění pošty podle priority.** Volitelné a zapíná se zvlášť
(`mail_accounts.ai_auto_at`, jen se základním souhlasem). Při načtení pošty se
text nových zpráv, které čekají na odpověď, pošle do Gemini — každá zvlášť
a větším modelem — a uloží se zařazení (`urgent`, `reply`, `info`) a shrnutí
jednou větou; text zprávy ne. Je to jediné místo, kde e-mail jde do AI bez
kliknutí. Čemu appka nerozumí, nechá mezi zprávami čekajícími na odpověď
(`lib/mail-buckets.ts`) — omyl nesmí zprávu schovat. Vypnutím se zařazení
i shrnutí mažou.

**Štítky Gmailu.** Appka čte doručenou poštu. Komu Gmail zprávy filtrem
přesouvá rovnou do štítků, ten si v Pošta → Nastavení vybere štítky, které se
načítají taky (`mail_accounts.labels`, `lib/mail-labels.ts`). Seznam štítků se
z Gmailu čte až na kliknutí a ukládá se jen výběr — identifikátor a jméno, vždy
podle Gmailu, ne podle toho, co pošle prohlížeč. Podštítek je v Gmailu
samostatný štítek („Ultra_Marine/MRL“), proto se s nadřazeným zaškrtne taky.
Každý vybraný štítek je při načtení další dotaz (`threads?labelIds=…`); vlákna
ze všech zdrojů se slučují střídavě a do stropu 90, aby plná doručená pošta
štítky nevytlačila. Štítek, který v Gmailu zanikl, načtení neshodí. Doručená
pošta je ve výběru jako jeden ze zdrojů (`INBOX_ID`): prázdný výběr znamená jen
doručenou, výběr bez ní jen štítky (`mailSources`) — pro toho, kdo má všechnu
pracovní poštu ve štítcích a nechce, aby appka četla a třídila i soukromou.

**Ranní načítání pošty.** Volitelné a zapíná se zvlášť
(`mail_accounts.auto_sync_at`). V úterý, ve středu a ve čtvrtek
(`lib/mail-schedule.ts`) ranní cron před souhrnem načte poštu schránkám, které
to mají zapnuté — totéž co „Obnovit“, takže třídí jen tomu, kdo má zapnuté
i třídění. Kolik zpráv čeká, je pak na stránce Dnes a v ranním upozornění, ale
jen u majitele schránky: pošta je soukromá. Ranní běh jede se servisním klíčem,
proto každý dotaz na poštu filtruje podle majitele výslovně. Vývojový server
sdílí databázi s ostrým provozem, takže `/api/cron/rano` na něm sahá jen na
jedno zkušební studio (`CRON_TEST_ORG`, den jde podvrhnout přes
`CRON_TEST_TODAY`) a bez něj neudělá nic.

**Čtení příloh.** Volitelné a zapíná se zvlášť (`mail_accounts.ai_files_at`,
jen se základním souhlasem). Když je zapnuté, jdou při kliknutí na „Udělat
úkol“ nebo „Návrh odpovědi“ k AI spolu s textem i přílohy té jedné zprávy;
třídění přílohy nečte nikdy a nic z nich se neukládá. Co k AI smí, rozhoduje
`lib/mail-files.ts`: jen PDF a obrázky (JPG, PNG, WEBP), typ se ověřuje podle
prvních bajtů souboru, ne podle toho, co tvrdí odesílatel, nejvýš 4 soubory,
5 MB na soubor a 10 MB dohromady. Délku hlídá `countTokens` (je zdarma):
strana PDF stojí 560 tokenů, obrázek asi 1 100 a strop 12 000 tokenů odpovídá
zhruba 20 stranám — na větším modelu kolem 20 haléřů za kliknutí. Příloha je
cizí obsah stejně jako e-mail: s přílohami běží i návrh úkolu a poptávky na
větším modelu, protože lehký si v měření nechal pokynem schovaným v PDF
přepsat telefon poptávky v šesti pokusech ze šesti, větší ani jednou. Živá
zkouška: `npm run test:aiprilohy` (vymyšlená PDF z `scripts/zkusebni-soubory.mjs`).

**Report pro jednoho klienta.** Vedle reportu za celé studio může mít každý
klient za týden vlastní report (`reports.client_id`, adresa `/report?klient=…`):
vlastní shrnutí, stav i sdílený odkaz. Zúžení se dělá v dotazu i v čistém
jádru (`lib/report-core.ts`), aby se do reportu pro klienta ani do podkladů
pro AI nedostala práce pro nikoho jiného — hlídá to `npm run test:reportjadro`
a `npm run test:reportklient`.

**Zkouška pošty bez schránky.** Při vývoji jde Gmail nahradit místní atrapou
přes `GMAIL_TEST_API` a `GMAIL_TEST_TOKEN_URL` (`lib/gmail.ts`). V ostrém
provozu se obě proměnné ignorují. Pravidla Googlu pro data z Workspace API dovolují předat je jen
službě, která je nepoužívá k vylepšování modelů — proto má klíč patřit
projektu na placené úrovni. Co appka z Gmailu čte a komu to předává, popisuje
veřejná stránka `/soukromi`; kdykoli se to změní, musí se upravit zároveň.

**PDF vzniká tiskem stránky, ne knihovnou.** Report je navržený jako papírový
arch a tiskový styl schová rozhraní — výsledek je tedy shodný s obrazovkou
a dokument neexistuje ve dvou verzích, které by se rozcházely.
