# technical-language

A Claude Code skill that rewrites technical prose into clear language. It uses the
rules of ASD-STE100 Simplified Technical English (STE) and removes "AI slop". It
applies to documentation, READMEs, pull-request text, error messages, release notes,
and comments. It does not change code.

This README follows its own skill.

Contents:

- `SKILL.md`: the skill. The rules, the two modes, and a self-lint checklist.
- `techlang-lint.py`: an optional linter. It scores prose against the mechanical rules.
- `references/asd-ste100-rules.md`: a plain-language map of the STE rule areas.
- `hooks/techlang-check.sh`: an optional advisory hook.

## Install

Copy or link the skill into your Claude Code skills directory:

```
cp -r technical-language-skill ~/.claude/skills/technical-language
# or link the repo so it stays current:
ln -s "$PWD" ~/.claude/skills/technical-language
```

Claude Code loads the skill when a task matches the description in `SKILL.md`. For
example, "make this README not sound like AI" or "rewrite these docs in plain
language".

## Optional: the linter

Run it on any prose file:

```
python3 techlang-lint.py FILE.md
```

It prints a slop score. `total` is the raw count of rule violations. `per100w`
divides that by length. Use `per100w` to compare files of different sizes. A lower
score is better. The linter also prints the em-dash count and treats the em dash as a
slop marker.

Gate on a threshold. The command exits non-zero when `per100w` is over the limit:

```
python3 techlang-lint.py --max 8 FILE.md
```

Check the linter itself:

```
python3 techlang-lint.py --selftest
```

The word and phrase lists live only in `techlang-lint.py`. That file is the single
source of truth for what the checker flags. `SKILL.md` teaches the principles.

## Optional: the advisory hook

The hook runs the linter after each file write. It warns when the score is high. It is
advisory only. It never blocks a write. Setup is opt-in. Nothing runs until you add it
yourself.

Add this to `~/.claude/settings.json`. Adjust the path to your install location:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$HOME/.claude/skills/technical-language/hooks/techlang-check.sh\""
          }
        ]
      }
    ]
  }
}
```

The hook checks `.md`, `.markdown`, and `.txt` files. It skips code. Set
`TECHLANG_MAX_PER100W` to change the threshold. The default is `8`. The hook needs
`python3` and `jq` on your PATH.

## Scope

The mechanical rules remove the form of slop: long sentences, passive voice, marketing
words, em dashes, and the "not X, it is Y" pivot. They are a quality signal. They are
not an AI-detector verdict. They can fire on second-language writing, or on prose that
is already tight and technical. They cannot make a hollow paragraph true. Use judgment.

STE is a real standard. This skill checks the parts a machine can test. It links to the
free official source and does not copy its text, which is copyrighted:
https://asd-ste100.org

## Credits

Inspired by ["The cure for AI slop" by woosal1337](https://github.com/woosal1337/blog/blob/main/videos/ep01-the-cure-for-ai-slop/README.md).
