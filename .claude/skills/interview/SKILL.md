---
name: interview
description: Interview the user about their project idea until every decision and edge case is pinned down, then write SPEC.md. Use at the start of a project, or when the user says /interview, "interview me", or "help me spec this out".
---

# Interview → SPEC.md

Your job is to pull the complete project out of the user's head before any production code is written. Agents that build from a vague idea drift; agents that build from a precise spec do not.

## How to interview

1. Ask the user to describe the idea in their own words (voice dictation is fine — expect rambling, extract the substance).
2. Ask questions **one or two at a time**, using the AskUserQuestion tool when the answer is a choice between options. Never dump a list of 15 questions.
3. Be relentless. Do not accept vague answers like "it should look nice" or "users can log in" — ask what exactly, how, and what happens when it fails.
4. Cover every area below. Skip an area only when it truly does not apply, and say so.
5. When the user does not know, offer a concrete recommendation with a one-line reason, and let them accept or change it.
6. Stop when there are no unresolved decisions left, or the user says they are done.

## Areas to cover

- **Demo moment**: What is the 60-second live demo that makes judges say "wow"? Work backward from it. What must work flawlessly for that demo?
- **Users & problem**: Who uses it, what pain it solves, why existing tools do not.
- **Core features**: The minimum feature set for the demo. Separate must-have from nice-to-have.
- **User flows**: Step by step, screen by screen, for each core feature.
- **Edge cases**: Empty states, errors, loading, bad input, no network, API rate limits.
- **Tech stack**: Frontend, backend, database, auth, hosting, AI/ML APIs, hardware. Prefer what the team already knows.
- **Data model**: Entities, fields, relationships.
- **External services & keys**: Every API/service needed and whether the team has access.
- **UI direction**: Visual style, references, key screens.
- **Team & time**: Who builds what, hackathon deadline, what can be cut if time runs out.
- **Parallel work**: Which pieces are independent enough to be built by separate agents at the same time.

## Output

Write `SPEC.md` in the project root with these sections:

1. One-line pitch
2. Demo script (the exact live demo, step by step)
3. Features (must-have / nice-to-have)
4. User flows
5. Tech stack and why
6. Data model
7. API / service list
8. Edge cases and how each is handled
9. UI direction
10. **Work breakdown**: independent tasks, each with a clear "done when" — sized so one agent session can build each in parallel without touching the others' files
11. Open questions (should be empty or near-empty)

Then show the user a short summary and ask if anything is wrong before they start building.
