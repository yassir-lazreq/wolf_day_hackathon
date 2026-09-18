# Track B: Damage intelligence for a German dealership group

*Participant hand-out.*

## The situation

A German car dealership group processes thousands of service and damage cases. Each case is a ticket: car information plus free-text notes written in German by service staff. The notes are unstructured and messy. The data is anonymized (names, phone numbers and addresses are fake), but the German text is real. Keep it in German; translating it is not the task.

You get:

- About 1,000 unique service and damage cases with full car information. See DATASET.md.
- An MUI-based front end skeleton to build into. See frontend/.
- A reference demo of a finished customer-facing status page, including a 3D car viewer. See reference-demo/.
- A DeepSeek API key (shared).
- A dedicated GPU pod on request (RTX PRO 6000, 96 GB VRAM), available 13:00 to 17:00. Ask an organizer. H100s are possible if you can justify the need.

## Your job

Do both parts.

1. Visualize the car and its damage. From the free-text German notes, produce a structured, realistic visualization of each car showing the damage area and the car's status. Stretch goal: infer which parts need replacing. Damage on the bumper area should highlight the entire bumper as a replacement part. The more realistic the car model, the better.
2. Analyze the corpus. 1,000 cases is a dataset. What patterns are in there? Case types, damage distributions, anything the dealership should know about its own operations.

A single prompt that draws a car is not a solution. The challenge is structure extraction from messy German free text, mapped reliably onto a visual model, at scale.

## Logistics

- GPU pods: 13:00 to 17:00, one per participant on request.
- Finals: a 10-minute one-on-one fireside chat with a reviewer, starting 17:30. Not a pitch. Sit down and talk through your approach technically.
