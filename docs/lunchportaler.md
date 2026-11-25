# Lunchportaler

## Läget den 25 november 2026

En manuell åtkomstkontroll i prioritetsordningen nedan gav `403` från molnproxyn på CONNECT för alla åtta adresser. Ingen HTTP-respons från portalernas servrar kunde läsas. Därför är presentationen av restauranger, adresser, menyer, datum, ordinarie priser, rätter, tillbehör och originallänkar fortfarande okänd. Detsamma gäller vanlig HTML, JSON, JSON-LD, dataflöden och Javascript-rendering. Inga layoutantaganden är registrerade som liveadaptrar.

| Portal | Exakt portalsida | Exakt robots-adress | Beslut |
|---|---|---|---|
| JKPG Lunch | <https://www.jkpglunch.se/> | <https://www.jkpglunch.se/robots.txt> | Väntar på kontroll av ursprung, villkor och struktur. |
| Lunchsidan | <https://www.lunchsidan.se/> | <https://www.lunchsidan.se/robots.txt> | Väntar på kontroll av ursprung, villkor och struktur. |
| Tuggkoll | <https://tuggkoll.se/jonkoping> | <https://tuggkoll.se/robots.txt> | Avstängd medan begränsningen för automatiserad insamling klarläggs. |
| Lokallunch | <https://lokallunch.se/jonkoping/> | <https://lokallunch.se/robots.txt> | Spärrad på grund av uttryckligt förbud enligt tidigare uppdragsunderlag. |

Fyra portaler undersöktes. Noll är verifierade, noll är aktiverade och noll fungerar live. Inga nya restauranger, maträtter eller favoritträffar har verifierats.

## Anslut en portal

1. Öppna portalsidan via en miljö med tillåten åtkomst. Läs villkoren och robots.txt. Ett officiellt API är inget krav. Dokumentera bedömningen i `data/lunch-portals.json`. Källor som blockerar automatisering ska förbli avstängda.
2. Kontrollera om restauranger, ort, adress, menyer, datum, ordinarie priser och restauranglänkar finns i HTML, JSON-LD eller ett publikt dataflöde. Identifiera en tillåten direktadress för den aktuella informationen. Bekräfta att veckan och alla serveringsdatum kan förankras i källan.
3. Lägg en källspecifik `PortalAdapter` i [scanner/portals.ts](../scanner/portals.ts) eller importera den där. En adapter får den granskade sidans innehåll, innehållstyp, URL och målvecka. Den returnerar identifierade restauranger och deras veckomenyer. Använd portalens egen stabila restaurangnyckel och uttrycklig ort. Ge varje rätt ett giltigt serveringsdatum och ett pris endast vid entydigt ordinarie lunchpris. Lämna okänd adress och okänt pris tomma. Ange restaurangens egen webbplats separat från portalens direktlänk.
4. Lägg till ett syntetiskt test av formatet. Kör källdiagnostiken mot den tillåtna adressen innan automatisk hämtning aktiveras. Registrera adaptern först när källans form och schema har verifierats. Spara varken kompletta sidkopior eller verkliga menyer i git.

Skannern söker portaler först och kompletterar med restaurangernas egna verifierade menyer. Nätverksanrop går en i taget med minst 750 ms mellan anropsstarter i den normala skanningen. Identiska URL- och innehållsförfrågningar återanvänds inom körningen. Skannern följer inga omdirigeringar. Den hoppar över otillåtna sökvägar och lämnar källor med oklar robots-policy eller crawl-delay för manuell granskning. En portal som blir otillgänglig blockerar inte nästa. Vid tillfälligt fel kan en tidigare verifierad meny användas under samma vecka i upp till 48 timmar, efter en lyckad kontroll av robots.txt.

Endast uttryckligen angivna orter Jönköping och Huskvarna accepteras. Restauranger slås samman över källor först när normaliserat namn, ort och tillräckligt specifik gatuadress matchar. Rätter slås samman per restaurang, normaliserat rättnamn och datum. Varje rätt behåller sina källänkar och hämtningstider. Färska uppgifter väljs före återanvända för rättens text. Vid likvärdig aktualitet avgör portalregistret ordningen och restaurangens egen meny kompletterar. Motstridiga priser visas som **Pris saknas**.

## Källdiagnostik efter merge

När arbetsflödet finns på standardbranchen, öppna GitHub **Actions → Källdiagnostik → Run workflow**. Lokalt finns samma kontroll som `npm run diagnose`. Granskade källor kontrolleras för HTTP-status, innehållstyp och tecken på HTML-, JSON- eller annan menystruktur. Om en adapter är registrerad redovisas antal restauranger och tolkade veckomenyer. För ännu ogranskade portaler granskas endast robots.txt. Blockerade källor hoppas över helt. Diagnostiken skriver status och antal, aldrig svarskroppar, menyer eller adresser till restauranger. En körning utanför Codex får fortfarande inte gå runt portalens egna begränsningar.

## Privat lagring och publicering

Menyskanningen körs i Actions först när GitHub-repot är privat. Den sparar `privat-menydata` som en åtkomstbegränsad Actions-artefakt med sju dagars retention. Den senaste tillgängliga artefakten för samma branch ger underlag för kortvarig återanvändning. Privata skanningsresultat ska inte behållas i repot om dess synlighet ändras tillbaka till offentlig. Ändra aldrig synligheten till offentlig innan privata artefakter har rensats.

För lokal visning kan projektägaren ladda ned artefakten från en privat körning till `.mums/` och starta Vite på loopback med `MUMS_LOCAL_DATA=1`. Endpointen skickar `Cache-Control: private, no-store`. Den statiska produktionsbuilden innehåller bara en tom menyfil med ofarliga registerstatusar.

Vid en framtida Vercel-publicering behöver varje produktions- och förhandsvisningsadress samt meny-API skyddas. Använd Vercels åtkomstskydd där planen täcker alla berörda adresser, eller inför sessionsbaserad autentisering med användaren uttryckligen godkänd. Låt en autentiserad serverfunktion läsa resultatet från privat lagring med en serverhemlighet och svara med `Cache-Control: private, no-store`. Lägg varken filen, tokens eller menykopior i statiska byggfiler, service workerns cacher eller publika artefakter. Kontrollera att obehöriga anrop till appen och den direkta meny-URL:en blockeras innan en webbadress delas. Inga Vercel-inställningar har aktiverats i uppdraget.
