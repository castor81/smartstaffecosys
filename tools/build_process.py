#!/usr/bin/env python3
"""Source of truth for the process definition. Writes public/data/process.json and validates it.

Run:  python3 tools/build_process.py
Doctrine references are paragraph numbers of FM 5-0 (04 Nov 2024, incl. C1) and FM 6-0 (May 2022).
Everything marked as a design rule is a project proposal, not doctrine.
"""
import json
import pathlib
import sys

VERSION, DATE = "0.3", "2026-11-25"

# ---------------------------------------------------------------- roles, agents, echelons
HUMAN_ROLES = {"commander": "Parancsnok", "xo": "Törzsfőnök (XO/COS)", "ops_chief": "Műveleti főnök"}

# id, name pattern ({p} = staff prefix S or G), tier, minimum echelon, enabled in pilot
AGENTS = [
    ("A00", "Törzskoordinátor", "T2", "battalion", True),
    ("A01", "{p}-1 személyügy", "T2", "battalion", True),
    ("A02", "{p}-2 felderítés", "T1", "battalion", True),
    ("A03", "{p}-3 műveletek, vezető tervező", "T1", "battalion", True),
    ("A04", "{p}-4 logisztika", "T2", "battalion", True),
    ("A05", "{p}-6 híradás", "T2", "battalion", True),
    ("A06", "Tűztámogatás", "T2", "battalion", True),
    ("A07", "Műszaki", "T2", "battalion", True),
    ("A08", "Oltalmazás", "T2", "battalion", True),
    ("A09", "Ellenség-szerepjátszó", "T1", "battalion", True),
    ("A10", "Minőségellenőr", "T1", "battalion", True),
    ("A11", "G-5 tervezés", "T1", "division", False),
]
STAFF = ["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08"]

ECHELONS = [
    {"id": "battalion", "label": "Zászlóalj", "rank": 1, "status": "prepared", "chief": "XO",
     "procedure": "FM 5-0 MDMP", "cells": ["egyesített tervező és műveleti cella"],
     "differences": ["egy integráló cella (FM 6-0 8-23)"]},
    {"id": "brigade", "label": "Dandár", "rank": 2, "status": "pilot", "chief": "XO",
     "procedure": "FM 5-0 MDMP", "cells": ["kis tervező cella", "folyó műveleti cella"],
     "differences": ["van tervező cella (FM 6-0 8-23; projektdöntés, 2026-11-25)",
                     "nincs jövő műveletek cella (FM 6-0 8-23, 8-25)",
                     "oltalmazási törzstiszteket az S-3 koordinálja (FM 6-0 2-79)",
                     "tűztámogató tiszt (FSO) az S-3 alatt"]},
    {"id": "division", "label": "Hadosztály", "rank": 3, "status": "prepared", "chief": "COS",
     "procedure": "FM 5-0 MDMP", "cells": ["tervező cella", "jövő műveletek cella", "folyó műveleti cella"],
     "differences": ["G-5 tervező részleg (A11)", "oltalmazási főnök (A08) és tűztámogatási főnök (A06)",
                     "tervszinkronizációs testület (FM 6-0 4-55)"]},
    {"id": "corps", "label": "Hadtest", "rank": 4, "status": "prepared", "chief": "COS",
     "procedure": "FM 5-0 MDMP", "cells": ["tervező cella", "jövő műveletek cella", "folyó műveleti cella"],
     "differences": ["a hadosztály profilja bővíthető szerepekkel"]},
    {"id": "joint", "label": "Összhaderőnemi", "rank": 5, "status": "placeholder", "chief": "COS",
     "procedure": "AJP-5", "cells": [],
     "differences": ["külön folyamatdefiníció kell az AJP-5 hét tevékenységére"]},
]

PROFILES = [
    {"id": "open", "label": "Nyílt pilot", "max_classification": "NYILT_GYAKORLO", "egress": "allowlist",
     "adapters": {"model": "felhős modellátjáró", "database": "Supabase (felhő)", "orchestrator": "n8n felhő",
                  "export": "Google Sheets, Docs, Slides", "web": "Vercel", "notify": "e-mail jelzés"}},
    {"id": "confidential_plus", "label": "Bizalmas+", "max_classification": "NYILT_GYAKORLO", "egress": "deny",
     "adapters": {"model": "helyi modellkiszolgáló", "database": "saját üzemeltetésű Postgres",
                  "orchestrator": "saját üzemeltetésű n8n", "export": "xlsx, docx, pptx fájl",
                  "web": "helyi webszerver", "notify": "helyi értesítés"}},
]

# ---------------------------------------------------------------- artifacts
EXTERNAL = {
    "HQ_ORDER": "Elöljárói parancs vagy várható feladat",
    "KNOWLEDGE": "Doktrína- és tudásbázis",
    "SOP": "Törzsmunka rendje",
    "UNIT_STATUS": "Alegységek és erőforrások állapota",
    "INTEL": "Elöljárói felderítési termékek",
    "TERRAIN": "Terep- és időjárásadatok",
    "ADJACENT": "Elöljárói és szomszédos tervek",
    "REPORTS": "Jelentések a végrehajtás során",
}

# ---------------------------------------------------------------- gates
def opt(i, label, effect, to=None, roles=None):
    """roles overrides the gate's role for this option (None: only the gate's role)."""
    d = {"id": i, "label": label, "effect": effect}
    if to:
        d["to"] = to
    if roles:
        d["roles"] = roles
    return d


# A variance that affects the overall direction of the unit is the commander's decision (FM 5-0 6-23).
MINOR, MAJOR = ["ops_chief", "commander"], ["commander"]

GATES = [
    {"id": "D0", "role": "commander", "title": "Tervezési mód és kezdeti iránymutatás", "fm": "5-25",
     "options": [opt("full", "Teljes MDMP", "advance"), opt("short", "Rövidített MDMP", "advance"),
                 opt("directed", "Irányított COA", "advance"), opt("back", "További helyzetfelmérés", "rework", "S1.4")]},
    {"id": "D1", "role": "xo", "title": "Időterv és WARNORD kiadása", "fm": "5-24, 5-26",
     "options": [opt("release", "Kiadás", "advance"), opt("revise", "Módosításra vissza", "revise")]},
    {"id": "D2", "role": "commander", "title": "Küldetéselemzés jóváhagyása, szándék, iránymutatás", "fm": "5-66, 5-68",
     "options": [opt("approve", "Jóváhagyás", "advance"), opt("modify", "Jóváhagyás módosítással", "advance"),
                 opt("more", "További elemzés", "rework", "S2.1")]},
    {"id": "D3", "role": "commander", "title": "COA-k kiválasztása elemzésre", "fm": "5-113",
     "options": [opt("select", "Kiválasztás", "advance"), opt("modify", "Módosítás vagy új, kombinált COA", "revise"),
                 opt("reject", "Mind elvetése", "rework", "S3.2")]},
    {"id": "D4", "role": "commander", "title": "Elemzési iránymutatás", "fm": "5-116",
     "options": [opt("issue", "Iránymutatás kiadása", "advance"), opt("back", "COA-k pontosítása", "rework", "S3.6")]},
    {"id": "DX", "role": "commander", "title": "COA nem felel meg a szűrési feltételeknek", "fm": "5-145 megjegyzés",
     "conditional": "screening_failed",
     "options": [opt("drop", "COA elvetése, elemzés folytatása", "advance"),
                 opt("redo", "Új COA kidolgozása", "rework", "S3.2")]},
    {"id": "D5", "role": "xo", "title": "Törzsajánlás vita esetén", "fm": "5-172", "conditional": "staff_disagreement",
     "options": [opt("coa1", "COA 1 ajánlása", "advance"), opt("coa2", "COA 2 ajánlása", "advance"),
                 opt("coa3", "COA 3 ajánlása", "advance"), opt("back", "Újbóli összehasonlítás", "rework", "S5.2")]},
    {"id": "D6", "role": "commander", "title": "COA jóváhagyása", "fm": "5-173",
     "options": [opt("approve", "A kiválasztott COA jóváhagyása", "advance"),
                 opt("modify", "Módosított vagy új COA: elemzés szükséges", "rework", "S4.2"),
                 opt("reject", "Mind elvetése", "rework", "S3.2")]},
    {"id": "D7", "role": "commander", "title": "Elfogadható kockázat és végső iránymutatás", "fm": "5-174, 5-175",
     "options": [opt("accept", "Kockázat elfogadása", "advance"),
                 opt("mitigate", "További kockázatcsökkentés", "revise"),
                 opt("higher", "Elöljárói jóváhagyás kérése", "hold")]},
    {"id": "D8", "role": "commander", "title": "OPORD vagy OPLAN jóváhagyása", "fm": "5-182, 5-183",
     "options": [opt("approve", "Jóváhagyás", "advance"), opt("fix", "Javításra vissza", "rework", "S7.1"),
                 opt("reject", "Elutasítás, új COA-döntés", "rework", "S6.1")]},
    {"id": "D9", "role": "ops_chief", "title": "Milyen döntést igényel az eltérés?", "fm": "6-21 - 6-23",
     "options": [opt("none", "Nincs teendő, figyelés folytatása", "loop", "S8.1", MINOR),
                 opt("execution", "Végrehajtási döntés saját hatáskörben", "loop", "S8.1", MINOR),
                 opt("adjust", "Módosító döntés: új COA", "advance", roles=MAJOR),
                 opt("newplan", "Új MDMP-ciklus", "new_case", roles=MAJOR)]},
    {"id": "D10", "role": "commander", "title": "Módosítás végrehajtása FRAGORD-dal", "fm": "6-32",
     "options": [opt("implement", "Végrehajtás", "advance"), opt("modify", "COA módosítása", "rework", "S8.3"),
                 opt("reject", "Elvetés, figyelés folytatása", "loop", "S8.1")]},
]

# ---------------------------------------------------------------- steps and substeps
def sub(i, name, fm, agents, inputs, outputs, run, qa=None, gate=None, product=None, optional=False):
    d = {"id": i, "name": name, "fm": fm, "agents": agents, "inputs": inputs, "outputs": outputs, "run": run}
    if qa:
        d["qa"] = qa
    if gate:
        d["gates"] = gate if isinstance(gate, list) else [gate]
    if product:
        d["product"] = product
    if optional:
        d["optional"] = True
    return d

STEPS = [
 {"id": "S1", "name": "Küldetés vétele", "workflow": "WF-01", "time_share": "S1+S2: 30-35%", "substeps": [
  sub("S1.1", "Törzs riasztása, tervezőcsoport kijelölése", "5-15", ["A00"], ["HQ_ORDER"], ["TEAM"], "script", "minden harcfunkció képviselve"),
  sub("S1.2", "Eszközök és dokumentumok összegyűjtése", "5-16", ["A00"], ["HQ_ORDER", "KNOWLEDGE", "SOP"], ["TOOLKIT"], "script", "hivatkozott mellékletek megvannak"),
  sub("S1.3", "Helyzetértékelések frissítése", "5-18", STAFF, ["TOOLKIT", "UNIT_STATUS"], ["ESTIMATES"], "llm:T2", "forrás és dátum minden tételnél", product="P03"),
  sub("S1.4", "Kezdeti értékelés és időterv-tervezet", "5-19 - 5-23", ["A00", "A03"], ["HQ_ORDER", "ESTIMATES"], ["ASSESSMENT", "TIMELINE_DRAFT"], "script+llm:T2", "egyharmad-kétharmad szabály"),
  sub("S1.5", "Parancsnoki kezdeti iránymutatás", "5-25", [], ["ASSESSMENT"], ["GUIDANCE_0"], "human", gate="D0"),
  sub("S1.6", "Időterv jóváhagyása és 1. WARNORD", "5-24, 5-26", ["A00", "A03"], ["GUIDANCE_0", "TIMELINE_DRAFT"], ["TIMELINE", "WARNORD_1"], "llm:T2", "WARNORD kötelező elemei", gate="D1", product="P01, P02"),
 ]},
 {"id": "S2", "name": "Küldetéselemzés", "workflow": "WF-02", "time_share": "S1+S2: 30-35%", "substeps": [
  sub("S2.1", "Elöljárói parancs elemzése", "5-28", ["A03"], ["HQ_ORDER", "GUIDANCE_0"], ["HQ_ANALYSIS"], "llm:T1", "két szinttel feljebb lévő szándék"),
  sub("S2.2", "Kezdeti IPOE", "5-30", ["A02"], ["HQ_ORDER", "INTEL", "TERRAIN"], ["IPOE"], "llm:T1", "tény és következtetés külön", product="P04"),
  sub("S2.3", "Meghatározott, következtetett és lényeges feladatok", "5-34", ["A03"], ["HQ_ANALYSIS"], ["TASKS"], "llm:T1", "minden feladat hivatkozott", product="P05"),
  sub("S2.4", "Erőforrások és hiányok", "5-39", ["A01", "A04"], ["ESTIMATES", "TASKS"], ["ASSETS"], "script+llm:T2", "hiány számszerűen"),
  sub("S2.5", "Korlátok", "5-40", ["A03"], ["HQ_ANALYSIS"], ["CONSTRAINTS"], "llm:T3", "constraint és limitation nem keveredik", product="P05"),
  sub("S2.6", "Tények és feltételezések", "5-42", STAFF, ["HQ_ANALYSIS", "ESTIMATES"], ["FACTS"], "llm:T2", "feltételezésnek van megerősítési módja", product="P05"),
  sub("S2.7", "Kockázatkezelés megkezdése", "5-45", ["A08"], ["TASKS", "IPOE", "FACTS"], ["RISKS"], "llm:T2", "veszély, valószínűség, súlyosság, gazda"),
  sub("S2.8", "Kezdeti CCIR és EEFI", "5-47", ["A02", "A03"], ["IPOE", "TASKS", "FACTS"], ["CCIR"], "llm:T1", "minden CCIR döntéshez kötött"),
  sub("S2.9", "Kezdeti információgyűjtési terv", "5-51", ["A02", "A03"], ["IPOE", "CCIR"], ["ICP"], "llm:T2", "minden PIR-nek van eszköze"),
  sub("S2.10", "Időtervek frissítése", "5-55", ["A00"], ["TIMELINE", "ASSESSMENT"], ["TIMELINE"], "script", "ütközésvizsgálat", product="P01"),
  sub("S2.11", "Problémamegfogalmazás javaslata", "5-57", ["A03"], ["IPOE", "TASKS", "CONSTRAINTS"], ["PROBLEM"], "llm:T1", "független ellenőrzés"),
  sub("S2.12", "Küldetésmegfogalmazás javaslata", "5-59", ["A03"], ["TASKS", "PROBLEM"], ["MISSION"], "llm:T1", "ki, mit, mikor, hol, miért"),
  sub("S2.13", "COA értékelési szempontok", "5-63", ["A00", "A03"], ["MISSION", "GUIDANCE_0"], ["CRITERIA"], "llm:T2", "definíció, mérték, irány"),
  sub("S2.14", "Küldetéselemzési eligazítás", "5-66", ["A00"], ["IPOE", "TASKS", "ASSETS", "CONSTRAINTS", "FACTS", "RISKS", "CCIR", "ICP", "PROBLEM", "MISSION", "CRITERIA", "TIMELINE"], ["MA_BRIEF"], "llm:T2", "A10 egyeztetés", product="P06"),
  sub("S2.15", "Parancsnoki jóváhagyás, szándék, módosított iránymutatás", "5-66, 5-68", [], ["MA_BRIEF"], ["MA_APPROVED", "INTENT", "GUIDANCE_MA"], "human", gate="D2"),
  sub("S2.16", "2. WARNORD", "5-72", ["A03"], ["MA_APPROVED", "INTENT", "GUIDANCE_MA"], ["WARNORD_2"], "llm:T2", "WARNORD kötelező elemei", gate="D1", product="P02"),
 ]},
 {"id": "S3", "name": "COA-kidolgozás", "workflow": "WF-03", "time_share": "15-20%", "substeps": [
  sub("S3.1", "Relatív erőviszonyok értékelése", "5-80", ["A03", "A02"], ["IPOE", "ASSETS", "GUIDANCE_MA"], ["COMBAT_POWER"], "script+llm:T1", "arány script számításból", product="P08"),
  sub("S3.2", "Lehetőségek generálása", "5-87", ["A03"], ["MA_APPROVED", "INTENT", "GUIDANCE_MA", "COMBAT_POWER"], ["OPTIONS"], "llm:T1", "ellenséges COA-k lefedve"),
  sub("S3.3", "Erők elrendezése", "5-95", ["A03"], ["OPTIONS", "COMBAT_POWER"], ["ARRAY"], "script+llm:T1", "minden egység elszámolva"),
  sub("S3.4", "Hadműveleti elgondolás kidolgozása", "5-102", ["A03", "A04", "A05", "A06", "A07", "A08"], ["ARRAY", "INTENT"], ["CONOPS"], "llm:T1", "minden harcfunkciónak van vázlata"),
  sub("S3.5", "Parancsnokságok hozzárendelése", "5-106", ["A03"], ["CONOPS"], ["TASKORG"], "llm:T2", "vezetési terjedelem"),
  sub("S3.6", "COA-leírások és vázlatok", "5-108", ["A03"], ["CONOPS", "TASKORG"], ["COA_SET"], "llm:T2", "A10 szűrés: megvalósítható, elfogadható, célravezető, megkülönböztethető, teljes", product="P07"),
  sub("S3.7", "COA-eligazítás", "5-112", ["A00"], ["COA_SET", "COMBAT_POWER", "IPOE"], ["COA_BRIEF"], "llm:T2", "legvalószínűbb és legveszélyesebb ellenséges COA"),
  sub("S3.8", "Parancsnoki választás vagy módosítás", "5-113", [], ["COA_BRIEF"], ["COA_SELECTED", "GUIDANCE_COA"], "human", gate="D3"),
 ]},
 {"id": "S4", "name": "COA-elemzés", "workflow": "WF-04", "time_share": "S4-S6: 30-35%", "substeps": [
  sub("S4.1", "Elemzési iránymutatás", "5-116", [], ["COA_SELECTED", "GUIDANCE_COA"], ["GUIDANCE_WG"], "human", gate="D4"),
  sub("S4.2", "Eszközök összegyűjtése", "5-133", ["A00"], ["GUIDANCE_WG", "ESTIMATES"], ["WG_KIT"], "script"),
  sub("S4.3", "Saját erők listázása", "5-134", ["A03"], ["COA_SELECTED", "TASKORG"], ["FRIENDLY"], "script", "egyezik a hadrenddel"),
  sub("S4.4", "Feltételezések listázása", "5-135", ["A00"], ["FACTS", "COA_SELECTED"], ["WG_ASSUMPTIONS"], "llm:T3", "elavult feltételezés jelölve"),
  sub("S4.5", "Kritikus események és döntési pontok", "5-136", ["A03"], ["COA_SELECTED", "GUIDANCE_WG"], ["EVENTS"], "llm:T1"),
  sub("S4.6", "Elemzés végrehajtása: akció, reakció, ellenakció", "5-138", ["A03", "A09", "A02", "A04", "A06", "A07", "A08"], ["WG_KIT", "FRIENDLY", "WG_ASSUMPTIONS", "EVENTS", "IPOE"], ["WG_RESULTS", "SYNC_MATRIX", "COA_REFINED", "DECISION_POINTS", "MEASURES"], "llm:T1", "COA-nként külön futás, COA-k nem hasonlíthatók össze", gate="DX", product="P09"),
  sub("S4.7", "Belső elemzési eligazítás", "5-145", ["A00"], ["WG_RESULTS"], ["WG_BRIEF"], "llm:T3", optional=True),
 ]},
 {"id": "S5", "name": "COA-összehasonlítás", "workflow": "WF-05", "time_share": "S4-S6: 30-35%", "substeps": [
  sub("S5.1", "Előny-hátrány elemzés törzsszekciónként", "5-167", STAFF, ["COA_REFINED", "WG_RESULTS", "CRITERIA"], ["PROS_CONS"], "llm:T2", "szekciónként független futás"),
  sub("S5.2", "Összehasonlítás döntési mátrixszal", "5-168", ["A03"], ["CRITERIA", "PROS_CONS"], ["MATRIX"], "script", "súlyok pontozás előtt zárolva; érzékenységvizsgálat", product="P10"),
  sub("S5.3", "Ajánlott COA meghatározása", "5-172", ["A03", "A00"], ["MATRIX", "PROS_CONS", "RISKS"], ["RECOMMENDATION"], "llm:T1", "különvélemény rögzítve", gate="D5"),
 ]},
 {"id": "S6", "name": "COA-jóváhagyás", "workflow": "WF-05", "time_share": "S4-S6: 30-35%", "substeps": [
  sub("S6.1", "Döntési eligazítás", "5-172", ["A00"], ["RECOMMENDATION", "COA_REFINED", "MATRIX", "IPOE"], ["DECISION_BRIEF"], "llm:T2", "A10 egyeztetés", product="P11"),
  sub("S6.2", "COA jóváhagyása, kockázat, végső iránymutatás", "5-173 - 5-175", [], ["DECISION_BRIEF", "RISKS"], ["COA_APPROVED", "GUIDANCE_FINAL", "INTENT", "CCIR"], "human", gate=["D6", "D7"]),
  sub("S6.3", "3. WARNORD", "5-176", ["A03"], ["COA_APPROVED", "GUIDANCE_FINAL"], ["WARNORD_3"], "llm:T2", "WARNORD kötelező elemei", gate="D1", product="P02"),
 ]},
 {"id": "S7", "name": "Parancs, kiadás, átadás", "workflow": "WF-07", "time_share": "15-20%", "substeps": [
  sub("S7.1", "Parancs és mellékletek kidolgozása", "5-177, 5-178", STAFF, ["COA_APPROVED", "GUIDANCE_FINAL", "SYNC_MATRIX", "ESTIMATES", "IPOE"], ["ORDER_DRAFT", "OVERLAYS"], "llm:T2", "mellékletfelelős és határidő", product="P12, P13"),
  sub("S7.2", "Belső egyeztetés (reconciliation)", "5-180", ["A10"], ["ORDER_DRAFT", "INTENT", "CCIR"], ["RECON_REPORT"], "script+llm:T1", "alapparancs és mellékletek egyeznek"),
  sub("S7.3", "Keresztellenőrzés (crosswalk)", "5-181", ["A10"], ["ORDER_DRAFT", "HQ_ORDER", "ADJACENT"], ["CROSSWALK_REPORT"], "llm:T1", "elöljárói szándékba illeszkedik"),
  sub("S7.4", "Parancsnoki jóváhagyás", "5-182, 5-183", [], ["ORDER_DRAFT", "RECON_REPORT", "CROSSWALK_REPORT"], ["ORDER"], "human", gate="D8"),
  sub("S7.5", "Kiadás és nyugtázás", "5-183", ["A00"], ["ORDER"], ["ACKS"], "script", "hiányzó nyugta eszkalál"),
  sub("S7.6", "Megértést igazoló eligazítások", "5-184", [], ["ORDER", "ACKS"], ["CONFIRMATION"], "human"),
  sub("S7.7", "Átadás a folyó műveleti cellának", "5-185", ["A00", "A03"], ["ORDER", "DECISION_POINTS", "MEASURES"], ["HANDOVER"], "llm:T2", "átadási ellenőrzőlista"),
 ]},
 {"id": "S8", "name": "Végrehajtás: gyors döntési ciklus (RDSP)", "workflow": "WF-08", "time_share": "folyamatos", "substeps": [
  sub("S8.1", "Helyzet összevetése a paranccsal", "6-18 - 6-20", ["A02", "A03"], ["ORDER", "HANDOVER", "REPORTS", "CCIR"], ["VARIANCE"], "script+llm:T3", "CCIR-találat azonnali jelzés"),
  sub("S8.2", "A szükséges döntés meghatározása", "6-21 - 6-23", ["A03"], ["VARIANCE"], ["DECISION_NEED"], "llm:T1", "lehetőség vagy veszély leírva", gate="D9"),
  sub("S8.3", "COA kidolgozása", "6-24 - 6-28", ["A03", "A02", "A04", "A06"], ["DECISION_NEED", "INTENT"], ["ADJ_COA"], "llm:T1", "parancsnoki szándékon belül"),
  sub("S8.4", "Finomítás és érvényesítés", "6-29 - 6-31", ["A09", "A10"], ["ADJ_COA"], ["VALID_COA"], "llm:T1", "megvalósítható, célravezető, elfogadható"),
  sub("S8.5", "Végrehajtás: FRAGORD", "6-32 - 6-35", ["A03"], ["VALID_COA"], ["FRAGORD", "SYNC_MATRIX"], "llm:T2", "döntéstámogató sablon frissítve", gate="D10", product="P14"),
 ]},
]

MODES = {
    "full": {"label": "Teljes MDMP", "coa_count": 3},
    "short": {"label": "Rövidített MDMP", "coa_count": 2},
    "directed": {"label": "Irányított COA", "coa_count": 1},
}

RULES = [
    "Automatikus jóváhagyás nincs: határidő lejárta csak eszkalál.",
    "Elutasítás vagy változás esetén a függő produktumok érvénytelenné válnak és újra kell készíteni őket.",
    "A számítást script végzi, nem nyelvi modell.",
    "A COA-darabszám üzemmód szerinti alapérték (tervezési szabály, nem doktrína).",
]


# Runnable segments of the automated workflows: automated substeps, then one human gate.
def segment(i, workflow, step, first, last, gate, gate_substep, subject):
    """subject: the product the human decides on."""
    return {"id": i, "workflow": workflow, "substeps": [f"{step}.{n}" for n in range(first, last + 1)],
            "gate": gate, "gate_substep": gate_substep, "subject": subject}


SEGMENTS = [
    segment("W1A", "WF-01", "S1", 1, 4, "D0", "S1.5", "ASSESSMENT"),
    segment("W1B", "WF-01", "S1", 6, 6, "D1", "S1.6", "WARNORD_1"),
    segment("W2A", "WF-02", "S2", 1, 14, "D2", "S2.15", "MA_BRIEF"),
    segment("W2B", "WF-02", "S2", 16, 16, "D1", "S2.16", "WARNORD_2"),
]


def build():
    return {
        "meta": {"name": "SmartStaffEcosys", "version": VERSION, "date": DATE,
                 "classification": "NYILT_GYAKORLO", "pilot_echelon": "brigade",
                 "sources": ["FM 5-0 (2024-11, C1)", "FM 6-0 (2022-05)", "AJP-5 Ed. B V1 (2026-06)"]},
        "human_roles": HUMAN_ROLES,
        "agents": [dict(zip(["id", "name", "tier", "min_echelon", "enabled"], a)) for a in AGENTS],
        "echelons": ECHELONS, "profiles": PROFILES, "modes": MODES, "rules": RULES,
        "external_inputs": EXTERNAL, "gates": GATES, "steps": STEPS, "segments": SEGMENTS,
    }


def validate(p):
    """Return a list of problems; an empty list means the definition is consistent."""
    errors = []
    agents = {a["id"] for a in p["agents"]}
    gates = {g["id"]: g for g in p["gates"]}
    subs = [s for st in p["steps"] for s in st["substeps"]]
    order = {s["id"]: n for n, s in enumerate(subs)}
    if len(order) != len(subs):
        errors.append("duplicate substep id")
    available = set(p["external_inputs"])
    used_gates = set()
    for s in subs:
        for a in s["agents"]:
            if a not in agents:
                errors.append(f"{s['id']}: unknown agent {a}")
        if s["run"] != "human" and not s["agents"]:
            errors.append(f"{s['id']}: automated substep without agent")
        if s["run"] == "human" and s["agents"]:
            errors.append(f"{s['id']}: human substep lists agents")
        for i in s["inputs"]:
            if i not in available:
                errors.append(f"{s['id']}: input {i} is not produced earlier")
        available |= set(s["outputs"])
        for g in s.get("gates", []):
            used_gates.add(g)
            if g not in gates:
                errors.append(f"{s['id']}: unknown gate {g}")
    for g in p["gates"]:
        if g["id"] not in used_gates:
            errors.append(f"gate {g['id']} is never used")
        if g["role"] not in p["human_roles"]:
            errors.append(f"gate {g['id']}: unknown role")
        if not any(o["effect"] != "advance" for o in g["options"]):
            errors.append(f"gate {g['id']}: no way to refuse")
        for o in g["options"]:
            if any(r not in p["human_roles"] for r in o.get("roles", [])):
                errors.append(f"gate {g['id']}: option {o['id']} has an unknown role")
            if o["effect"] in ("rework", "loop"):
                target = o.get("to")
                if target not in order:
                    errors.append(f"gate {g['id']}: bad target {target}")
                    continue
                for s in subs:
                    if g["id"] in s.get("gates", []) and order[target] > order[s["id"]]:
                        errors.append(f"gate {g['id']}: target {target} lies after {s['id']}")
    for seg in p["segments"]:
        for i in seg["substeps"] + [seg["gate_substep"]]:
            if i not in order:
                errors.append(f"segment {seg['id']}: unknown substep {i}")
        if any(s["run"] == "human" for s in subs if s["id"] in seg["substeps"]):
            errors.append(f"segment {seg['id']}: contains a human substep")
        if not any(seg["subject"] in s["outputs"] for s in subs if s["id"] in seg["substeps"]):
            errors.append(f"segment {seg['id']}: subject {seg['subject']} is not produced in it")
        if not any(s["id"] == seg["gate_substep"] and seg["gate"] in s.get("gates", []) for s in subs):
            errors.append(f"segment {seg['id']}: gate {seg['gate']} is not on {seg['gate_substep']}")
    return errors


def gate_seed(p):
    """SQL seed for the definition tables, so the database and the app share one definition."""
    q = lambda v: "null" if v is None else "'" + v.replace("'", "''") + "'"
    arr = lambda v: "null" if v is None else "array[" + ", ".join(q(x) for x in v) + "]::text[]"
    lines = [f"-- Generated by tools/build_process.py (process v{VERSION}). Do not edit.", "begin;"]
    for g in p["gates"]:
        lines.append(f"insert into sse.gate_definition values ({q(g['id'])}, {q(g['role'])}, {q(g['title'])});")
        for o in g["options"]:
            lines.append(f"insert into sse.gate_option values ({q(g['id'])}, {q(o['id'])}, {q(o['label'])}, "
                         f"{q(o['effect'])}, {q(o.get('to'))}, {arr(o.get('roles'))});")
    n = 0
    for st in p["steps"]:
        for s in st["substeps"]:
            n += 1
            lines.append(f"insert into sse.substep values ({q(s['id'])}, {n}, {q(s['name'])}, {q(s['run'])}, "
                         f"{arr(s['agents'])}, {arr(s['inputs'])}, {arr(s['outputs'])}, {q(s.get('qa'))});")
    for n, seg in enumerate(p["segments"], 1):
        lines.append(f"insert into sse.segment values ({q(seg['id'])}, {q(seg['workflow'])}, {n}, "
                     f"{arr(seg['substeps'])}, {q(seg['gate'])}, {q(seg['gate_substep'])}, {q(seg['subject'])});")
    prompts = json.loads((pathlib.Path(__file__).resolve().parent.parent / "prompts" / "agents.json").read_text(encoding="utf-8"))
    lines.append(f"insert into sse.prompt_common (body) values ({q(prompts['common'])});")
    for a in p["agents"]:
        if a["enabled"]:
            lines.append(f"insert into sse.agent values ({q(a['id'])}, {q(a['name'].replace('{p}', 'S'))}, "
                         f"{q(prompts['roles'][a['id']])});")
    return "\n".join(lines + ["commit;", ""])


def demo_setup(version, date):
    """Fictitious headquarters, login link and one exercise case with the order from exercise/."""
    root = pathlib.Path(__file__).resolve().parent.parent
    ex = json.loads((root / "exercise" / f"exercise_order_v{version}_{date}.json").read_text(encoding="utf-8"))
    body = json.dumps(ex, ensure_ascii=False, indent=1)
    assert "$ex$" not in body
    return f"""-- GENERATED by tools/build_process.py. Do not edit.
-- Fictitious demo headquarters and exercise case. Run as administrator (Supabase SQL editor).
-- 1) First create a login user: Authentication > Users > Add user.
-- 2) Replace you@example.com below with that e-mail address, then run the whole file.
-- One account gets all three roles for testing. In real use give them to different people.
do $setup$
declare
  hq constant uuid := '5e000000-0000-0000-0000-0000000000b1';
  who uuid;
  login uuid;
begin
  select id into login from auth.users where email = 'you@example.com';
  if login is null then raise exception 'no login user with this e-mail'; end if;
  insert into sse.hq (id, name, echelon, staff_prefix)
  values (hq, 'Fiktív 1. gyakorló dandár', 'brigade', 'S') on conflict (id) do nothing;
  insert into sse.person (display_name, auth_user_id) values ('Gyakorló felhasználó', login)
  on conflict (auth_user_id) do nothing;
  select id into who from sse.person where auth_user_id = login;
  insert into sse.role_assignment (hq_id, person_id, role)
  select hq, who, r from unnest(array['commander', 'xo', 'ops_chief']) r on conflict do nothing;
  perform public.sse_engine_start(hq, 'GYAKORLAT-01', $ex${body}$ex$::jsonb);
end $setup$;
"""


if __name__ == "__main__":
    data = build()
    problems = validate(data)
    if problems:
        print("\n".join(problems))
        sys.exit(1)
    out = pathlib.Path(__file__).resolve().parent.parent / "public" / "data" / "process.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    seed = out.parents[2] / "db" / f"sse_gate_seed_v{VERSION}_{DATE}.sql"
    seed.parent.mkdir(exist_ok=True)
    seed.write_text(gate_seed(data), encoding="utf-8")
    (seed.parent / f"sse_demo_setup_v{VERSION}_{DATE}.sql").write_text(demo_setup(VERSION, DATE), encoding="utf-8")
    n = sum(len(s["substeps"]) for s in data["steps"])
    print(f"OK: {len(data['steps'])} steps, {n} substeps, {len(data['gates'])} gates, {len(data['agents'])} agents -> {out}")
