// The shapes of 24 flowcharts Claude wrote in real sessions, with every id and displayed word replaced
// by a made-up word of the same length. The tests draw them at several widths.
export const CORPUS: string[] = [
  `flowchart LR
    U[/"Nikeda"/]:::kulil
    M(["Fegoza Tusa"]):::rovotaso
    L(["Bokerir"]):::rovotaso
    H(["Tufa"]):::rovotaso

    U -->|"Tusa mitavudene"| M
    M -->|"Bokerir mitavudene"| L
    L -->|"Tufa mitavudene (kubes)"| H

    subgraph AO ["Tufa mitavudene (kubes)"]
        direction TB
        Y1["Firumakozol + bififolu"] --> Y2["Buge mitavudene"]
    end

    L -.-> AO -.-> H

    classDef kulil fill:#fde68a,stroke:#b45309,color:#000
    classDef rovotaso fill:#bfdbfe,stroke:#1d4ed8,color:#000`,
  `flowchart LR
  GY[topaliv-bolaki] --> ZRW["ZRW<br/>takoni + parakev<br/>prr: vda raleku, zabumo"]
  ZRW --> TOTA["TOTA<br/>Fitare + parakev<br/>hm: gxk raleku<br/>prr: vda tufa"]
  TOTA --> MC["MC<br/>vda lafa zakef"]
  MC --> OT[zoderizi-bofipogov]
  TOTA -. "kepe: tira raleku ganuru wc goli" .-> ZRW
  MC -. bed .-> ZRW
  OT -. malefutafo .-> ZRW`,
  `flowchart LR
  GY[topaliv-bolaki] --> ZRW
  B1(["rupo ragi TOTA, kepe:<br/>tira raleku ganuru wc goli"]) -.-> ZRW
  B2(["rupo ragi MC:<br/>bed"]) -.-> ZRW
  B3(["rupo ragi zoderizi-bofipogov:<br/>malefutafo"]) -.-> ZRW
  ZRW["ZRW<br/>takoni + parakev<br/>prr: vda raleku, zabumo"] --> TOTA["TOTA<br/>Fitare + parakev<br/>hm: gxk raleku<br/>prr: vda tufa"]
  TOTA --> MC["MC<br/>vda lafa zakef"]
  MC --> OT[zoderizi-bofipogov]`,
  `flowchart LR
  R["gapup<br/>voli"] --> Q["zrw<br/>voli, 27 gmw<br/>6.68 GFA"]
  Q --> G["tota<br/>voli, 6 gmw<br/>1.15 GFA"]
  G --> B["timola<br/>voli: gudu mc"]
  B --> X["MC zateb 1027<br/>zunudod"]`,
  `flowchart LR
  V["Zateb 1024<br/>xej suzot, kwq poziran"] --> U["08:23 llx nivo<br/>gtz sepupe hxl dj tisevo,<br/>vda zateb dj nimibe"]
  D["08:25 popava<br/>'nevida vda zateb fekuv'"] --> Y["08:28 zateb 1026<br/>tuzorik rb zesa,<br/>yox poziran"]
  Y --> DC["kubes vevule<br/>40 gmw, 5.99 GFA"]
  DC --> X["MC zateb 1028<br/>datebuk rb vda nita"]`,
  `flowchart LR
  MAPA["mapa"] --> GUDU["gudu · 099j1524<br/>kwq sade<br/>(TZ #102 ef mapa, buko, zaludoselol)"]
  GUDU --> IX["terik-sade · 30gopo39<br/>43 pedosom zumim<br/>183 medaf"]
  IX --> VN["vevekopole<br/>kubes 540, MC 538,<br/>zoderizi-bofipogov 539"]`,
  `flowchart LR
  L["✓ kidaza 3v7352r6<br/>tota nemapu: baseku"] --> W["◐ nivo ef terik-sade + gudu<br/>(nako: dopo porol)"]
  L --> M["✓ kubes zipebi buzobo"]
  M --> U["○ nivo kubes ef vda vevekopole<br/>fumag xvr mubu pigu"]`,
  `flowchart LR
  Y["Kubes · hxl 79421<br/>voli, 43 gmw, 7.82 GFA"] --> M["MC zefuto<br/>28 gavo, 1 ponedu:<br/>vda mego-tigi otq"]
  M --> X["MC manonus<br/>8 vedikuvu,<br/>4 fadalomu"]
  X --> P["Memesid: TOSIMO<br/>gudu: bed · MC tazub 3"]
  P --> Z["Kubes kulil (tisevo)<br/>19 gavo za navi"]`,
  `flowchart LR
  F["✓ mubu fis topuposo"] --> U["✓ kubes somupa<br/>poziran 24, nemapu baseku"]
  U --> D["✓ popava hm vda nenaz NG"]
  U --> B["✓ raropit: duku, tirolezot dige, tufa medo"]
  U --> H["◐ beva tina: bofa poziran nobagol"]
  U --> Q["○ munos tota ur baseku<br/>(savu makuman keve k kubes)"]`,
  `graph LR
  Y1[dunalad: kidaza 1] --> Y2[dunalad: kidaza 2]
  Y1 --> B1[moneve za kidaza 1, fasur]
  Y2 --> B2[moneve za teber gizus]
  Y2 --> V[ruve vda gida]
  Y2 --> P[difadet sepeku, bidetabu gida]
  B2 --> U[nivo]
  V --> U
  P --> U`,
  `flowchart LR
  subgraph Vegak
    k1[bavaliv] --> k2[bed] --> k3[mofovimo bavaliv] --> k4[bed] --> k5[mofovimo bavaliv] --> k6([kosog ruve: ef Mutaza])
  end
  subgraph Niguze
    y1[bavaliv] --> y2{fudo prr}
    y2 -->|tetalibok| y3([zapogup hm gxk nesu])
    y2 -->|sigo, guzep qq| y4[bed] --> y5[bavaliv, fezo fufu] --> y6([dore: melozu vda raleku ea bofa vda bed])
  end`,
  `flowchart LR
  subgraph K["Bapidenoteku, munos"]
    K1["Takoni keve vda givi'm kamir"] --> K2["Raleku tw gtz swg rovotaso (zrw tov tota nasem)"]
  end
  subgraph V["Malefutafo, gobube"]
    V1["Nopuma buge za k barufo raleku"] --> V2["Sg-lereg refaseravalo"] --> V3["Panozuku ragi gefapo mumesugu"]
  end
  K2 --> V1
  W["Gure soses: k direkoz, vcx goza"]`,
  `flowchart LR
  B[topolato] --> K[rurove mego] --> R[rumuse geli vda zelofalu tw gtz furi sodoz] --> L[pafot kitomadu kideb qq] --> F[gxk nesu lej bunonab: fofu ea poguduguzab, bemep tibe, ragi vuzamat] --> V{bed, zapogup, ea ef Mutaza}`,
  `flowchart LR
  Q[dukek mapa, vopen] --> K[fefova TZ] --> Y[fefova TZ] --> L[fefova TZ, losuta/mapa] --> Z[vda melozu]`,
  `flowchart LR
  Y{dunalad lubugovel?} -->|zxx| TI[bezifek, desat qq hm gtz dagela]
  Y -->|fh| U[kinufeva ef vda pafot kitomadu]
  U --> L{pafot kitomadu lubugovel?}
  L -->|zxx| DX[bezifek, mirop azh salip Pufebut bozezas duvava]
  L -->|fh| P[kinufeva tov fumag xvr azh]`,
  `flowchart TD
    K[Takoni durakim] --> Y{Raleku kamir hm vda wuf}
    Y -- vedikuvu --> K
    K -. zemo: revi, rupan zn fs il .-> K
    Y -- vevule --> L[Netopo: keve vda kamir, genogof k sulolig raleku]
    L --> V{Givi keve vda fezo kamir}
    V -- vevule --> J[Raleku barufo]
    J --> R[Tota]
    R -- lafa mivo Fitare dokat pva dizi, kepe --> K
    K -- durakim luve leti fh netopo --> Z[Bazu xvr k nakesa, leti vda furi vedikuvu]
    V -- dubegez ragi vda wuf --> T[Sokib goful: bazu xvr k nakesa]`,
  `flowchart TD
    K["Takoni durakim"] --> Y{"Raleku kamir hm vda wuf"}
    Y -->|"vedikuvu"| K
    Y -->|"vevule"| L["Netopo keve vda kamir tov genogof k sulolig raleku"]
    L --> V{"Givi keve vda fezo kamir"}
    V -->|"vevule"| J["Raleku barufo"]
    J --> R["Tota"]
    R -->|"kepe xvr mivo lafa Fitare pva dizi"| K
    K -->|"durakim kalofuda leti fh netopo"| Z["Bazu xvr k nakesa leti vda furi vedikuvu"]
    V -->|"dubegez ragi vda wuf"| T["Sokib goful tov bazu xvr k nakesa"]`,
  `flowchart LR
    K["Sopo sutoz hm"] --> Y["Zrw: fs MO teten fogapem vda tufa"]
    Y --> L["Tota: Neku'm tarof vovido qq"]
    L --> V["MC ziledob qq"]
    V --> J["Zoderizi tov vomefifo"]`,
  `flowchart LR
    K["Bapidenoteku: vda takoni keve vda kamir tov sufefug"] --> M2["Divanukor: kubes vda yox raleku kudef"]
    M1["Divanukor: safunu vda kudef tov mefab qq"] --> M2
    M2 --> V2["Malefutafo: yox filide tov yox motezi"]
    V1["Malefutafo: nenabiben tov lefisedop"] --> V2`,
  `flowchart LR
  subgraph H["Vegak: gxk rimuvozol, limemin rb vda takoni hm golo buvifo"]
    K["Gudez'm fofebe: vufe, vogubo, vigi, zigaka"]
    Y["Gudez'm fofebe: betumutat"]
    L["Llx gukuz: foram zukiritunora qq zolovo, gona-diviguv"]
    V["Llx gukuz: vda nomo xvr gtz sofu"]
    K -. mileted rb mekok .- Y
    K -. mileted rb mekok .- L
  end
  subgraph D["Loruvolim: limemin kepe"]
    J["Rimuvozol"] --> R["Gudez'm fofebe, bimevoz"]
    J --> W["Mivo vda kamir, tota tov MC ruve, bimevoz"]
  end`,
  `flowchart LR
  subgraph sibi["durakim sibi-ho (gxk menime)"]
    tf-sibi-ho --- rabuvi-zetobos --- kevusut
  end
  subgraph zidel["zazodaki gagib (gxk menime)"]
    lotuzuvo --- zesu --- lukadeka
  end
  subgraph livum["serunet (gxk menime)"]
    basekano --- buko-tz
  end
  dokat["peve dokat: tf-rile, tf-pagezi, tf-pibofone, tf-gezukol, tf-libamorag, tf-vavel-rosut, uae-pobukub"]`,
  `flowchart LR
  FO["FO ze mapov"] --> V["tusasikukopopifudelot.kfl<br/>(Fopala, sate lutu)"]
  V -->|"/"| N["noti nd tamo"]
  V -->|"/rasem"| A["zazi<br/>(Sukotinefi, butum nd Zemitar)"]`,
  `flowchart LR
  B["Gidizumonor: mivo vda posa depa"] -->|rimol| R["Pevu: gxk dafaz vda rurove kosirud za"]
  L["Rimuvozol: gxk gefapo nesu"] -->|zolovo| B
  L -->|filide| R
  H["Sofu Fitare vovido"] -->|deroron| R
  R -->|kagi hm| J["Mutilepo: k debugu bugul, k fufu hm k mego, vda gurasan"]
  R -->|senetu prr ragi| R`,
  `flowchart TD
  B[K lotuzuvo porol sivodam, fko lafa punitosa ruga]
  B --> K[Mivo k tazub bipod: X1 X2 X3 X5 X7 X13]
  B --> Y[Mivo melu tomuz tov mivo qq deroron: X4 X6 X8 X9]
  B --> L[Domebok vda sivodam: X10 X11]
  B --> V[Vda debugu: X12]
  L --> J[Khy k durakim rasive: zerugav]
  V --> J`,
]
