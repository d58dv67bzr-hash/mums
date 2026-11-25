# Mums

Mums bevakar favoritmaträtter på lunchrestauranger i Jönköping och Huskvarna. Favoriter sparas i webbläsaren. Normalläget visar endast verifierade menyer för aktuell ISO-vecka. Öppna `/?demo=1` för märkta exempelmenyer och en separat uppsättning lokala favoriter.

## Utveckla och testa

Använd Node.js 22.12 eller senare i 22-serien, eller Node.js 24. Installera Popplers `pdftotext` för PDF-skanning och PDF-testet, till exempel med `sudo apt-get install poppler-utils` på Ubuntu.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Produktionsbygget hamnar i `dist/`. På iPhone kan en HTTPS-publicerad version läggas till som webbapp via Safaris delningsmeny. Projektet har kvar Vite-inställningarna för en framtida Vercel-publicering. Det kräver inga miljövariabler för att bygga.

## Restaurangkällor

[Restaurangregistret](data/restaurants.json) innehåller 19 granskningsposter. Vid kontrollen den 25 november 2026 blockerade molnmiljön de testade anropen till söktjänsten och de tänkta webbplatserna för HV71 och Huskvarna Stadshotell. Övriga poster väntar på kartläggning. **0 originalmenyer verifierades och 0 restaurangintegrationer är aktiverade.** Inga adresser eller menylänkar har fyllts i utan en verifierbar förstahandskälla.

Varje filial registreras med eget ID, verifierat namn, adress, område, direktlänk till originalmenyn, meny- och prisformat, status och datum för senaste verifiering. Spara dokumentation om webbplatsens villkor och robots.txt i `review` före godkännande. Källor med oklar åtkomst ska ligga kvar för manuell granskning. Lokallunch och Tuggkoll är spärrade. Eventuellt klartecken från källägaren behöver granskas innan någon sådan spärr ändras.

## Skanna menyer

`npm run scan` kör serverprocessen och skriver `public/menydata.json`. Normalläget läser filen och uppdateringsknappen hämtar den senaste tillgängliga versionen. En manuell serverskanning startas från kommandoraden eller via **Run workflow** i GitHub Actions.

- HTML kräver en kontrollerad selektor som avgränsar exakt en menyregion. PDF kräver en direktlänk till en textbaserad PDF. Bildmenyer, Javascript-renderade menyer, omdirigeringar och svårtolkad layout behöver särskild källanpassning.
- Parsern stöder veckorubriker som `Vecka 48 2026`, ISO-datum och svenska veckodagar, samt datum som `25/11` när året har förankrats. Rätterna behöver ligga på egna rader under dagsrubriker. Utan daterade belägg för målveckan avvisas menyn.
- Priser med valuta räknas endast från menyn. `Lunchpris` före dagsrubriker gäller menyn, under en dagsrubrik gäller det dagen. Motstridiga priser lämnas tomma och visas som **Pris saknas**.
- Skannern läser robots.txt vid varje körning och hoppar över källan vid osäker åtkomst eller ett crawl-delay som kräver anpassning. En tidigare hämtning kan användas i högst 48 timmar inom samma vecka vid tillfälliga fel i själva menyhämtningen. Föregående kontrolltid bevaras och appen markerar varje återanvänd träff.
- Matchningen använder normalisering, svenska böjningsformer och konfigurerbara synonymgrupper i `src/matching.ts`. Veganska och vegetariska köttbullar kräver ett uttryckligt favoritval eller synonymstöd.

GitHub Actions är förberett för vardagar kl. 07.00 och 10.00 svensk tid. Två UTC-scheman täcker svensk normaltid och sommartid, och körningen väljer rätt schema med `Europe/Stockholm`. Schemat fungerar när arbetsflödet ligger på standardbranchen. Manuella körningar förutsätter att GitHub känner till arbetsflödet på standardbranchen och att vald branch tillåter att arbetsflödet sparar JSON. Ingen publicering sker i arbetsflödet.

## Skärmbilder från grundversionen

[Start](docs/skarmbilder/start.png) · [Vecka](docs/skarmbilder/vecka.png) · [Favoriter](docs/skarmbilder/favoriter.png) · [Inställningar](docs/skarmbilder/installningar.png)
