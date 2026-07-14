# Sven Westin

Statisk Astro-version av den gamla WordPress-bloggen.

## Kommandon

- `npm run import:wordpress` importerar publicerade blogginlägg och sidor från `svenwestin.wordpress.2026-07-14.xml`.
- `npm run dev` startar lokal utvecklingsserver.
- `npm run build` kontrollerar och bygger den statiska sajten till `dist/`.
- `npm run preview` visar den byggda sajten lokalt.

Importen skriver genererat innehåll till `src/content/blog/` och `src/content/pages/`, laddar ner hittade bilder till `public/media/imported/` och skapar `import-report.json`.
