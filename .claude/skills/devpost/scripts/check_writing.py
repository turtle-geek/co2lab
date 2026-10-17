"""Flag AI-sounding or hard-to-read prose in Devpost and README drafts.

Usage: python check_writing.py FILE.md [FILE.md ...]
Exits 1 if any issue is found. Code blocks, inline code, and URLs are skipped.
"""

import re
import sys

MAX_SENTENCE_WORDS = 25
MAX_PARAGRAPH_SENTENCES = 3

BANNED = [
    "seamless", "seamlessly", "robust", "cutting-edge", "cutting edge",
    "state-of-the-art", "state of the art", "revolutionize", "revolutionizes",
    "revolutionary", "game-changer", "game changer", "game-changing",
    "transformative", "delve", "delves", "harness", "harnesses", "harnessing",
    "unleash", "unleashes", "unlock", "unlocks", "unlocking", "elevate",
    "elevates", "empower", "empowers", "empowering", "supercharge",
    "streamline", "streamlines", "effortless", "effortlessly", "intuitive",
    "innovative", "next-generation", "next generation", "powerful", "landscape",
    "realm", "tapestry", "synergy", "paradigm", "holistic", "journey",
    "leverage", "leverages", "leveraging", "utilize", "utilizes", "utilizing",
    "in today's world", "in an era of", "at its core", "it's worth noting",
    "it is worth noting", "plays a crucial role", "a testament to",
    "whether you're", "in conclusion", "overall,",
]

NOT_JUST = re.compile(r"\bnot (just|only)\b[^.]{0,80}\bbut\b", re.I)
DASH = re.compile(r"[—–]|(?<=\w) - (?=\w)|(?<=\w)--(?=\w)")
TODO = re.compile(r"\{TODO[^}]*\}|\{[A-Z][^}]{2,}\}")


def prose_lines(text):
    """Yield (line_number, line) for lines outside fenced code blocks."""
    in_code = False
    for i, line in enumerate(text.splitlines(), 1):
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        line = re.sub(r"`[^`]*`", "", line)
        line = re.sub(r"https?://\S+", "", line)
        line = re.sub(r"\]\([^)]*\)", "]", line)
        yield i, line


def is_structural(line):
    s = line.strip()
    return (
        not s
        or s.startswith("#")
        or s.startswith("|")
        or s.startswith(">")
        or s.startswith("!")
        or re.match(r"^[-*] |^\d+\. ", s) is not None
    )


def sentences(text):
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]


def check(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    issues = []
    paragraph, para_start = [], None

    def flush():
        if paragraph:
            n = len(sentences(" ".join(paragraph)))
            if n > MAX_PARAGRAPH_SENTENCES:
                issues.append((para_start, f"paragraph has {n} sentences (max {MAX_PARAGRAPH_SENTENCES})"))

    for n, line in prose_lines(text):
        lower = line.lower()
        if DASH.search(line):
            issues.append((n, "dash used as punctuation, use a period or comma"))
        if ";" in line:
            issues.append((n, "semicolon, split into two sentences"))
        for word in BANNED:
            if re.search(r"(?<![\w-])" + re.escape(word) + r"(?![\w-])", lower):
                issues.append((n, f'banned word or phrase: "{word}"'))
        if NOT_JUST.search(line):
            issues.append((n, '"not just X, but Y" pattern, state the point directly'))
        for todo in TODO.findall(line):
            issues.append((n, f"unfilled placeholder: {todo}"))
        for s in sentences(re.sub(r"^\s*([-*]|\d+\.)\s+", "", line)):
            words = len(s.split())
            if words > MAX_SENTENCE_WORDS:
                issues.append((n, f'sentence has {words} words (max {MAX_SENTENCE_WORDS}): "{s[:60]}..."'))

        if is_structural(line):
            flush()
            paragraph, para_start = [], None
        else:
            if not paragraph:
                para_start = n
            paragraph.append(line)
    flush()
    return sorted(issues)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    total = 0
    for path in sys.argv[1:]:
        issues = check(path)
        total += len(issues)
        print(f"{path}: {'OK' if not issues else f'{len(issues)} issue(s)'}")
        for n, msg in issues:
            print(f"  line {n}: {msg}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
