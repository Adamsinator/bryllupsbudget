# Mie & Adam – bryllupsplanlægning

Én side til hele planlægningen: overblik, budget, gæsteliste, bordplan, tidsplan og noter.
Ren statisk side (én `index.html`), bygget til GitHub Pages.

## Kør den

Lavet til iPad først, dernæst iPhone og Mac. Læg den på hjemmeskærmen (Del → Føj til hjemmeskærm) – så åbner den som en app uden browserlinjer.

Åbn `index.html` i en browser, eller slå GitHub Pages til på repoet (Settings → Pages → Deploy from branch → `main` / root).

Uden opsætning gemmes alt i browserens localStorage – dvs. hver telefon/computer har sit eget budget.

## Del budgettet mellem jer (anbefalet)

Sæt en lille Google Apps Script-server op, så I begge ser og retter det samme budget:

1. Opret et nyt Google Sheet (fx *Bryllupsbudget*). Det behøver ikke deles med nogen.
2. Udvidelser → Apps Script. Slet indholdet, indsæt [`apps-script/Code.gs`](apps-script/Code.gs).
3. Skift `ACCESS_CODE` øverst i scriptet til jeres egen kode.
4. Deploy → New deployment → Web app · *Execute as: Me* · *Who has access: Anyone*. Kopiér web-app-URL'en.
5. Indsæt URL'en i [`config.js`](config.js) som `API_URL` og commit.
6. Åbn siden – den viser kun en låseskærm, indtil adgangskoden er indtastet. Koden huskes på enheden, men efter **1 times inaktivitet** logges man ud og skal indtaste den igen. "Log ud" i bunden låser med det samme og sletter de lokale data.

Herefter:
- Ændringer gemmes på serveren ~1 sekund efter I retter noget, og hentes hver 30. sekund samt hver gang siden får fokus.
- Arket får fanerne **State** (rå JSON), **Poster**, **Gæster**, **Opgaver**, **Noter**, **Praktisk** (læsbare kopier) og **Historik** (budgettotaler over tid).
- Retter du i `Code.gs` senere: Deploy → Manage deployments → ✏️ → *New version* – så beholder URL'en sig.

`localStorage` fungerer stadig som cache, så siden åbner med det samme og virker offline.

**Cache-gotcha:** Pages serverer alt med 10 minutters cache. Script-tagget i `index.html` har derfor `config.js?v=N` – **bump N i samme commit**, hver gang `config.js` ændres. Kør `./build.sh` før hvert commit: det stempler `index.html` og `version.json` med samme build-tid, og siden viser selv "Ny version klar" og henter den nye side uden om cachen.

## Undersider

- **Overblik** – nedtælling, kirke → fest med adresser og rute, status på budget/gæster/bordplan/tidsplan, seneste ændringer, næste opgaver og seneste noter
- **Budget** – ramme, hvad det koster, hvad der er betalt, buffer; donut over hvad der fylder mest; poster med pris, ✓ betalt, hvem ordner det, note; pris pr. gæst (👥) følger gæsteantallet, som automatisk følger gæstelisten (ja + afventer) – kan slås fra og sættes manuelt
- **Gæster** – navn, side, relation, svar (ja/afventer/nej), barn, kost/allergi; filtre, søgning, "tilføj flere ad gangen"
- **Plantegning & bordplan** – tegn festlokalet: rum (med mål i meter, 1 m = 50 px), områder (dansegulv, lounge, bar, DJ, buffet, kagebord…), langborde (pladser på begge sider, evt. bordender) og runde borde; træk alt rundt og træk i hjørnet for at ændre størrelse; zoom; navnene sidder på pladserne; klik eller træk gæster på plads; print plantegning/bordkort; kost-liste til kokken
- **Tidsplan** – opgaver med deadline og ansvarlig grupperet pr. måned ("9 mdr. før")
- **Program** – selve dagen time for time; punkter før kl. 06 regnes som natten efter og ligger sidst
- **Steder** – kirke, fest og overnatning med adresse, tid, kontakt, aftaler, billede; kort- og rutelinks; liste over gæster der overnatter. Billederne ligger som `odd-fellow-palae.jpg`, `frederiksborg-slot.jpg` og `frederiksborg-slotskirke.jpg` (et sted kan have to billeder) – læg flere billeder i repoet og skriv filnavnet i feltet *Billede*
- **Leverandører** – fotograf, DJ, blomster… med status (ikke kontaktet / i dialog / booket), kontakt, aftalt og mangler
- **Taler & indslag** – toastmasterens køreseddel, fotoliste til fotografen, sange til DJ'en
- **Gaver** – hvem gav hvad, og om takkekortet er sendt
- **Noter** – fritekstnoter med fastgørelse, forfatter og søgning
- **Hvad er nyt** – efter login vælger man "Hvem er du?"; Overblik viser de seneste ændringer med navn

Alt gemmes automatisk; sletning kan fortrydes; JSON-eksport/-import; lys/mørk tema; fungerer på mobil.

## Første gang I bruger den rigtigt

Tryk **Ryd eksempeldata** i bunden: fjerner de opdigtede gæster, bordplaceringer, noter og gaver og nulstiller beløb – men beholder budgetposter, rum/borde, opgaver, program, steder, leverandører, taler og fotoliste som skabelon. (**Nulstil til eksempel** lægger eksemplet tilbage.)

## Samtidige rettelser og backup

Retter I begge på samme tid, flettes rettelserne pr. element (den nyeste rettelse af et element vinder; sletninger huskes, så et slettet element ikke dukker op igen). Gem sker ét ad gangen og prøver selv igen, hvis serveren er optaget.

Arket gemmer de seneste 50 versioner i fanen **Backup** (højst én hvert 5. minut). Rul tilbage: åbn Apps Script, kør `restoreBackup(rækkenummer)` – eller saml JSON-bidderne fra rækken (kolonne D, E, …) til én fil og importér den i appen. De læsbare faner (Poster, Gæster, …) genskrives højst én gang i minuttet; kør `refreshMirrors()` i editoren, hvis du vil have dem opdateret med det samme.
