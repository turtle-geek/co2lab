---
name: ste
description: Rewrite prose (docs, READMEs, PR descriptions, error messages, release notes, comments, never code) into clear technical language based on ASD-STE100 Simplified Technical English, to remove "AI slop". Use when asked to make writing not sound like AI, make docs clear or plain, enforce a controlled writing style, or write technical documentation that reads human. Two modes, strict for procedures and safety, and STE-flavored for general prose.
---

# technical-language

Write prose in clear technical language, based on ASD-STE100 Simplified Technical English (STE). This applies to documentation, READMEs, pull-request text, error messages, release notes, and comments. It does not apply to code, identifiers, or command syntax. It is not for marketing copy, essays, or anything that needs a voice. STE strips voice on purpose.

## Rules

WORDS
- Use one name for one thing. Do not call the same item by two different names.
- Use the short common word: start (not begin/commence/initiate), use (not utilize/leverage), help (not facilitate), make sure (not ensure), before (not prior to), after (not subsequent to), about (not regarding/concerning), get (not obtain/acquire), show (not demonstrate), also (not additionally/furthermore/moreover).
- Give each word one meaning. "fall" means to move down, not to decrease.
- No marketing adjectives: seamless, robust, powerful, cutting-edge, effortless, world-class, next-generation, revolutionary.
- No hollow intensifiers: genuine, genuinely, truly, "worth noting", "worth a look", "to be honest". State the fact.
- American spelling.

VERBS
- Active voice. "the parser reads the file", not "the file is read by the parser".
- Use a verb for an action. "analyze the log", not "perform an analysis of the log".
- No stacked auxiliaries. Not "it is important to note that this may help to improve". Write "this improves X".
- No "-ing" main verb where a simple tense works.

SENTENCES
- One instruction per sentence. Max 20 words (instruction), max 25 (descriptive).
- No contractions. Use articles: a, an, the, this, these.
- No "not X, it is Y" pivot. Do not write "This is not about speed, it is about safety". State the point directly: "This is about safety". This includes the split form across two sentences ("The point is not speed. The point is safety.").

PUNCTUATION
- No semicolons. Write two sentences.
- No em dash. Rewrite it into a comma, a period, or two sentences. (STE itself permits the em dash. This skill removes it because it is a common slop marker.)

STRUCTURE
- One topic per paragraph, max six sentences. For steps, use a numbered vertical list, one action per item, imperative form. Put a condition before its command.

Write only the requested text. No preamble, no summary, no closing remarks.

## Modes

- **strict**: procedures, runbooks, safety text, error messages: apply every rule and both length caps.
- **STE-flavored**: general prose (READMEs, PR descriptions, docs): apply the sentence, paragraph, active-voice, and no-phrasal-verb discipline. Relax the ~900-word dictionary lockdown so the text keeps enough range to read naturally.

For the fuller ASD-STE100 rule map, read `references/asd-ste100-rules.md`.

## Self-lint (run before returning text)

1. Any sentence over 20 words? Split it.
2. Any semicolon or em dash? Replace with a period, a comma, or two sentences.
3. Any contraction? Expand it.
4. Any passive voice with a known actor? Make it active.
5. Any "-ing" main verb, nominalization ("perform an analysis"), or phrasal verb ("spin up")? Replace with a plain verb.
6. Any "not X, it is Y" pivot or hollow intensifier? Rewrite as a direct statement.
7. Same thing named two ways? Pick one name.

## Validate (optional)

Check the mechanical rules with the linter:

```
python3 techlang-lint.py FILE.md
```

It prints a slop score (`total`, and `per100w` normalized by length). Lower is better. `python3 techlang-lint.py --max N FILE.md` exits non-zero when the score is over `N`, for use in a hook or CI. See `README.md` for the optional advisory hook.

The mechanical rules are lintable and are what removes slop. Full STE also needs human judgment (the right technical noun, whether a sentence "makes good sense"). A checker cannot certify that. These rules fix the FORM of slop. They are a quality signal, not an AI-detector verdict, and can fire on second-language or already-compressed technical prose. They cannot make a hollow paragraph true.

Free official standard (do not paste it in full; it is copyrighted): https://asd-ste100.org

## When invoked as /ste in a chat session

(Project addition, not part of the upstream skill.) Apply the STE-flavored mode to your own replies to the user for the rest of the session: explanations of code, summaries of changes, and status updates. Code, identifiers, and command syntax stay unchanged.
