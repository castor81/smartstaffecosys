// Fictitious, generic staff input for the decision window. Not produced by any model.
// Per gate: recommended option, short rationale, and [advantage, drawback, risk] per option.
export const DEMO = {
  D0: { rec: 'full', why: 'A rendelkezésre álló idő elegendő a teljes folyamathoz.', o: {
    full: ['Legteljesebb elemzés', 'Időigényes', 'Alárendeltek késedelmes tájékoztatása'],
    short: ['Gyorsabb parancs', 'Kevesebb COA', 'Kimaradó lehetőség'],
    directed: ['Leggyorsabb', 'Nincs valódi alternatíva', 'Megerősítési torzítás'],
    back: ['Pontosabb kiindulás', 'Időveszteség', 'Csúszó időterv'] } },
  D1: { rec: 'release', why: 'A kötelező elemek megvannak.', o: {
    release: ['Alárendeltek azonnal készülhetnek', 'Még változhat', 'Későbbi helyesbítés'],
    revise: ['Pontosabb tartalom', 'Késik a kiadás', 'Alárendelti idő csökken'] } },
  D2: { rec: 'approve', why: 'A feladat, a probléma és a CCIR összhangban van.', o: {
    approve: ['A tervezés folytatódhat', 'Nyitott feltételezések maradnak', 'Téves feltételezés továbböröklődik'],
    modify: ['A szándék pontosítható', 'Átdolgozás szükséges', 'Következetlen produktumok'],
    more: ['Kisebb bizonytalanság', 'Jelentős időveszteség', 'Kétharmados szabály sérül'] } },
  D3: { rec: 'select', why: 'A COA-k átmentek a szűrési feltételeken.', o: {
    select: ['Indulhat az elemzés', 'A készlet rögzül', 'Nem vizsgált lehetőség'],
    modify: ['Parancsnoki elgondolás beépül', 'Új vázlat kell', 'Csúszás'],
    reject: ['Új irány', 'A 3. lépés nagy része elvész', 'Időhiány'] } },
  D4: { rec: 'issue', why: 'Az eszközök és a résztvevők rendelkezésre állnak.', o: {
    issue: ['Fókuszált háborús játék', 'Szűkíti a vizsgálatot', 'Kimaradó kritikus esemény'],
    back: ['Érettebb COA-k', 'Késik az elemzés', 'Rövidebb játékidő'] } },
  DX: { rec: 'redo', why: 'A megmaradó alternatívák száma kevés lenne.', o: {
    drop: ['Nincs időveszteség', 'Kevesebb alternatíva', 'Szűk döntési tér'],
    redo: ['Teljes alternatívakészlet', 'Időigényes', 'Elemzés csúszik'] } },
  D5: { rec: 'coa2', why: 'A fiktív mátrixban a 2. változat a legkedvezőbb.', o: {
    coa1: ['Egyszerű végrehajtás', 'Gyengébb mozgás', 'Kezdeti ellenállás'],
    coa2: ['Jobb szárnyvédelem', 'Korai tartalékigény', 'Tartalék elfogyása'],
    coa3: ['Meglepés', 'Bonyolult vezetés', 'Összehangolási hiba'],
    back: ['Vita tisztázása', 'Időveszteség', 'Csúszó parancs'] } },
  D6: { rec: 'approve', why: 'A törzs egyetértett az ajánlott változattal.', o: {
    approve: ['Indulhat a parancs', 'Változtatás már drága', 'Elemzett kockázatok maradnak'],
    modify: ['Parancsnoki javítás', 'Újabb elemzés kell', 'Idővesztés'],
    reject: ['Új megoldások', 'Visszalépés a 3. lépésig', 'Súlyos időhiány'] } },
  D7: { rec: 'accept', why: 'A maradék kockázat a fiktív tűréshatáron belül van.', o: {
    accept: ['A tervezés folytatódik', 'A kockázat a parancsnoké', 'Veszteség vagy késés'],
    mitigate: ['Kisebb maradék kockázat', 'Erőforrást köt le', 'Gyengébb fő erőkifejtés'],
    higher: ['Elöljárói felelősségi kör', 'Várakozás', 'Időablak elvesztése'] } },
  D8: { rec: 'approve', why: 'Az egyeztetés és a keresztellenőrzés nem talált nyitott eltérést.', o: {
    approve: ['Alárendeltek időben kapják', 'Utólag csak FRAGORD-dal módosítható', 'Rejtett ellentmondás'],
    fix: ['Hibák javíthatók', 'Késik a kiadás', 'Alárendelti idő csökken'],
    reject: ['Alapvető hiba kezelhető', 'Új döntési kör', 'Súlyos csúszás'] } },
  D9: { rec: 'adjust', why: 'A fiktív eltérés a fő erőkifejtést érinti.', o: {
    none: ['Nincs beavatkozási költség', 'Az eltérés megmarad', 'Elszalasztott reagálás'],
    execution: ['Gyors, saját hatáskörben', 'Korlátozott eszközök', 'Alulbecsült eltérés'],
    adjust: ['A parancs a helyzethez igazodik', 'Összehangolást igényel', 'Rövid idő a végrehajtásra'],
    newplan: ['Teljes újratervezés', 'Hosszú', 'Kezdeményezés elvesztése'] } },
  D10: { rec: 'implement', why: 'A módosítás a szándékon belül marad.', o: {
    implement: ['Gyors alkalmazkodás', 'Alárendeltek terhelése', 'Szinkronvesztés'],
    modify: ['Pontosabb megoldás', 'Késés', 'Romló helyzet'],
    reject: ['A terv stabil marad', 'Az eltérés kezeletlen', 'Veszteség'] } },
};
