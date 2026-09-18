# Track B Solution — Damage Intelligence (UIC DAIL Hackathon)

Deutsche Werkstatt-Freitexte → validierte, strukturierte Schadensinformation → deterministische 3D-Visualisierung + operative Korpus-Analytik.

## 1. Architektur

```
track-b-dataset/kit/dataset/da-cases.json      (raw, read-only)
        │
        ▼
solution/  (Node ≥ 22, TypeScript, keine Build-Stufe)
  ├── src/domain/        kanonisches Domänenmodell (22 Zonen, Enums, Glossar,
  │                      Status→Lifecycle-Regeln) — Single Source of Truth
  ├── src/extraction/    Baseline (deterministisch), DeepSeek-Client,
  │                      Zod-Schema, Reconciliation/Business-Rules, Pipeline
  ├── src/worker/        Batch-Worker mit Checkpointing (batch.ts)
  ├── src/eval/          Metriken + Evaluation (Ground Truth NUR hier)
  ├── src/analytics/     deterministische Aggregation + Insights
  └── src/glb/           GLB-Inspektion, Segmentierungs-Coverage-Report
        │  schreibt
        ▼
track-b/frontend/public/data/*.json            (generierte Artefakte)
        ▼
track-b/frontend  (Next.js 15 + MUI 7)
  ├── /dashboard                  Übersicht: KPIs, Verteilungen, Insights
  ├── /dashboard/cases            DataGrid über alle 1.000 Vorgänge
  ├── /dashboard/cases/[id]       Detail: Originaltext, Evidenzen, 3D-Viewer,
  │                               Ersatzteil-Inferenz, verbundene intakte Teile
  └── /dashboard/evaluation       Metriken vs Ground Truth + Fehlerfälle
```

**Prinzipien:** Ground Truth fließt nie in die Inferenz. Der LLM liefert eine semantische Interpretation (validiert per Zod + Business-Rules), nie UI-Daten, nie 3D-Steuerung, nie Statistiken. Alle Zahlen der Analytics-Seiten sind deterministisch berechnet.

## 2. Setup

```bash
# Worker/Evaluation (Node >= 22, läuft ohne Build über natives TS-Stripping)
cd solution
npm install
copy .env.example .env   # DEEPSEEK_API_KEY eintragen (nie committen)

# Frontend
cd ../track-b/frontend
npm install             # oder yarn
npm run dev             # http://localhost:8083
```

## 3. Environment-Variablen (server-only, `solution/.env`)

| Variable | Default | Bedeutung |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | Pflicht. Wird nie an den Browser gegeben. |
| `DEEPSEEK_MODEL` | `deepseek-flash` | `deepseek-flash` (gewählt: 5s/Call, bessere Schweregrad-Treffer im Duell) oder `deepseek-v4-pro` |
| `DEEPSEEK_MAX_CONCURRENCY` | 8 | begrenzte Parallelität im Batch |
| `DEEPSEEK_TIMEOUT_MS` | 90000 | Request-Timeout |
| `DEEPSEEK_MAX_RETRIES` | 4 | Retries mit exponentieller Wartezeit (429/5xx) |
| `BATCH_LIMIT` | — | optionaler Smoke-Test-Limit |
| `BATCH_RESUME` | 1 | Checkpoint fortsetzen |

Frontend-Variablen (`NEXT_PUBLIC_*`) sind optional; die App lädt ihre Daten statisch aus `public/data/`.

## 4. Daten

Rohdaten: `track-b-dataset/kit/dataset/da-cases.json` (1.000 Fälle, unverändert, read-only).
Verarbeitete Ergebnisse: `solution/data/processed/results.jsonl` (+ `checkpoint.json`).
Evaluation: `solution/data/evaluation/*.json`.
Frontend-Artefakte (generiert): `track-b/frontend/public/data/*.json`.

## 5. Extraktions-Pipeline

```
freitext (Deutsch, unverändert)
  → Preprocessing (Normalisierung)
  → deterministische Hints (Glossar: Zonen-Aliase, Kinds, Versicherung, Schweregrad)
  → DeepSeek strukturierte Extraktion (JSON-Modus, Temperatur 0)
  → Zod-Validierung (Schema + kanonische Enums) + Korrektur-Retry
  → Reconciliation: Label→ZoneId, Duplikat-Merge, Evidenz-Pflicht,
    deterministische Schweregrad-Overrides, Ersatzteil-Regeln
  → ExtractionResult (persistiert, mit Warnungen + LLM-Fehler)
```

- **Baseline**: reines Wörterbuch/Regex (untere Schranke + Fallback bei API-Ausfall).
- **Hybrid**: LLM-Interpretation + deterministische Post-Processing; unbekannte Felder werden aus Hints gefüllt (`hybridFilled`).
- `lifecycleStage` kommt deterministisch aus dem ersten Status (`domain/status.ts`) — nie vom LLM.

## 6. Batch-Verarbeitung

```bash
node src/worker/batch.ts
```

- Checkpoint `data/processed/checkpoint.json` (PENDING/PROCESSING/COMPLETED/FAILED), alle 25 Fälle geflusht, restartbar (`BATCH_RESUME=1`).
- Begrenzte Konkurrenz, Timeouts, Retries mit Backoff, 429/5xx-Handling.
- Fehlgeschlagene Fälle bleiben sichtbar (Checkpoint + Ergebniszeile mit `llmError`); laufen bei Batch-Neustart erneut.
- Ergebnis: `results.jsonl` (eine Zeile je Fall, idempotent dedupliziert beim Konsolidieren).

Laufzeit gemessen: 1.000 Fälle in ~480 s (≈2.1 Fälle/s bei Konkurrenz 10, 0 Ausfälle).

## 7. Evaluation

```bash
node src/eval/run-eval.ts       # Metriken über alle verarbeiteten Fälle
node src/eval/model-duel.ts     # Modellvergleich auf kleinem Dev-Set
```

Metriken: caseType/caseKind-Genauigkeit, Zonen-Präzision/Recall/F1, exakter Mehrzonen-Match, Schweregrad-Genauigkeit, False-Positive/Missed-Zones, Versicherungs- und Lifecycle-Genauigkeit. Ground Truth wird ausschließlich hier gelesen.

## 8. 3D-Mapping

Das bereitgestellte GLB (Tripo) ist **ein einziges Mesh ohne Teilehierarchie** — es gibt keine Mesh-Namen, auf die man Zonen mappen könnte. Daher:

1. Das Mesh wird wie im Referenz-Viewer normalisiert (+X = Front, Länge 4.3).
2. `zone-classifier.ts` klassifiziert jeden Vertex deterministisch anhand geometrischer Regionen (22 Zonen-Regeln + Radhaus-Ausschluss) — keine LLM-Beteiligung.
3. Der Viewer rendert ein Overlay aus klassifizierten Dreiecken in drei getrennten visuellen Zuständen: **beschädigt (rot)**, **Ersatzteil-Assembly (orange)**, **verbundene intakte Teile (gelb)**.
4. Stoßstangen-Logik: Seitenschaden → die gesamte Stoßstange wird als Ersatzteil-Assembly hervorgehoben.

Validierung: `node src/glb/coverage.ts <pfad-zu-car.glb>` — alle 22 Zonen haben Coverage auf dem echten Modell (≈60 % der Fläche klassifiziert; Rest = Glas/Unterboden/Räder, bewusst unklassifiziert).

## 9. Analytics

`node src/analytics/consolidate.ts` aggregiert ausschließlich strukturierte Daten und schreibt die Frontend-Artefakte: Falltypen, Kinds, Zonen-, Schweregrad-, Versicherungs-, Lifecycle-Verteilungen, Top-Marken/Modelle, Zonen-Kombinationen, Status-Engpässe, Durchlaufzeiten (nur wo Timestamps vorliegen) und regelbasierte Insights mit numerischem Beleg.

## 10. Tests

```bash
cd solution
npm test        # node:test, 45 Tests
```

Domäne (Zonen-Normalisierung, Aliase, Positions-Parsing, Ersatzteil-Regeln, linkedZones, Duplikat-Merge), Baseline-Fixtures aus echten Korpusmustern, Validation malformierter LLM-Antworten, Reconciliation-Business-Rules, Metriken gegen händisch verifizierte Beispiele, 3D-Segmentierung (synthetische Geometrie, inkl. getrennter visueller Zustände für beschädigt/verbunden).

Frontend: `npm run lint`, `npx tsc --noEmit`, `npm run build` (alle grün; `eslint-import-resolver-typescript` auf 3.6.3 gepinnt, weil v4 auf dieser Maschine keine native Binding lädt).

## 11. Bekannte Einschränkungen

- **Ein Fahrzeugmodell für alle Fälle**: das mitgelieferte GLB ist ein generisches Modell; Zonen werden auf dessen Geometrie segmentiert, nicht auf markenspezifische Modelle.
- **Schweregrad**: Der Korpus enthält identische Formulierungen mit unterschiedlichen Labels (Synthese-Rauschen); 73,8 % ist die erreichte Genauigkeit nach deterministischen Overrides — der Rest ist teilweise nicht aus dem Text ableitbar.
- **Negative Erwähnungen** („Fahrertür ok“): Die Baseline listet die Zone als Hinweis; die Disambiguierung macht der LLM. Restfehler sichtbar auf der Evaluationsseite.
- **3D-Links/Rechts**: Das Tripo-Mesh ist asymmetrisch tesselliert (43/57); die Overlays sind auf der dichteren Seite detaillierter.
- **Lint-Infra**: `unrs-resolver` (native) lädt auf diesem Rechner nicht → v3.6.3-Pin (dokumentiert oben).

## 12. Demo

```bash
cd track-b/frontend && npm run dev    # http://localhost:8083
```

Empfohlener Ablauf: `/dashboard` (Korpus-Analytik) → `/dashboard/cases` (Filter „Schaden“, Suche nach „Vandalismus“) → Detailseite eines Mehrzonenschadens (Originaltext ↔ Evidenzen ↔ 3D) → `/dashboard/evaluation` (Metriken + Fehlerfälle).

## 13. Verworfene Ansätze

| Ansatz | Verworfen, weil |
|---|---|
| Ein Prompt „zeichnet das Auto“ | keine deterministische Zuordnung, nicht validierbar |
| LLM erzeugt Mesh-Namen/Teile | Mesh hat keine Teile; Halluzinationsfläche |
| LLM rechnet Korpus-Statistik | nicht reproduzierbar, kein numerischer Beleg |
| Mesh-Namen-Mapping | GLB enthält keine benannten Teile (verifiziert per GLB-Dump) |
| PostgreSQL/Airflow/K8s | kein Mehrwert bei 1.000 Fällen; JSON + Checkpoint ist einfacher, restartbar, demo-tauglich |
| `deepseek-v4-pro` für den Batch | 5× langsamer (25 s/Call) und im Dev-Duell schlechter beim Schweregrad |
