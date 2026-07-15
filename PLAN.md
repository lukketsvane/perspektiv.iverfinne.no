# PLAN.md; femtepunkt (arbeidstittel), v2

krumlineært blokkmiljø i nettlesaren. 5-punkts (fiskeauge-)perspektiv slik kim jung gi brukar det: raud konstruksjonsgrid, svart blekk, boksar som vert dregne opp frå golvet; referansekubar til figurteikning (boks kring kropp, boks som volumproxy). kameraet er eit auge i scena med augehøgd i mm.

**ui-laust er eit hovudkrav**: ingen verktøylinje, ingen inspektør, ingen persistente panel. papiret er tomt; alt er gest og kontekst.

referanse: youtube NabiiA14sZs («infinite fisheye» vert M7) og kjg-arka med grøne boksar kring figurar (fritt roterte, menneskeproporsjonerte; difor yaw og figurboks i v1).

claude code: les heile fila før du skriv kode; arbeid milepæl for milepæl; sjå §10.

## 0. mål og ikkje-mål

**mål v1**
- fullskjerm canvas; fiskeaugesirkelen innskriven (`cover`-modus som val)
- boksar: dra fotavtrykk på golvet, dra opp høgda; flytte, slette, duplisere; **yaw-rotasjon**; figurboks-stempel; snapping
- kamera: sjå (yaw/pitch), gå, augehøgd i mm, fov, projeksjonsbrytar; orbit kring vald boks som gest
- raudgrid + golvgrid + vp-prikkar + horisont
- undo/redo, autolagring, json- og svg-eksport
- mus og touch (ipad), alt utan krom

**ikkje-mål v1**: pitch/roll på boksar; okklusjon (konstruksjonslook, gøymde liner synlege); skuggelegging; fleirbrukar; figurar utover boksproxyar.

## 1. arkitekturval

1. **projeksjonen er ei rein funksjon, ikkje ei kameramatrise.** alt (grid, boksar, plukking, eksport) går gjennom `project`/`unproject`; retning på einingssfæra ↔ punkt på skjermen. byte av mappingfunksjon gjev fiskeauge, panorama, lineært.
2. **inga three.js i v1.** rette liner i verda er kurver på skjermen; webgl rasteriserer rett mellom projiserte vertex, så anten tessellere alt eller rendere via cubemap. adaptiv sampling på cpu + canvas2d gjev skarpare strek og testbar matte. 200 boksar er nokre titusen punkt per frame; trivielt.
3. **blekk fyrst.** papir, raud konstruksjon, svart strek, blå seleksjon (bic-fargane). svg-eksport med lag følgjer gratis; plottarvennleg.
4. **ui-laust.** all handling er direkte manipulasjon; kva peikaren treffer avgjer verknaden. presisjon utan krom: flyktige mm-visarar som tonar inn under gesten og ut 800 ms etter, pluss blender-style taltasting midt i ein gest.
5. v2 kan leggje til skuggemodus (three: cubecamera → fiskeaugeshader) utan å røre datamodell eller interaksjon.

## 2. matematikk

alle lengder i **mm**. verdsaksar: +y opp, golv i y=0. vinklar i radianar internt.

### kamerabasis
yaw ψ kring +y (ψ=0 ser mot −z), pitch τ (positiv opp); roll utsett.

```
fwd   = (−sinψ·cosτ,  sinτ,  −cosψ·cosτ)
right = ( cosψ,       0,     −sinψ )
up    = cross(right, fwd)          // = (0,1,0) ved τ=0
```

### projeksjonar
θmax = fov/2. R = synsradius i css-px (innskriven: 0.485·min(w,h)).

| namn | rₙ(θ) | invers θ(rₙ) | merknad |
|---|---|---|---|
| `stereo` (default) | tan(θ/2)/tan(θmax/2) | 2·atan(rₙ·tan(θmax/2)) | storsirklar → sirkelbogar; identisk med kompasskonstruksjonen i klassiske 5-punktsgrid; fov < 360 (ui-tak 300) |
| `equi` | θ/θmax | rₙ·θmax | lik vinkel per radius, som ekte fiskeaugelinse; fov ≤ 360 |
| `linear` | tan(θ)/tan(θmax) | atan(rₙ·tan(θmax)) | vanleg perspektiv til samanlikning; fov < 180 |

```
project(P):                      // P i verds-mm
  d = normalize(P − C)
  x' = d·right; y' = d·up; z' = d·fwd
  θ = acos(clamp(z', −1, 1)); φ = atan2(y', x')
  if θ > θmax → { visible:false }
  rₙ = mapping(θ)
  → { x: cx + R·rₙ·cosφ,  y: cy − R·rₙ·sinφ,  visible:true }

projectDir(d):                   // for vp-ar og guidegrid (punkt i det uendelege)
  som over, utan subtraksjon

unproject(sx, sy):
  u = (sx−cx)/R; v = (cy−sy)/R; rₙ = hypot(u,v); φ = atan2(v,u)
  θ = mappingInv(rₙ)
  dc = (sinθ·cosφ, sinθ·sinφ, cosθ)
  → normalize(dc.x·right + dc.y·up + dc.z·fwd)   // verdsretning; ray = (C, d)
```

### treff
- golv: `t = −C.y / d.y`; krev `d.y < 0` og `t > 0`; P = C + t·d
- boks: transformer strålen til boksens lokale ramme (trekk frå sentroid, roter −yaw), så aabb slab-test; plukking skjer alltid i geometrien, aldri i skjermformer
- stabling: fyrste treff på topp-flate (normal +y) gjev basisplan y = flatas høgd

### adaptiv sampling av segment [A,B]
```
prosjiser A, B; M = midtpunkt i verda
split om: |project(M) − midt(sA,sB)| > ε (0.35 css-px)
       eller synlegheit skiftar mellom endane
maks djupn 11; ved synlegheitsskifte: bisser mot θ=θmax til < 0.1 px, bryt polylinja der
vakt: segment nærare C enn 1 mm → del ved nærpunktet, dropp biten
```
utdata: polylinjer i skjerm-px; same funksjon driv canvas og svg.

### vp-invariantar (testar)
- `projectDir(±X, ±Y, ±Z)`: ved fov 180 og τ=0 er nøyaktig 5 synlege; sentrum + 4 på randa
- storsirkel gjennom synsretninga → kolineære skjermpunkt (begge projeksjonar)
- `stereo`: tre punkt på vilkårleg storsirkel ligg på éin skjermsirkel (sirkelfit-residual ≈ 0); `equi` gjer det ikkje
- punkt i augehøgd → skjerm-y = cy ved τ=0 (horisonten skjer alt i augehøgd)

## 3. datamodell

```ts
type Box = { id: string; min: [x, y, z]; size: [w, h, d]; yaw: number }  // mm; yaw kring sentroid
type Camera = { pos: [x, y, z]; yaw: number; pitch: number;
                fov: number; proj: 'stereo' | 'equi' | 'linear' }
type Doc = { version: 1; boxes: Box[]; camera: Camera; settings: Settings }

const FIGURBOKS = { w: 500, h: 1750, d: 300 }   // ståande menneske, kjg-proxy
```

- augehøgd = `camera.pos[1]`; 300–10000 mm; presetar via taltasting: 300 (golv), 1200 (sitjande), 1780 (ståande), 3500 (stige), 8000 (drone)
- snap: 50 mm flytt/teikn, 15° yaw (⇧ = fritt); nudge piltastar 10 mm, ⇧ 100 mm

## 4. interaksjon; heile ui-et er gestar

prinsipp: kva peikaren treffer avgjer verknaden (prioritet: boks > horisontband ±24 px > golv). flyktig hud: verdiar (mm, °, fov) tonar inn under gesten, ut 800 ms etter. midt i kvar gest kan ein taste tal + enter for eksakt mm/gradverdi, blender-style. ingen gizmoar; vald boks får berre tynn blå kontur.

### desktop

| inndata | handling |
|---|---|
| venstredrag på tomt golv | teikn fotavtrykk → slepp → mus opp/ned set høgd → klikk stadfestar; esc avbryt |
| venstredrag på bokskropp | flytt i basisplanet |
| venstredrag på topp-flate | endre høgd (push/pull) |
| ⇧-drag boks | vertikal flytt (stabling) |
| ⌥-drag boks | dupliser |
| r + musrørsle (vald boks) | yaw kring sentroiden, snap 15° |
| dobbeltklikk tomt golv | stemple figurboks (500×1750×300), yaw vend mot kameraet |
| klikk boks / esc | vel / vel bort |
| del eller x | slett vald |
| høgredrag | sjå (yaw/pitch); startar draget på vald boks: orbit kring sentroiden hennar, konstant radius |
| scroll | augehøgd; ⌥scroll = fov |
| wasd | gå (⇧ ×4) |
| p / g / j | projeksjonsbrytar / grid-lag-syklus / jitter |
| ⌘z / ⇧⌘z | undo / redo |

### touch (ipad)

| gest | handling |
|---|---|
| éin finger drag på tomt golv | teikn fotavtrykk → slepp → vertikal drag = høgd → tap stadfestar; to-finger tap avbryt |
| éin finger drag på boks | flytt; på topp-flate: høgd |
| tap boks | vel |
| long-press boks | slett (progressring ~450 ms) |
| to-finger twist på vald boks | yaw, snap 15° |
| dobbelt-tap tomt golv | figurboks |
| to-finger drag | sjå; startar på vald boks: orbit kring han |
| pinch | fov |
| éin finger vertikalt på horisontbandet | augehøgd, mm-visar (horisonten er handtaket for auget) |
| tre-finger drag | gå (skjermrelativt) |
| to-finger tap / tre-finger tap | undo / redo (procreate-konvensjonen) |
| to-finger long-press | flyktig innstillingsark (proj, grid-lag, jitter, eksport); tonar ut ved tap utanfor |

attkjenning: twist/pinch/pan skiljast på dominant komponent med hysterese (start som udefinert, lås etter 8 px / 6° / 6 % skala). pointer capture; all lytting rydda ved unmount. fsm: `idle → drawFootprint → extrude`; `idle → dragMove | dragHeight | rotate`; `idle → look | orbit | walk`.

merk: fyrsteperson er grunnsanninga (augehøgd i mm er sjølve poenget); orbit finst berre som gest kring vald boks. dette er medvite ulikt blender sin frie orbit.

## 5. visuelt

- papir `#f7f4ee`; blekk `#1a1a1c`; raudgrid `#c8232e` @ 55 %; seleksjon bic-blå `#1155cc`; vp-prikkar raude med liten label
- linjevekt blekk: 0.8–2.0 px, fell med avstand; grid 0.6 px flat
- **raudgrid** (verdslåst, roterer med blikket slik vp-ane gjer): tre storsirkelfamiliar, éi per verdsakse, kvar 15°; ±Y = biletet av alle vertikalar, ±X og ±Z = guidar for horisontalar; togglebare kvar for seg; pluss horisont (d.y = 0) med mm-merke for augehøgda
- **golvgrid**: 100 mm innanfor 5 m radius, 1000 mm ut til 30 m
- valfri blekk-jitter (deterministisk seed, av som default)
- devicePixelRatio ≤ 2; resize-observer

## 6. filstruktur (sveltekit + ts)

```
src/lib/perspective/
  camera.ts        // basis, presetar
  projection.ts    // project / projectDir / unproject; tre mappingar; reine funksjonar, null importar
  sample.ts        // adaptiv sampling, klipping, polylinjer
  scene.ts         // Box-ops (inkl. yaw), ray/golv, ray/obb, stabling
  grid.ts          // storsirkelfamiliar, golvgrid, horisont, vp-ar
  history.ts       // kommandostabel (AddBox / DeleteBox / UpdateBox med før/etter)
  io.ts            // json inn/ut, localStorage-autolagring (debounce 1 s)
  svg.ts           // eksport; lag: g#raudgrid, g#golv, g#blekk, g#vp; clip-path sirkel
src/lib/ui/
  gestures.ts      // peikar-fsm, attkjenning med hysterese, taltasting-buffer
  Viewport.svelte  // canvas + kopling til gestures; ingen matte her
  Hud.svelte       // flyktige visarar (mm, °, fov)
  Sheet.svelte     // flyktig innstillingsark (touch)
src/routes/+page.svelte
tests/  projection.test.ts  sample.test.ts  scene.test.ts  gestures.test.ts   // vitest
```

## 7. milepælar (éin commit kvar; akseptkriterium i kursiv)

- **M1 matte + testar.** projection/sample/scene med full vitest-dekning. *round-trip < 1e−9 rad; alle §2-invariantane grøne; ingen dom.*
- **M2 statisk render.** canvas fullskjerm, raudgrid, golvgrid, horisont, vp-ar, papirstil. *horisont gjennom sentrum ved τ=0; line gjennom sentrum held seg rett; 60 fps.*
- **M3 kamera.** sjå, gå, augehøgd (scroll + horisontgrep + taltasting), fov, projeksjonsbrytar, orbit-gesten. *senka augehøgd 1780 → 300 gjev froskeperspektiv; brytar equi/stereo endrar kurvatur, ikkje komposisjon; horisontgrepet verkar på ipad.*
- **M4 boksar.** teikn/velje/flytte/slette/dupliser, yaw, stabling, figurboks-stempel, snapping, taltasting. *teikn 10 boksar på 60 s med mus og med touch; roter ein figurboks 45° og flytt han; alt fylgjer peikaren eksakt via unproject.*
- **M5 persistens.** undo/redo, autolagring, json inn/ut, svg-eksport. *reload beheld scena; svg opnar med korrekte lag i inkscape; procreate-tappane verkar.*
- **M6 strekfinish.** avstandsvekta linjevekt; **hovudmodul-merke** (tick kvar 1/8 av h på vertikale kantar, toggle; 8-hovuds figurpraksis); valfri kvitmaska flater (fylte i papirfarge, sortert på sentroid-djupn) som pseudo-okklusjon; jitter. *av/på utan fps-fall ved 200 boksar.*
- **M7 panorama («uendeleg fiskeauge»).** ekvirektangulær (og sylindrisk) mapping i same pipeline; stripe n×90° med gjentekne vp langs horisonten. *same scene render både som sirkel og stripe utan kodeendring i scene/grid.*

**v2 (etter M7):** three-skuggemodus via cubemap; push/pull på alle flater; ekte okklusjon; png-eksport i høg oppløysing; deling via url-hash; enkel mannequin i boksen.

## 8. ytelse

budsjett: sampler + teikning < 6 ms/frame ved 200 boksar (m1 macbook / ipad pro). om det ryk: typed arrays, dirty-flagg på grid (berre reprosjiser ved kamerarørsle), aldri worker før profilering krev det.

## 9. testliste (vitest, utan nettlesar)

1. round-trip alle tre projeksjonar, 1000 tilfeldige retningar
2. vp-tal og -posisjonar ved fov 180/220/300
3. kolinearitet gjennom sentrum; sirkelfit-diskriminanten stereo vs equi
4. horisont = augehøgd
5. sampler: kurvefeil < ε; polylinjebrot ved θmax; nærkamera-vakt
6. ray/golv, ray/obb med yaw, stablingsplan; kjende fasitar
7. history: 20 tilfeldige ops fram/attende gjev identisk doc-json
8. gestures: hysterese-låsing og taltasting-buffer som rein logikk

## 10. instruks til claude code

- legg denne fila i rota; lat CLAUDE.md peike hit («les PLAN.md fyrst»)
- gå milepæl for milepæl; ikkje hopp; kvar milepæl = eigen commit med grøn `pnpm test` og `pnpm check`
- M1: skriv testane fyrst
- `projection.ts` og `sample.ts` skal vere reine ts utan importar; ui-komponentar skal ikkje innehalde matte
- ingen three.js, ingen tilstandsbibliotek; svelte 5 runes held
- **inkje synleg krom**: ingen knappar, panel eller slidere i dom-en utover Hud/Sheet slik §4 og §6 spesifiserer
- v0-utkastet er interaksjonsskisse, ikkje kjelde: ikkje arv rendering eller kamerakode derifrå; projeksjonskjernen kjem frå §2 og skal passere §9
- ikkje legg til funksjonar utanfor milepælen utan å spørje

## 10b. endringar etter v1 (vedteke i økt, juli 2026)

- **meter i grensesnittet**: hud, horisontmerke og taltasting viser/tolkar meter (1.78⏎ = ståande auge). kjerna, snapping og json er framleis mm (§2 uendra); berre presentasjonslaget byter eining.
- **scene-presetar med randomisering**: `presets.ts` med seks generatorar i menneskeskala — folkemengd, klasserom, verkstad, stall (hestar av boksar), hovudstudie (boksa hovud på soklar), figurrekkje. `t` lastar tilfeldig preset; arket listar alle. lastinga er eitt angre-steg (scene-kommando i history).
- **cover som default**: papiret dekkjer heile skjermen; innskriven fiskeaugesirkel er valet (`c` / arket).
- **verktøylinje** (mjukna ui-laust-krav, vedteke av brukaren): tre diskrete knappar oppe til høgre — referanselås (`l`; blokkerer all redigering og kamerarørsle når vindauget er teiknereferanse), inverter/mørk modus (`i`; papir↔blekk, persistert), og innstillingsarket (som elles ligg på to-finger long-press).
- **pose-drivne bounding boxes** (v1.3): figurboksane i presetane er tette kring posituren slik kjg teiknar dei — ståande/gåande/lenande/hukande/sitjande/bøygd med sterkt varierte proporsjonar; hundar og hestar som kropp+hovud(+bein). folkemengda er straumar/køar med følgjesvenar, samtalepar og kasse-sitjarar.
- **ni presetar med designa synspunkt** (v1.3): + gate (stup frå takhøgd ned i husskaret, à la buss-arket), teiknekveld (publikumsring kring golvlerret) og interiør (rom med veggar og innreiing). kvar preset har 2–3 komponerte synspunkt (augehøgd, fov, sikteanker i boksane) som randomiseringa vel mellom.
- **dokumentversjon 2** (v1.3): v1-lagringar migrerer `fit` → cover ved lasting (gamal default skal ikkje overstyre ny); aktive val elles overlever. kompaktare ark (to kolonnar, rulletak) og mindre verktøylinjeknappar.
- **navigasjon fyrst** (v1.4, reviderer §4): å sjå skal koste ingenting, å plassere/redigere skal vere medvite. drag (mus som finger) ser seg om; klikk/tapp vel; drag redigerer berre den valde boksen. nye boksar krev anten teiknemodus (blyant-knappen / `b` — då gjeld §4-tabellen som før), long-press på golvet (touch), eller penn — apple pencil går alltid i redigeringsløypa. to-finger pan = gange i navigasjonsmodus (sjå i teiknemodus); resten av §4 står. flyktige hint i hud-en («dra fotavtrykket», «dra høgda · tapp festar») + fyrstegongstips på tomt papir.

- **kvalitetsvakt for presetar** (v1.5): kvar `t`-lasting vert komposisjons-skåra i skjermrommet (del synlege boksar, spreiing i ramma, nærfelt 0.35–5.2 m, aldri kamera inne i ein boks) og trekt om att til skåren står seg (`buildGreatPreset`, golv 0.55); testgaranti 13 presetar × 30 seed. fire nye scener: marknad (bodar m/ stolpar+tak), containerhamn (stabla containergater + kran), byggeplass (stillasgrid, plattingar, pallar), bibliotek (hyllegater + lesekrok).

- **kjg-stramming** (v1.6): shuffle-ikon direkte i verktøylinja (tilfeldig scene utan å opne arket, og utan å avsløre scenenamnet — berre namngjevne val frå arket viser namn). ny `sitgolv`-pose (hovud 0.85–1.0 m) for golv-sitjarar i teiknekveld/interiør; skuterføraren i naturleg sitjehøgd; høgdevakt-test (ingen menneskeproporsjonert boks over 2.0 m, søyler unnatekne). nærfelt-kravet i komposisjonsskåren stramma til 0.35–3.8 m (kim har alltid eit ruvande anker), og froskeblikk (0.47 m) og målarblikk (0.86 m) lagde til synspunktbanken.

- **fem nye scener + detalj-pass** (v1.7, 18 presetar totalt): karavane (kamel/hest/struts bygde av boksar med ryttarar i salen, geiteflokk, gjetarar — demoarket), konsert (scenegolv, band, tromme-klynge, forsterkarar, lysrigg med kastarar, publikum i bogar, barn på skuldrene), perrong (togvegg, søylerekkje med tak, benker, ventande med kofferter), kjøkken (benkerekkjer med gryter, avtrekkshetter, bøygde kokkar), kontor (pultøyar med skjermar og sitjande, skiljeveggar, møtebord, planter, tavle). detalj-pass på eksisterande: verktøy på verkstadbenkene, bøker/sekkar i klasserommet, markiser og skilt i gata. alle med 3 komponerte synspunkt og dekte av kvalitets- og høgdevaktene.

- **croquis og matbar** (v1.8, 20 presetar): croquis-salen (modell på podium med stol og parasoll, to bogar av staffeli — fremre sit på krakkar, bakre står — sekkar på golvet, og fire blikk inkl. MODELLENS attende på klassen og froskeblikk ved podiumkanten); matbaren (trong osaka-gate: diskar med flasker/fat/kanner, veggh hyller, hengjande skilt, gjester lenande og på krakkar på begge sider, kokk bak disken, sekk på golvet; gate-, disk- og kokkeblikk). verkstaden fekk papirbunker og benkelampar frå fabrikk-arket.

## 11. opne val

1. stakken i repoet: går ut frå sveltekit + ts + vitest + pnpm; stemmer det?
2. fyrsteplattform: ipad-touch eller desktop-mus? (begge spesifiserte; svaret styrer kva M3/M4 poler mot fyrst)
3. v1 utan okklusjon, rein konstruksjonslook: ok?
4. gestkartet i §4: veto no; det er dyrt å flytte gestar seinare
5. namn/subdomene: framlegg `femtepunkt.iverfinne.no`
