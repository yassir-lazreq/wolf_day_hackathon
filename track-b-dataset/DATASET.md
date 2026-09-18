# Wolf Day track B dataset

1,000 dealer workshop cases from a German car dealership group. Each case is one workshop file: vehicle and contact data, workshop statuses, orders, planned workshop tasks, and a German free-text note written the way service staff write it.

The files are in `kit/dataset/`:

| File | What it is |
| --- | --- |
| `da-cases.json` | The 1,000 cases as an array of nested objects. The full structure. |
| `da-cases.csv` | The same cases, one flat row each. Lists are joined with `|`. |
| `schema.json` | Field by field documentation, machine readable. |
| `states.json` | The workshop status vocabulary: 213 statuses in 8 categories. |

Everything is UTF-8. The notes are German and stay German. Translating them costs you information and is not part of the task.

## What this data is

The data is synthetic. It was generated, it mirrors the structure of a production DA workshop planning system, and no value in it comes from a real case. Names, addresses, phone numbers, plates, VINs, order numbers and ids are invented. Plate district codes and VIN manufacturer prefixes were chosen so they can never collide with a real registration or a real vehicle.

What is real is the shape: field names, nesting, id and timestamp formats, and the status vocabulary of the live system, filtered down to process statuses. So anything you build against this data keeps working against the production export.

## How to read a case

A case is one dossier. `id` is the case key. The parts you will spend your time on:

1. `freitext` is the note as plain text, paragraphs separated by newlines. This is the field the challenge works on.
2. `note` is the same note as the source system stores it: HTML paragraphs, some carrying a dated author prefix. Strip it if you prefer, or parse it for the dated history lines.
3. `states` are the current statuses of the case, resolved inline with id, name, category and `is_done`. The first entry is the general case status. Status names carry emoji, exactly like the live system.
4. `orders` and `workshop_tasks` are the commercial and the planning side of the same case.
5. `ground_truth` holds the labels behind the generated note: case type, case kind, damage zones, severity, insurance type, lifecycle stage. It is there so you can score your extraction. Reading it instead of the free text defeats the exercise.

Field level documentation is in `schema.json`. The CSV carries the same fields flattened, plus `gt_` columns for the ground truth. `freitext` can contain newlines, so read the CSV with a real CSV parser rather than by splitting on lines.

## Case mix

550 routine service cases (55.0 percent) and 450 cases with damage content (45.0 percent).

| Case kind | Cases | Share |
| --- | --- | --- |
| Inspektion | 144 | 14.4 % |
| Parkschaden | 110 | 11.0 % |
| Räder und Reifen | 107 | 10.7 % |
| Bremsen | 103 | 10.3 % |
| HU/AU | 101 | 10.1 % |
| Ölwechsel | 95 | 9.5 % |
| Rangierschaden | 76 | 7.6 % |
| Auffahrunfall | 62 | 6.2 % |
| Hagelschaden | 55 | 5.5 % |
| Steinschlag | 55 | 5.5 % |
| Vandalismus | 48 | 4.8 % |
| Wildunfall | 44 | 4.4 % |

Damage cases name concrete vehicle zones: bumpers front and rear with side, wings, doors, sills, mirrors, bonnet, tailgate, roof, windscreen. 785 zone mentions over 450 damage cases, 254 of those cases name more than one zone. Severity splits into 164 light, 183 medium, 103 heavy.

Insurance context on damage cases: 140 Teilkasko, 112 self payer, 80 Vollkasko, 75 third party liability, 43 steered by a claim handler.

Other numbers worth knowing before you start: 668 cases are still on the open worklist, 44 are cancelled, 1,167 orders and 1,767 workshop tasks are attached across the corpus, 212 of the 213 statuses are in use. 210 contacts have no email address and 388 have no salutation, which is what the source system looks like in practice.

## The notes

1,000 distinct note texts, around 300 characters each. They are built from workshop phrasing: abbreviations such as KVA, KV, HU, TÜV, TK, VK, SB, Fzg., KD, dated follow-up lines appended by different roles, and the occasional typo. A damage note always names the zone that the structured labels record, but it names it in running prose, in varying word order, and often together with a second zone, a customer request and an insurance sentence.

The vocabulary is small enough to enumerate. The phrasing around it varies from case to case, and that is where the work is.

## Regenerating

The dataset was produced by `generate-da-dataset.py` with a fixed seed. Same seed and count produce byte identical files. You do not need the generator to work on the challenge.
