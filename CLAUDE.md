# femtepunkt

**Les PLAN.md fyrst.** Heile spesifikasjonen (matematikk, datamodell, gestkart, milepælar, testliste) ligg der; denne fila er berre peikaren.

Arbeidsreglar (frå PLAN.md §10):

- arbeid milepæl for milepæl; kvar milepæl = eigen commit med grøn `pnpm test` og `pnpm check`
- `src/lib/perspective/projection.ts` og `sample.ts` er reine ts utan importar; ui-komponentar inneheld ikkje matte
- ingen three.js, ingen tilstandsbibliotek; svelte 5 runes held
- inkje synleg krom: ingen knappar, panel eller slidere utover Hud/Sheet (§4, §6)
- ikkje legg til funksjonar utanfor milepælen utan å spørje

Kommandoar: `pnpm dev` / `pnpm test` / `pnpm check` / `pnpm build`.
