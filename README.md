# Mie & Adam – bryllupsplanlægning

Én side til hele planlægningen: overblik, budget, gæsteliste, bordplan, tidsplan og noter.
Ren statisk side (én `index.html`), bygget til GitHub Pages.

## Kør den

Åbn `index.html` i en browser, eller slå GitHub Pages til på repoet (Settings → Pages → Deploy from branch → `main` / root).

Uden opsætning gemmes alt i browserens localStorage – dvs. hver telefon/computer har sit eget budget.

## Del budgettet mellem jer (anbefalet)

Sæt en lille Google Apps Script-server op, så I begge ser og retter det samme budget:

1. Opret et nyt Google Sheet (fx *Bryllupsbudget*). Det behøver ikke deles med nogen.
2. Udvidelser → Apps Script. Slet indholdet, indsæt [`apps-script/Code.gs`](apps-script/Code.gs).
3. Skift `ACCESS_CODE` øverst i scriptet til jeres egen kode.
4. Deploy → New deployment → Web app · *Execute as: Me* · *Who has access: Anyone*. Kopiér web-app-URL'en.
5. Indsæt URL'en i [`config.js`](config.js) som `API_URL` og commit.
6. Åbn siden – den viser kun en låseskærm, indtil adgangskoden er indtastet (én gang pr. enhed). "Log ud" i bunden låser igen og sletter de lokale data.

Herefter:
- Ændringer gemmes på serveren ~1 sekund efter I retter noget, og hentes hver 30. sekund samt hver gang siden får fokus.
- Arket får fanerne **State** (rå JSON), **Poster**, **Gæster**, **Opgaver**, **Noter** (læsbare kopier) og **Historik** (budgettotaler over tid).
- Retter du i `Code.gs` senere: Deploy → Manage deployments → ✏️ → *New version* – så beholder URL'en sig.

`localStorage` fungerer stadig som cache, så siden åbner med det samme og virker offline.

**Cache-gotcha:** Pages serverer `config.js` med 10 minutters cache. Script-tagget i `index.html` har derfor `config.js?v=N` – **bump N i samme commit**, hver gang `config.js` ændres.

## Undersider

- **Overblik** – nedtælling, status på budget/gæster/bordplan/tidsplan, næste opgaver og seneste noter
- **Budget** – ramme, hvad det koster, hvad der er betalt, buffer; donut over hvad der fylder mest; poster med pris, ✓ betalt, hvem ordner det, note; pris pr. gæst (👥) følger gæsteantallet
- **Gæster** – navn, side, relation, svar (ja/afventer/nej), barn, kost/allergi; filtre, søgning, "tilføj flere ad gangen"
- **Bordplan** – borde med antal pladser; placér gæster ved klik eller træk-og-slip; advarsel når et bord er overfyldt
- **Tidsplan** – opgaver med deadline og ansvarlig grupperet pr. måned ("9 mdr. før")
- **Program** – selve dagen time for time; punkter før kl. 06 regnes som natten efter og ligger sidst
- **Noter** – fritekstnoter med fastgørelse, forfatter og søgning

Alt gemmes automatisk; sletning kan fortrydes; JSON-eksport/-import; lys/mørk tema; fungerer på mobil.
