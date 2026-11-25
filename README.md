# SmartStaffEcosys v0.4 (2026-11-25)

Katonai törzs tervezési folyamatának (MDMP) fejlesztési alapja: harcvezető központ nézet (térkép, JCHAT, döntési ablak), gépi folyamatleírás, adatbázis belépéssel és döntési kapukkal, valamint n8n-futtató az első két szakaszra. A pilot szint a dandártörzs.

Verziók: webfelület v0.4; folyamatdefiníció, adatbázis, promptok és n8n-futtató változatlanul v0.3.

**Csak nyílt vagy fiktív adat.** A tároló nem tartalmazhat minősített, nem nyilvános vagy személyes adatot, sem forrás-PDF-eket. A gyakorló parancs teljesen kitalált.

## Állapot

| Elem | Állapot |
| --- | --- |
| Harcvezető központ (`index.html`) | szimuláció előre megírt fiktív üzenetekkel; 390 px-től 1600 px-ig tesztelve |
| Folyamatdefiníció, motor, folyamatnézet | tesztelve |
| Adatbázis-séma, API, jogosultságok | helyi PostgreSQL 16-on, Supabase-helyettesítővel tesztelve; Supabase-re még nincs telepítve |
| Döntési ablak (`live.html`) | helyi adatbázissal tesztelve; a `config.js` még üres |
| n8n-futtató (WF-01, WF-02) | vázlatként elkészült, nincs publikálva; szimulált adatokkal lefutott, valódi modellhívás még nem volt |

## Tartalom

| Útvonal | Mi ez |
| --- | --- |
| `tools/build_process.py` | A folyamat egyetlen forrása; ellenőrzi és generálja a JSON-t, a seedet és a demóadatot |
| `public/data/process.json` | 8 szakasz, 55 allépés, 12 döntési kapu, agentek, törzsszintek, profilok |
| `public/index.html`, `cp.js`, `cp.css` | Harcvezető központ (nincs háttérszolgáltatás, nincs MI-hívás) |
| `public/map.js` | Fiktív terep SVG-ben: nagyítás, mozgatás, jelek |
| `public/scenario.js` | Fiktív forgatókönyv: elemek, hálók, üzenetek, COA-vázlatok, események |
| `public/sim.js` | A JCHAT és a térképi helyzet levezetése a motor naplójából |
| `public/process.html` | Háttérnézet: a törzsmunka lépései, napló, agentek, profilok |
| `public/live.html` | Belépéses döntési ablak az adatbázishoz |
| `prompts/agents.json` | Az agentek rendszerpromptjai |
| `exercise/` | Fiktív gyakorló parancs és helyzetadatok |
| `db/sse_schema_*.sql` | PostgreSQL-séma: többszintű törzs, minősítési zár, módosíthatatlan döntési napló |
| `db/sse_gate_seed_*.sql` | Generált: kapuk, allépések, szakaszok, agentek |
| `db/sse_api_*.sql` | Az egyetlen külső belépési pont: `public.sse_*` függvények |
| `db/sse_demo_setup_*.sql` | Generált: fiktív dandár, felhasználó-hozzárendelés, `GYAKORLAT-01` ügy |
| `tools/build_n8n.py`, `n8n/` | Az n8n-futtató forrása és generált SDK-kódja |
| `db/test/`, `tests/` | Tesztek |

## Futtatás

```bash
python3 tools/build_process.py          # definíció ellenőrzése és generálása
python3 tools/build_n8n.py              # n8n-kód generálása
node --test tests/*.test.mjs            # motortesztek (Node 20+)
bash db/test/run.sh                     # séma-, API- és adatfolyam-teszt (PostgreSQL 16)
python3 -m http.server -d public 8000   # http://localhost:8000
```

## Harcvezető központ

A TERDEF wargaming platform felépítését követi (központi térkép, JCHAT, szervezeti elemek állapotjelzővel, térképi események, teljes képernyős panelek), saját kóddal és fiktív tereppel.

- **▶ Indítás**: a törzsfolyamat a háttérben lép; a közlések a JCHAT-ben, a változások a térképen jelennek meg. Emberi döntésnél megáll és felugró ablakban kér döntést; döntés után folytatódik.
- **Térkép**: saját és ellenséges erők, megközelítési irányok, megfigyelési körzetek, COA-vázlatok, a parancs vonalai, eltérések. Egység, átkelőhely vagy esemény érintésére adatlap nyílik.
- **JCHAT**: hálók, olvasatlan-jelzés, elem szerinti szűrés, válasz idézettel, térképi hivatkozás, CSV-mentés.
- **Hadijáték**: a COA-k ötfordulós vázlatos lejátszása. Nem harcérték-számítás.
- **＋ Esemény**: gyakorlatvezetői esemény elhelyezése a térképen.

Határok: minden közlés, helyzet és mozgás előre megírt. A beírt szöveget semmi nem értelmezi, a nyugtázás szimulált. Az állapot egyetlen böngészőben él, több résztvevő még nem látja egymást; ahhoz adatbázis-oldali üzenettábla kell. A térképjelek egyszerűsítettek, nem teljes APP-6 jelkészlet.

## Telepítés

1. Üres Supabase-projekt SQL-szerkesztőjében sorban: `sse_schema`, `sse_gate_seed`, `sse_api`.
2. Authentication → Users → Add user, majd a `sse_demo_setup` fájlban az e-mail-cím cseréje és futtatása. Nyilvános regisztráció legyen kikapcsolva.
3. `public/config.js`: projekt-URL és **publishable** kulcs. `vercel.json`: a CSP-be `connect-src 'self' https://<projekt>.supabase.co`.
4. n8n: a futtatóban a `supabaseUrl`, egy új Supabase-hitelesítő (secret kulcs) minden HTTP node-on, és a kívánt OpenAI-hitelesítő.
5. Futtatás → döntés a `live.html` ablakában → újabb futtatás. WF-01 két, WF-02 két döntési pontig vezet.

A `sse` sémát ne tedd elérhetővé a REST API-n. A secret kulcs csak az n8n-ben szerepelhet. Webes telepítés: Vercel, build lépés nélkül.

## Hogyan dolgozik a futtató

Megkérdezi az adatbázist, mi a következő szakasz; allépésenként lekéri a kontextust; a számításokat szkript végzi; minden modellhívást a hívás előtt naplóz (tiltás esetén nincs hívás); menti a produktumokat; a törzskoordinátor döntési anyagot készít; döntéskérést nyit és leáll. Dönteni nem tud.

Modellszintek (a Beállításokban cserélhetők): T1 `gpt-6.2-astra`, T2 `gpt-6.2-sol`, T3 `gpt-6-luna`.

## Döntési jogosultság

D9: a végrehajtást érintő kisebb módosításról a műveleti főnök vagy a parancsnok dönthet; a fő irányt érintő módosítást és az új tervezést csak a parancsnok választhatja (projektdöntés, 2026-11-25). A dandárnak van tervező cellája.

## Bizalmas+ (confidential+)

Egyirányú kapcsoló: bekapcsolva minden külső adapter tiltott, és helyi adapter nélkül a feldolgozás leáll. Visszakapcsolni nem lehet, új példány kell. **A kapcsoló nem teszi a felhős rendszert alkalmassá minősített adatra.** Ahhoz külön, zárt és a nemzeti hatóság által akkreditált rendszer szükséges. A demóban a zár csak a böngészőben él, nem biztonsági funkció.

## Ismert korlátok

- Csak az 1. és 2. MDMP-szakasz van automatizálva.
- A harcvezető központ még nincs összekötve az adatbázissal és a futtatóval.
- A harcvezető központ a dandár pilothoz készült; más törzsszint csak a folyamatnézetben választható.
- A közösen írt produktumokat még nem fésüli össze integráló lépés: a hozzájárulások egymás mellett állnak.
- Nincs tudásbázis-keresés; az agentek a doktrínáknak csak a hivatkozását kapják.
- Két egyidejű futtatás ugyanazt a szakaszt kétszer dolgozhatja fel (nyitott döntéskérés ekkor is csak egy lehet).
- A határidő-eszkalációt (`sse_engine_escalate`) még semmi nem ütemezi.
- Értesítés csak nyitott lapnál érkezik.
- A D10 delegálása (FM 5-0 6-32) és a T1–T5 produktumsablonok hiányoznak.
- A modellátjáró és a helyi adapterek nincsenek megírva.
- Az adatbázis-szabályok mélységi védelmet adnak; a tulajdonos vagy superuser megkerülheti őket.
- Forrás: US FM 5-0 és FM 6-0, szerkezeti hivatkozásokkal. Magyar nemzeti szabályzó nincs beépítve.
- A „tervezési szabály” jellegű elemek (kapukiosztás, COA-darabszám) projektjavaslatok, nem doktrína.
