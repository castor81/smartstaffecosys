// FIKTÍV gyakorló forgatókönyv a harcvezető központ nézethez. Minden egység, hely, adat és üzenet kitalált.
// Az üzenetek előre megírtak: nem modell készítette őket futás közben.
// Térképegység: 1 = 100 m. Az elhelyezkedés szemléltető vázlat.

export const EXERCISE = {
  name: 'Fiktív 1. gyakorló dandár',
  area: 'ZÖLD sáv · Kék-folyó',
  receivedAt: Date.UTC(2027, 2, 1, 6, 0), // helyi idő, UTC-ként számolva
  executionAt: Date.UTC(2027, 2, 4, 6, 0),
};

export const ELEMENTS = [
  { id: 'HHQ', short: 'Ho.', name: 'Fiktív 10. hadosztály', group: 'higher' },
  { id: 'CDR', short: 'PK', name: 'Dandárparancsnok', group: 'command', role: 'commander' },
  { id: 'XO', short: 'XO', name: 'Törzsfőnök (XO)', group: 'command', role: 'xo' },
  { id: 'OPS', short: 'MŰVF', name: 'Műveleti főnök', group: 'command', role: 'ops_chief' },
  { id: 'A00', short: 'KOORD', name: 'Törzskoordinátor', group: 'staff' },
  { id: 'A01', short: 'S-1', name: 'S-1 személyügy', group: 'staff' },
  { id: 'A02', short: 'S-2', name: 'S-2 felderítés', group: 'staff' },
  { id: 'A03', short: 'S-3', name: 'S-3 műveletek, vezető tervező', group: 'staff' },
  { id: 'A04', short: 'S-4', name: 'S-4 logisztika', group: 'staff' },
  { id: 'A05', short: 'S-6', name: 'S-6 híradás', group: 'staff' },
  { id: 'A06', short: 'TŰZ', name: 'Tűztámogatás', group: 'staff' },
  { id: 'A07', short: 'MŰSZ', name: 'Műszaki törzstiszt', group: 'staff' },
  { id: 'A08', short: 'OLT', name: 'Oltalmazás', group: 'staff' },
  { id: 'A09', short: 'VÖRÖS', name: 'Ellenség-szerepjátszó', group: 'staff' },
  { id: 'A10', short: 'QA', name: 'Minőségellenőr', group: 'staff' },
  { id: 'B1', short: '1.gz', name: '1. gépesített zászlóalj', group: 'sub' },
  { id: 'B2', short: '2.gz', name: '2. gépesített zászlóalj', group: 'sub' },
  { id: 'TK3', short: '3.hkz', name: '3. harckocsizászlóalj', group: 'sub' },
  { id: 'ART', short: 'Tü.o.', name: 'Tüzérosztály', group: 'sub' },
  { id: 'ENG', short: 'Mű.szd', name: 'Műszaki század', group: 'sub' },
  { id: 'LOG', short: 'Log.z', name: 'Logisztikai zászlóalj', group: 'sub' },
  { id: 'EXCON', short: 'GYV', name: 'Gyakorlatvezetés', group: 'excon' },
];

export const GROUPS = { higher: 'Elöljáró', command: 'Parancsnoki csoport', staff: 'Törzs (agentek)', sub: 'Alárendeltek', excon: 'Gyakorlatvezetés' };

export const CHANNELS = [
  { id: 'all', label: 'Összes' },
  { id: 'cmd', label: 'Parancsnoki' },
  { id: 'staff', label: 'Törzs' },
  { id: 'intel', label: 'Felderítő' },
  { id: 'ops', label: 'Műveleti' },
  { id: 'sust', label: 'Támogató' },
  { id: 'higher', label: 'Elöljáró' },
  { id: 'subs', label: 'Alegységek' },
  { id: 'excon', label: 'Gyak.vez.' },
];

// Az UNIT_STATUS gyakorló adat a fiktív parancsból (állomány, harcjármű: megvan/rendszeresített; hajtóanyag: napi javadalmazás).
export const UNITS = {
  CP: { label: 'DD HP', kind: 'hq', name: 'Dandár harcálláspont' },
  B1: { label: '1.gz', kind: 'mech', size: 'II', status: { personnel: '512 / 560', vehicles: '36 / 42', fuel: '2,4 / 3' } },
  B2: { label: '2.gz', kind: 'mech', size: 'II', status: { personnel: '498 / 560', vehicles: '39 / 42', fuel: '2,1 / 3' } },
  TK3: { label: '3.hkz', kind: 'armor', size: 'II', status: { personnel: '401 / 420', vehicles: '24 / 31', fuel: '1,8 / 3' } },
  ART: { label: 'Tü.o.', kind: 'art', size: 'II', status: { personnel: '288 / 310', vehicles: '16 / 18', fuel: '2,7 / 3' } },
  ENG: { label: 'Mű.szd', kind: 'eng', size: 'I', status: { personnel: '97 / 120', fuel: '2,5 / 3' } },
  LOG: { label: 'Log.z', kind: 'log', size: 'II', status: { personnel: '340 / 380', fuel: '2,9 / 3' } },
  RES: { label: 'TART', kind: 'armor', size: 'I', name: 'Dandártartalék (megerősített harckocsiszázad)' },
};

export const ASSEMBLY = { CP: [165, 290], B1: [115, 120], B2: [90, 220], TK3: [125, 430], ART: [50, 325], ENG: [205, 195], LOG: [60, 500] };

export const COAS = {
  1: {
    name: 'COA 1 · két zászlóalj elöl, harckocsik mélységben',
    pos: { CP: [160, 295], B1: [305, 145], B2: [298, 310], TK3: [215, 170], ART: [120, 245], ENG: [318, 232], LOG: [65, 455], RES: [200, 355] },
    turns: ['A tartalék észak felé indul, a déli szárny gyengén fedezett.'],
  },
  2: {
    name: 'COA 2 · harckocsik a déli szárny fedezésében',
    pos: { CP: [160, 295], B1: [305, 145], B2: [298, 295], TK3: [272, 352], ART: [135, 255], ENG: [318, 222], LOG: [65, 455], RES: [205, 220] },
    turns: ['A tartalék korán szükséges lehet; bevetése hadosztályparancsnoki engedélyhez kötött.'],
  },
  3: {
    name: 'COA 3 · előretolt biztosítás az ALFA hídon túl',
    pos: { CP: [160, 295], B1: [300, 140], B2: [295, 320], TK3: [455, 135], ART: [140, 255], ENG: [322, 200], LOG: [65, 455], RES: [210, 250] },
    turns: ['Az előretolt erő az ALFA hídon át vonul vissza; az összehangolás a kritikus pont.'],
  },
};

export const TURNS = [
  { name: '0. Gyülekezés', own: 'A dandár a gyülekezési körletben.', hostile: 'Gyülekezés kb. 60 km-re keletre.', enemy: [[930, 255], [860, 165]] },
  { name: '1. Védőkörletek', own: 'Az alegységek elfoglalják a védőkörleteket.', hostile: 'Az előrevonás megkezdése.', enemy: [[860, 250], [790, 150]] },
  { name: '2. Akció', own: 'Felderítés a NAI-kban, jelentés a BARNA vonalon.', hostile: 'Előrevonás, a BARNA vonal megközelítése.', enemy: [[640, 205], [610, 100]] },
  { name: '3. Reakció', own: 'Tüzérségi és műszaki zárás az átkelőhelyeken.', hostile: 'Megtévesztés ALFA-nál, átkelési kísérlet BRAVO-nál.', enemy: [[430, 182], [425, 300]] },
  { name: '4. Ellenakció', own: null, hostile: 'Súlyáthelyezés BRAVO térségébe.', enemy: [[505, 215], [440, 330]] },
];

export const TERRAIN = {
  crossings: {
    ALFA: { at: [360, 165], name: 'ALFA átkelőhely', info: 'Közúti híd, állapota: ép.' },
    BRAVO: { at: [350, 315], name: 'BRAVO átkelőhely', info: 'Gázló, állapota: nem felderített.' },
  },
  nai: { NAI1: [475, 160, 42], NAI2: [465, 312, 42], NAI3: [915, 250, 66] },
  avenues: {
    AA1: [[880, 230], [660, 170], [400, 163]],
    AA2: [[880, 285], [660, 325], [395, 314]],
    AA3: [[890, 330], [700, 495], [400, 495]],
  },
  dps: { DP1: [575, 155], DP2: [565, 320] },
};

export const INCIDENTS = [
  { id: 'uav', title: 'Azonosítatlan pilóta nélküli repülőeszköz', severity: 'magas', to: 'A08' },
  { id: 'civ', title: 'Lakossági gépjárműforgalom a mozgási útvonalon', severity: 'közepes', to: 'A03' },
  { id: 'eng', title: 'Műszaki gép meghibásodása', severity: 'közepes', to: 'A07' },
  { id: 'fuel', title: 'Késik a hajtóanyag-szállítmány', severity: 'magas', to: 'A04' },
  { id: 'comms', title: 'Rádióösszeköttetés-zavar', severity: 'kritikus', to: 'A05' },
];

export const VARIANCES = [
  { title: 'BRAVO: emelkedő vízállás, átkelőeszközök észlelése', severity: 'magas', at: [418, 378] },
  { title: '3. harckocsizászlóalj: fogyó hajtóanyag-készlet', severity: 'közepes', at: [222, 392] },
];

const SUBS = ['B1', 'B2', 'TK3', 'ART', 'ENG', 'LOG'];
const ack = (what) => SUBS.map((id) => [id, 'A03', 'subs', `Vettem: ${what}. Nyugtázom.`, id]);

// Allépésenként: [feladó, címzett, csatorna, szöveg, térképhivatkozás]. {n}: COA-k száma, {coa}: jóváhagyott COA.
export const SCRIPT = {
  'S1.1': [['A00', 'A03', 'staff', 'Törzsriadó: elöljárói parancs érkezett. A tervezőcsoport összeállt.', 'CP'],
    ['HHQ', 'CDR', 'higher', 'FIKTÍV-OPORD-10-01: a dandár 03.04. 06:00-ig foglalja el és védje a ZÖLD sáv északi körzetét.', 'LANE']],
  'S1.2': [['A00', 'A03', 'staff', 'Eszközök és dokumentumok kikészítve: elöljárói parancs, felderítési összefoglaló, terep- és időjárásadatok.']],
  'S1.3': [['A02', 'A03', 'intel', 'Helyzetértékelés frissítve: Vörös erő (fiktív) kb. 60 km-re keletre gyülekezik (megerősített).', 'ENEMY'],
    ['A04', 'A03', 'sust', 'Hajtóanyag: a 3. hkz 1,8, a 2. gz 2,1 napi készlettel rendelkezik a 3 napos előírással szemben.', 'TK3'],
    ['A01', 'A03', 'sust', 'Állomány: a legnagyobb hiány a műszaki századnál (97 / 120).', 'ENG'],
    ['A07', 'A03', 'staff', 'A Kék-folyó 60–90 m széles; magas vízállás várható. A BRAVO gázló nincs felderítve.', 'BRAVO'],
    ['A05', 'A00', 'staff', 'Híradás-helyzetértékelés kész, a korlátok felsorolva.']],
  'S1.4': [['A03', 'XO', 'cmd', 'Kezdeti értékelés és időterv-tervezet kész. A végrehajtásig 72 óra áll rendelkezésre.'],
    ['A00', 'XO', 'staff', 'Javaslat: az idő legfeljebb egyharmada maradjon a dandár tervezésére.']],
  'S1.5': [['CDR', 'A03', 'cmd', 'Kezdeti iránymutatás kiadva. A tervezés indul.']],
  'S1.6': [['A03', 'B1', 'subs', 'WARNORD 1: védelmi feladat a ZÖLD sávban várható. Kezdjétek meg a felkészülést.', 'LANE'], ...ack('WARNORD 1')],
  'S2.1': [['A03', 'XO', 'cmd', 'Elöljárói parancs elemezve. Két szinttel feljebb a szándék: a Kék-folyó vonalának megtartása.'],
    ['A03', 'CDR', 'cmd', 'Kötöttség: a tartalék bevetése a hadosztályparancsnok engedélyéhez kötött.']],
  'S2.2': [['A02', 'A03', 'intel', 'Kezdeti IPOE: három megközelítési irány. Az északi az ALFA hídra, a középső a BRAVO gázlóra vezet.', 'AA1'],
    ['A02', 'A07', 'intel', 'A déli irány vizenyős, nehezen járható.', 'AA3'],
    ['A02', 'A03', 'intel', 'Átkelőeszközök mozgása észak felé (valószínű). A Vörös erő tartalékának helye nem ismert (adathiány).', 'ENEMY']],
  'S2.3': [['A03', 'A00', 'ops', 'Lényeges feladat: az ellenség átkelésének megakadályozása ALFA-nál és BRAVO-nál 03.06. 06:00-ig.', 'ALFA']],
  'S2.4': [['A04', 'A03', 'sust', 'Erőforrás-áttekintés: harckocsik 24 / 31, a hajtóanyag a szűk keresztmetszet.', 'TK3'],
    ['A01', 'A03', 'sust', 'Személyi feltöltöttség zászlóaljanként rögzítve a hiánylistában.']],
  'S2.5': [['A03', 'A00', 'ops', 'Korlátok: déli körzet útjai nehézgépjárművel nem terhelhetők; a tartalék kisebb egy zászlóalj-harccsoportnál.']],
  'S2.6': [['A07', 'A03', 'staff', 'Feltételezés: az ALFA híd a végrehajtás kezdetén is járható. Ellenőrizendő.', 'ALFA'],
    ['A05', 'A03', 'staff', 'Feltételezés: az elöljárói híradás a teljes időszakban rendelkezésre áll.'],
    ['A06', 'A03', 'staff', 'Tény: a tüzérosztálynál 16 / 18 löveg hadra fogható.', 'ART']],
  'S2.7': [['A08', 'CDR', 'cmd', 'Kockázatok nyitva: emelkedő vízállás, köd, éjszakai fagy, 03.03-án eső.']],
  'S2.8': [['A02', 'CDR', 'intel', 'CCIR-javaslat: hol és mikor kísérel meg átkelni a Vörös erő?', 'NAI1'],
    ['A03', 'A02', 'intel', 'EEFI-javaslat: a dandártartalék helye és összetétele.']],
  'S2.9': [['A02', 'B2', 'subs', 'Felderítési feladat: BRAVO gázló járhatóságának ellenőrzése (NAI 2).', 'NAI2'],
    ['A02', 'A03', 'intel', 'Információgyűjtési terv: NAI 1 az ALFA, NAI 2 a BRAVO előtt, NAI 3 a gyülekezési körleten.', 'NAI3']],
  'S2.10': [['A00', 'A03', 'staff', 'Időtervek összevezetve.']],
  'S2.11': [['A03', 'CDR', 'cmd', 'Problémamegfogalmazás: két átkelőhely védendő, miközben a tartalék korlátozott és engedélyhez kötött.']],
  'S2.12': [['A03', 'CDR', 'cmd', 'Küldetés (javaslat): a dandár 03.04. 06:00-tól védi az északi körzetet, hogy megakadályozza az átkelést.', 'LANE']],
  'S2.13': [['A00', 'A03', 'staff', 'COA értékelési szempontok súlyozásra előkészítve.']],
  'S2.14': [['A00', 'CDR', 'cmd', 'A küldetéselemzési eligazítás kész, a parancsnoki jóváhagyás következik.']],
  'S2.15': [['CDR', 'A03', 'cmd', 'Küldetés és szándék jóváhagyva; módosított tervezési iránymutatás kiadva.']],
  'S2.16': [['A03', 'B1', 'subs', 'WARNORD 2: küldetés és szándék pontosítva. Átkelőhelyek: ALFA, BRAVO.', 'ALFA'], ...ack('WARNORD 2')],
  'S3.1': [['A03', 'A02', 'ops', 'Relatív erőviszonyok értékelése folyamatban; kérem a Vörös erő pontosítását.', 'ENEMY']],
  'S3.2': [['A03', 'A00', 'ops', 'Lehetőségek összegyűjtve; {n} változat kidolgozása indul.']],
  'S3.3': [['A03', 'A04', 'ops', 'Előzetes erőelrendezés vázolva. Kérem a hajtóanyag-korlát figyelembevételét.', 'COA']],
  'S3.4': [['A06', 'A03', 'ops', 'Tűztámogatási elgondolás: tűzösszpontosítás az átkelőhelyek keleti hozzájárójára.', 'ALFA'],
    ['A07', 'A03', 'ops', 'Műszaki elgondolás: zárás ALFA és BRAVO térségében, a híd rombolásra előkészítve.', 'BRAVO'],
    ['A04', 'A03', 'sust', 'Logisztikai elgondolás: ellátó körlet nyugaton, az északi útvonalon.', 'LOG'],
    ['A08', 'A03', 'ops', 'Oltalmazási elgondolás: légi felderítés elleni rendszabályok a gyülekezési körletben.']],
  'S3.5': [['A03', 'XO', 'cmd', 'Parancsnokságok hozzárendelése és alárendeltségi vázlat kész.']],
  'S3.6': [['A03', 'XO', 'cmd', '{n} COA leírása és vázlata a térképen megtekinthető.', 'COA']],
  'S3.7': [['A00', 'CDR', 'cmd', 'COA-eligazítás kész. Kérem a változatok kiválasztását vagy módosítását.', 'COA']],
  'S3.8': [['CDR', 'A03', 'cmd', 'A COA-k elemzésre kiválasztva.', 'COA']],
  'S4.1': [['CDR', 'A03', 'cmd', 'Elemzési iránymutatás kiadva.']],
  'S4.2': [['A00', 'A09', 'staff', 'Hadijáték-eszközök összekészítve: térkép, szinkronmátrix, kritikus események listája.']],
  'S4.3': [['A03', 'A09', 'ops', 'Saját erők listája átadva.', 'B1']],
  'S4.4': [['A00', 'A03', 'staff', 'A hadijáték feltételezései rögzítve.']],
  'S4.5': [['A03', 'A09', 'ops', 'Kritikus esemény: átkelési kísérlet. Döntési pontok: DP 1 és DP 2.', 'DP1']],
  'S4.6': [['A03', 'A09', 'ops', 'Akció: védőkörletek elfoglalva, felderítés a NAI-kban.', 'NAI1'],
    ['A09', 'A03', 'ops', 'Vörös reakció: megtévesztés ALFA-nál, tényleges átkelési kísérlet BRAVO-nál.', 'BRAVO'],
    ['A03', 'A06', 'ops', 'Ellenakció: tűz átcsoportosítása BRAVO-ra, a tartalék készenlétbe.', 'DP2'],
    ['A07', 'A03', 'ops', 'A zárás telepítése a rendelkezésre álló állománnyal feszes ütemet kíván.', 'ENG'],
    ['A04', 'A03', 'sust', 'A manőver a 3. hkz hajtóanyag-készletét veszi leginkább igénybe.', 'TK3']],
  'S4.7': [['A00', 'XO', 'cmd', 'Belső elemzési eligazítás: szinkronmátrix és döntési pontok frissítve.', 'DP1']],
  'S5.1': [['A02', 'A00', 'staff', 'Előny-hátrány (felderítés) leadva.'], ['A04', 'A00', 'staff', 'Előny-hátrány (logisztika) leadva.'],
    ['A06', 'A00', 'staff', 'Előny-hátrány (tűztámogatás) leadva.'], ['A07', 'A00', 'staff', 'Előny-hátrány (műszaki) leadva.']],
  'S5.2': [['A03', 'XO', 'cmd', 'Döntési mátrix kitöltve.']],
  'S5.3': [['A03', 'XO', 'cmd', 'Törzsajánlás előkészítve a döntési eligazításhoz.', 'COA']],
  'S6.1': [['A00', 'CDR', 'cmd', 'Döntési eligazítás kész. A választás a parancsnoké.', 'COA']],
  'S6.2': [['CDR', 'A03', 'cmd', '{coa} jóváhagyva. Kockázatvállalás és végső iránymutatás rögzítve.', 'COA']],
  'S6.3': [['A03', 'B1', 'subs', 'WARNORD 3: a jóváhagyott változat {coa}. Kezdjétek meg az előkészületeket.', 'COA'], ...ack('WARNORD 3')],
  'S7.1': [['A03', 'A00', 'ops', 'OPORD törzsszöveg és vázlatok kidolgozás alatt, mellékletek bekérve.'],
    ['A04', 'A03', 'sust', 'Logisztikai melléklet leadva.'], ['A05', 'A03', 'staff', 'Híradási melléklet leadva.'],
    ['A06', 'A03', 'staff', 'Tűztámogatási melléklet leadva.', 'ART']],
  'S7.2': [['A10', 'A03', 'staff', 'Belső egyeztetés lefutott; az eltéréslista a törzsnél.']],
  'S7.3': [['A10', 'XO', 'cmd', 'Keresztellenőrzés az elöljárói paranccsal elvégezve.']],
  'S7.4': [['CDR', 'A03', 'cmd', 'Az OPORD jóváhagyva.']],
  'S7.5': [['A00', 'B1', 'subs', 'OPORD kiadva. Nyugtázást kérek.', 'LANE'], ...ack('OPORD'),
    ['A03', 'HHQ', 'higher', 'A dandár parancsa kiadva, az alárendeltek nyugtázták.']],
  'S7.6': [['B1', 'CDR', 'cmd', 'Visszamondás: ALFA átkelőhely védelme, híd rombolásra előkészítve.', 'ALFA'],
    ['B2', 'CDR', 'cmd', 'Visszamondás: BRAVO térségének védelme.', 'BRAVO']],
  'S7.7': [['A03', 'OPS', 'ops', 'A terv átadva a folyó műveleti cellának.', 'CP']],
  'S8.1': [
    [['B2', 'A03', 'subs', 'Jelentés: BRAVO-nál emelkedik a vízállás, a túlparton átkelőeszközök.', 'BRAVO'],
      ['A02', 'OPS', 'intel', 'Megerősítés NAI 2-ből: átkelőeszközök mozgása BRAVO irányába.', 'NAI2'],
      ['A03', 'OPS', 'ops', 'Helyzet és parancs összevetve: eltérés a fő erőkifejtést érinti.', 'BRAVO']],
    [['TK3', 'A04', 'subs', 'Jelentés: hajtóanyag-készletünk a tervezettnél gyorsabban fogy.', 'TK3'],
      ['A04', 'OPS', 'sust', 'Utánpótlás átütemezhető az északi útvonalon.', 'LOG'],
      ['A03', 'OPS', 'ops', 'Helyzet és parancs összevetve: eltérés a 3. hkz mozgásképességében.', 'TK3']],
  ],
  'S8.2': [['A03', 'OPS', 'ops', 'A szükséges döntés megfogalmazva. Döntést kérek.']],
  'S8.3': [['A03', 'A06', 'ops', 'Módosított változat kidolgozva; a tartalék átcsoportosítása hadosztályengedélyhez kötött.', 'RES']],
  'S8.4': [['A09', 'A03', 'ops', 'Vörös ellenpróba lefutott a módosított változatra.'], ['A10', 'A03', 'ops', 'A módosítás ellenőrizve.']],
  'S8.5': [['A03', 'B2', 'subs', 'FRAGORD: tűz- és műszaki támogatás átcsoportosítása a veszélyeztetett körzetbe.', 'BRAVO'],
    ['B2', 'A03', 'subs', 'FRAGORD vettem, végrehajtom.', 'B2'], ['A03', 'HHQ', 'higher', 'FRAGORD kiadva, a helyzetet jelentem.']],
};

// Egy allépés időigénye gyakorlási percben.
export const MINUTES = {
  'S1.1': 10, 'S1.2': 15, 'S1.3': 60, 'S1.4': 30, 'S1.5': 20, 'S1.6': 20,
  'S2.1': 45, 'S2.2': 90, 'S2.3': 30, 'S2.4': 30, 'S2.5': 15, 'S2.6': 30, 'S2.7': 20, 'S2.8': 20, 'S2.9': 30, 'S2.10': 10, 'S2.11': 20, 'S2.12': 15, 'S2.13': 15, 'S2.14': 20, 'S2.15': 30, 'S2.16': 20,
  'S3.1': 30, 'S3.2': 30, 'S3.3': 30, 'S3.4': 60, 'S3.5': 15, 'S3.6': 45, 'S3.7': 20, 'S3.8': 20,
  'S4.1': 10, 'S4.2': 10, 'S4.3': 10, 'S4.4': 10, 'S4.5': 20, 'S4.6': 150, 'S4.7': 20,
  'S5.1': 30, 'S5.2': 15, 'S5.3': 15, 'S6.1': 30, 'S6.2': 30, 'S6.3': 20,
  'S7.1': 150, 'S7.2': 45, 'S7.3': 30, 'S7.4': 20, 'S7.5': 20, 'S7.6': 60, 'S7.7': 20,
  'S8.1': 90, 'S8.2': 15, 'S8.3': 30, 'S8.4': 20, 'S8.5': 15,
};
