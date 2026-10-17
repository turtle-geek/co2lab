---
name: devpost
description: Write the hackathon Devpost submission and the GitHub README from the actual project, using a fixed template and a plain writing style that does not read as AI-generated. Use when the user says /devpost, asks for a Devpost writeup, a project submission, or a README for the hackathon repo.
---

# Devpost + README writer

Produce two files from the real project:

1. `DEVPOST.md`: the submission text, following [templates/devpost.md](templates/devpost.md). The user copies each section into Devpost's form.
2. `README.md`: the GitHub repository README, following [templates/README.md](templates/README.md).

Read [references/examples.md](references/examples.md) once before writing. It holds past submissions the user likes. Match their tone: plain, direct, specific, "we" voice.

## Step 1: Gather facts. Never invent them.

Read, in this order:

1. `SPEC.md` and `CLAUDE.md` if they exist.
2. The code: `package.json`, `requirements.txt`, `pyproject.toml`, `docker-compose.yml`, `.env.example`, and the main source folders. Build the tech stack list from what is actually installed and used.
3. `git log --oneline` for what was built and in what order.
4. API routes, if the project has a backend.

Then ask the user, in one message, for anything you cannot find. Typical gaps:

- The real inspiration story (a moment, a person, a frustration)
- Hardest problems they hit and how they fixed them, with numbers if they have them
- Demo video link, live site link, Devpost link, team names and GitHub handles
- Hackathon name and year

Do not fill gaps with made-up stories, metrics, users, or results. If something is unknown and the user skips it, leave a visible `{TODO: ...}` placeholder.

## Step 2: Write in this style

These rules apply to every sentence in both files.

**Punctuation**
- No em dashes (—) or en dashes (–) used as dashes. Use a period or a comma instead.
- No semicolons. Write two sentences.
- No emojis in headings or body text.

**Length**
- Sentences: aim for 15 words, never over 25.
- Paragraphs: 3 sentences max.
- Each Devpost section: about 50 to 150 words. The whole Devpost: under 800 words.
- If a sentence needs "and" twice, split it.

**Words**
- Use plain words: use (not leverage or utilize), help (not empower or facilitate), build (not craft), show (not showcase), start (not embark).
- Banned words and phrases: seamless, seamlessly, robust, cutting-edge, state-of-the-art, revolutionize, revolutionary, game-changer, game-changing, transformative, delve, harness, unleash, unlock, elevate, empower, supercharge, streamline, effortless, intuitive, innovative, next-generation, powerful, landscape, realm, tapestry, synergy, paradigm, holistic, journey, "in today's world", "in an era of", "not just X, but Y", "whether you're X or Y", "at its core", "it's worth noting", "plays a crucial role", "a testament to".
- No hype. Replace adjectives with facts: "handles 5,000 agents per tick" instead of "highly scalable".

**Voice**
- "We" for the team. Active voice: "We cache the results", not "Results are cached".
- Name the actual thing: the library, the model, the endpoint, the number.
- Explain each technology by what it does in this project, not what it is in general.
- No intro or outro filler such as "In conclusion" or "Overall".
- No groups of three adjectives ("fast, simple, and powerful").

**Formatting**
- Short bullet points are fine and often better than paragraphs for features, accomplishments, lessons, and next steps.
- Bold the feature name at the start of a bullet, then a colon, then one sentence.
- Keep the template's headings exactly. Devpost uses those section names.

## Step 3: Write the files

- Write `DEVPOST.md` and `README.md` in the project root. If a README already exists with real setup instructions, keep its correct commands and rewrite the rest to the template.
- The README setup steps must be commands that actually work for this repo. Check script names in `package.json` and file paths before writing them.
- Fill "Built With" from the real dependencies, using the names Devpost tags use (for example `next.js`, `fastapi`, `postgresql`, `openai`).

## Step 4: Check before showing the user

Run the checker on both files (use `python` on Windows, `python3` elsewhere):

```bash
python .claude/skills/devpost/scripts/check_writing.py DEVPOST.md README.md
```

It flags dashes, semicolons, banned words, long sentences, long paragraphs, and leftover `{TODO}` placeholders. Fix every flag in prose. Flags inside code blocks are ignored by the checker. Re-run until it passes, except for TODOs the user still needs to fill.

Then reread the Devpost once as a judge with 2 minutes per project: is the problem clear in the first 2 sentences, and is the demo-worthy feature obvious? Fix that if not.

## Step 5: Hand off

Tell the user:

- Which `{TODO}` items still need their input.
- That each `##` section in `DEVPOST.md` maps to one Devpost form field, and "Built With" goes in the tags field.
