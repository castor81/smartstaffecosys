# SmartStaffEcosys v0.2 (2026-11-25)

Katonai törzs tervezési folyamatának (MDMP) fejlesztési alapja: gépi folyamatleírás, adatséma és webes demó az emberi döntési kapukkal. A pilot szint a dandártörzs.

**Csak nyílt vagy fiktív adat.** A tároló nem tartalmazhat minősített, nem nyilvános vagy személyes adatot, sem forrás-PDF-eket. A demó nem hív MI-modellt, és nincs háttérszolgáltatása.

## Tartalom

| Útvonal | Mi ez |
| --- | --- |
| `tools/build_process.py` | A folyamat egyetlen forrása; ellenőrzi és legenerálja a JSON-t és a kapu-seedet |
| `public/data/process.json` | 8 szakasz, 55 allépés, 12 döntési kapu, agentek, törzsszintek, telepítési profilok |
| `db/sse_schema_v0.2_2026-11-25.sql` | PostgreSQL-séma: többszintű törzs, minősítési zár, módosíthatatlan döntési napló |
| `db/test_schema.sql` | A tiltások tesztjei (üres próbaadatbázison) |
| `public/` | Statikus webes demó, döntési ablakkal |
| `tests/engine.test.mjs` | A folyamatmotor tesztjei |

## Futtatás

```bash
python3 tools/build_process.py          # definíció ellenőrzése és generálása
node --test tests/*.test.mjs            # motortesztek (Node 20+)
python3 -m http.server -d public 8000   # demó: http://localhost:8000

# adatbázis, üres próbaadatbázisra (PostgreSQL 15+)
psql -v ON_ERROR_STOP=1 -f db/sse_schema_v0.2_2026-11-25.sql
psql -v ON_ERROR_STOP=1 -f db/sse_gate_seed_v0.2_2026-11-25.sql
psql -v ON_ERROR_STOP=1 -f db/test_schema.sql
```

Telepítés: Vercel, build lépés nélkül (`vercel.json`, kimeneti könyvtár: `public`).

## Bizalmas+ (confidential+)

Egyirányú kapcsoló: bekapcsolva minden külső adapter tiltott, és helyi adapter nélkül a feldolgozás leáll. Visszakapcsolni nem lehet, új példány kell. **A kapcsoló nem teszi a felhős rendszert alkalmassá minősített adatra.** Ahhoz külön, zárt és a nemzeti hatóság által akkreditált rendszer szükséges.

A demóban a zár csak a böngészőben él: bemutatja a viselkedést, de nem biztonsági funkció. Az „Új demó-példány” gomb törli.

## Ismert korlátok

- A háttérszolgáltatás, az n8n workflow-k, a modellátjáró és a helyi adapterek még nincsenek megírva.
- Az adatbázis-szabályok mélységi védelmet adnak; a tulajdonos vagy superuser megkerülheti őket.
- A `hq`, `person` és `role_assignment` táblákon még nincs sorszintű hozzáférés-szabály.
- A bejelentkezett személy azonosítását a háttérszolgáltatásnak kell elvégeznie.
- Forrás: US FM 5-0 és FM 6-0, szerkezeti hivatkozásokkal. Magyar nemzeti szabályzó nincs beépítve.
- A D9 kaput a műveleti főnök dönti el; a parancsnoki beavatkozás esete (FM 5-0 6-23) még nincs külön kezelve. A D10 delegálása (6-32) szintén hiányzik.
- Az FM 6-0 8-23 és 8-24 eltérően ír a dandár tervező cellájáról; a profil a 8-23-at követi.
- A „tervezési szabály” jellegű elemek (kapukiosztás, COA-darabszám) projektjavaslatok, nem doktrína.
