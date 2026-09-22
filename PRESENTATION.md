# Track B — Damage Intelligence: 10-Minute Fireside Presentation

> Live app: **http://localhost:8083/dashboard** · Pipeline docs: `solution/README.md`

---

## Slide 1 — The problem

A German dealership group runs ~1,000 workshop cases. Each case = a car + a **free-text German note** written by service staff — messy, inconsistent, full of shorthand:

> *"Kunde meldet: Vandalismus. Kotflügel hinten rechts: Kratzer im Klarlack, ca. 5 cm. Fahrertür ebenfalls: feine Kratzspuren. Vollkasko, SB 500 EUR."*

**Task:** turn this into structured damage intelligence, visualize it on a 3D car, and mine the corpus for operational insights.

**Constraint that shaped everything:** *"A single prompt that draws a car is not a solution."*

---

## Slide 2 — The pipeline

```
German note (untranslated)
   ↓ 1. EXTRACT     deterministic hints + DeepSeek (JSON mode)
   ↓ 2. VALIDATE    Zod schema → canonical enums → business rules → deterministic overrides
   ↓ 3. VISUALIZE   ZoneId → real 3D meshes → solid emissive material override
   ↓ 4. ANALYZE     deterministic aggregation → charts + insights (LLM never does statistics)
```

**Three principles to state loudly:**
1. The LLM only interprets text — it never touches geometry, statistics, replacement decisions, or linkedZones.
2. Ground truth is used **only** for scoring — never in inference.
3. German stays German; evidence quotes are verbatim.

---

## Slide 3 — Extraction: hybrid, not a prompt

- **Baseline first:** dictionary/regex over workshop vocabulary (22 zones, abbreviations, insurance phrasing) — works with zero AI.
- **DeepSeek second:** structured JSON output, `deepseek-flash` (chosen by model duel: 5 s/call and better severity than v4-pro), temperature 0.
- **Reconciliation last:** every zone must be canonical; every damage must carry a verbatim German evidence quote; deterministic overrides fix unambiguous signals (`"Träger verformt"` → always *schwer*).
- Batch: **1,000 cases in ~8 min**, checkpointed, resumable, 0 failures, failed cases visible.

---

## Slide 4 — Live demo: analytics

Open **/dashboard**

- KPIs: 1,000 cases · 550 service / 450 damage · 668 open · 254 multi-zone damage
- Charts: order types, damage zones, severity, insurance, lifecycle, top makes, open-cases-by-status bottlenecks
- Insights, each with numeric evidence:
  > "56.4% of damage cases involve more than one zone — 254 of 450."
- Every number is traceable to computed aggregations — never an LLM summary.

---

## Slide 5 — Live demo: case + 3D

Open **/dashboard/cases/898942** (Vandalismus: front-left door + rear bumper)

- Original German note (unchanged) → structured extraction with evidence & confidence
- **3D viewer:** orbit with mouse
  - 🟥 Red = damaged (door, bumper)
  - 🟧 Orange = inferred replacement assembly (full bumper ← bumper-side rule)
  - 🟨 Yellow = linked intact parts (static `LINKED_ZONES` table: fender, sill, mirror…)
  - Click a part → raycast on the real mesh selects the zone
- Windows/wheels/trim can **never** highlight — they're a separate "rest" mesh

**The 3D story:** the provided GLB is ONE unnamed merged mesh (no door/bumper parts exist). We deterministically partition the real geometry into 22 zone meshes at load time. No brush, no canvas overlay, no AI in the render path.

---

## Slide 6 — Honesty: evaluation

Open **/dashboard/evaluation**

| Metric | Result |
|---|---|
| Case type | 99.9% |
| Zones (F1) | 99.9% (1 FP, 0 missed) |
| Lifecycle | 100% (deterministic from status) |
| Insurance | 99.2% |
| Severity | 73.8% (was 56.2% before deterministic overrides) |

Severity is the hard one **because the corpus labels are noisy** — the same sentence carries different labels. We show the failure cases openly rather than hiding them.

---

## Slide 7 — Engineering decisions to mention

- **No mesh names existed** → geometry partition instead of guessing names
- **flash over v4-pro** → measured: 5× faster, better severity on the dev duel
- **No database / no Docker / no GPU pod** → JSON files + checkpoint = simple, restartable, demoable
- **Severity fixed post-hoc without re-calling the LLM** → deterministic override pass over persisted results
- **English UI, German data** — deliberate

---

## Likely jury questions

| Question | Answer |
|---|---|
| "Did you cheat with ground truth?" | `ground_truth` appears only in `solution/src/eval/`. Grep it live. Errors prove honesty: a cheater scores 100%, we score 73.8% on severity. |
| "What if the API dies during the demo?" | Results are pre-computed JSON; the app needs no API at runtime. |
| "Why not mesh-name mapping?" | The GLB has 1 mesh, 1 node, no names — verify with `glb-mesh-dump.mjs`. |
| "How reproducible is the batch?" | Checkpoint file + resume + deterministic seed-independent IDs; re-running skips completed cases. |
| "Where's the API key?" | `solution/.env`, server-side only, never reaches the browser. |
| "What would you do with more time?" | Per-brand car models, stage-duration analytics from status history, held-out eval split, severity via few-shot tuning. |

---

## Demo cheat-sheet

```powershell
# start the app
cd track-b/frontend && npm run dev   # http://localhost:8083

# re-run the pipeline (only if needed)
cd solution
node src/worker/batch.ts             # extraction (resumes)
node src/eval/run-eval.ts            # metrics vs ground truth
node src/analytics/consolidate.ts    # regenerate frontend data
npm test                             # 51 tests
```

**Order of the demo:** Overview (analytics) → Cases → Case #898942 (3D) → Evaluation (honesty) → architecture talk.

