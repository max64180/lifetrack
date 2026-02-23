# Roadmap (LifeTrack)

Ultimo aggiornamento: 2026-02-23

## ✅ Fatto
- Sistema QA automatizzato: Unit + Component + E2E (Playwright), visual regression opzionale; esecuzione locale e in GitHub Actions prima del deploy.
- QA CI stabilizzata su path Drive: cache/build su `/tmp`, test unit in build con `--no-cache`.
- E2E in CI separati in `required` + `nonblocking` per evitare blocchi su test flaky e mantenere copertura.
- Setup dual-release: baseline MVP congelata con tag `mvp-freeze-2026-02-13`, branch `next` dedicato alla nuova UX, QA attivo su entrambi i branch.
- Semplificazione card budget: focus sul totale, separazione totale vs urgenti, o hint della categoria dominante.
- UX filtri: rendere evidenti i filtri attivi e aggiungere “Reset filtri”.
- Registro manutenzione asset: storico interventi + prossima scadenza che può creare una deadline.
- Vista Anno aggregata per Scadute/Completate.

## Backlog (Tecnico/Architettura)
- P0: Migrazione allegati da base64 a Firebase Storage + backfill/layer di compatibilità. (Requested)
- P1: Prossimi passi QA: 2–3 E2E “happy path”, snapshot visivi Playwright, seeding dati/fixtures. (Requested)
- P1: Rafforzare suite QA: più casi, più copertura E2E, visual regression. (Requested)
- P1: Stabilizzare test E2E `asset add-work modal` (oggi `@nonblocking`) e riportarlo in `required` quando deterministicità è garantita. (Requested)
- P2: Pulizia warning test (`act(...)` in `PriorityFilter.test.jsx`) per log QA puliti e meno rumore. (Requested)
- P1: Definire come testare il rinnovo automatico delle ricorrenze (time‑shift / clock control). (Requested)
- P1: Pubblicazione iOS/Android (Capacitor) + checklist store. (Requested)
- P1: Migliorare efficienza Firestore: delta sync, bottone sync manuale, polling ridotto, soft-delete. (Requested)
- P2: Ottimizzazione costi Firebase (ridurre reads/writes, cache, tuning polling). (Requested)
- P2: Decisione strategia monetizzazione (pricing, paywall, billing, compliance). (Requested)
- P2: Abilitare Firebase Analytics (decisione pending). (Requested)
- P1: Introdurre SonarQube Community Build (free) con KPI static analysis e Quality Gate in CI; setup iniziale su `main`, `next` usato per esperimenti futuri. (Requested)

## Backlog (Prodotto/Funzionale)
- P0: Scadenze documenti: tipi (ID, patente, assicurazione, passaporto), date scadenza, finestre rinnovo, reminder/deadline opzionali. (Requested)
- P1: Export PDF: lista scadenze dettagliata (overview/export). (Requested)
- P1: Ricerca testo libero nella schermata principale (titolo, note, asset, categoria). (Requested)
- P1: Pet: eventi futuri globali + eventi/scadenze modificabili. (Requested)
- P1: Navigazione anno: evitare anni vuoti (min/max). (Requested)
- P1: Flusso “Non dovuta” per ricorrenze (budget 0 + label + conferma). (Requested)
- P1: Allegati visibili per scadenze create da worklog. (Requested)
- P1: Rivedere soluzione filtri (floating button vs inline) per ridurre rumore e garantire accessibilità. (Requested)
- P1: Refactor UX pagina “Nuova scadenza” (wizard): riprogettare step Ricorrenza in stile blocchi, correggere usabilità campo data e semplificare gerarchia visuale mobile. (Requested)
- P1: Wizard Nuova scadenza (ricorrenti): revisione completa UX mobile dello step Ricorrenza (layout, gerarchie, campo data, coerenza controlli) mantenendo flusso veloce. (Requested)
- P2: Gestione “Spese superflue” (etichette/filtri/impatto budget). (Requested)
- P2: Suggerimento intelligente per attivare filtro “❔ Da stimare” quando mancano stime. (Requested)
