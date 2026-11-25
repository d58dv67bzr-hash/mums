# Mums

Mums är en mobilanpassad webbapp för att bevaka favoritmaträtter på lunchrestauranger i Jönköping och Huskvarna. Den här versionen använder märkta exempelmenyer med påhittade restauranger och adresser. Favoriter sparas i webbläsaren.

## Utveckla lokalt

Använd Node.js 22.12 eller senare i 22-serien, eller Node.js 24.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Produktionsbygget hamnar i `dist/`. Använd förhandsvisningen för att prova PWA och offlineläge på localhost. Ladda sidan online en gång så att service workern kan spara appen och exempelmenyn lokalt.

## Publicera på Vercel

Importera GitHub-repot i Vercel och välj Vite och Node.js 24. `vercel.json` anger installation, byggkommando och utdatakatalog. Projektet använder en statisk publicering och kräver inga miljövariabler, konton i appen eller externa betaltjänster.

På iPhone öppnar du den publicerade adressen i Safari och väljer **Dela → Lägg till på hemskärmen**. Publicering över HTTPS behövs för service workern.

## Data och integrationer

- `src/domain.ts` innehåller modeller för restauranger, menykällor, veckomenyer, maträtter, favoriter, matchningar och notifikationer.
- Menyinsamling använder gränssnittet `MenuCollector`. Manuell skanning hämtar den aktuella veckans exempelmenyer.
- `matchMenus` använder textmatchning i rättens namn och menytext. En alternativ `DishMatcher` kan hantera synonymer.
- `NotificationSender` är ett gränssnitt för framtida leverans. Pushnotiser och automatisk insamling från restauranger är markerade som otillgängliga i appen.
- Priset kommer från menyposten. Poster utan pris visar **Pris saknas**.

## Skärmbilder

[Start](docs/skarmbilder/start.png) · [Vecka](docs/skarmbilder/vecka.png) · [Favoriter](docs/skarmbilder/favoriter.png) · [Inställningar](docs/skarmbilder/installningar.png)
