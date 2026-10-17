# ASD-STE100 rule map

This is a plain-language summary of how ASD-STE100 Simplified Technical English is
organized. It is not a copy of the standard. The standard is copyrighted. Get the
free official specification at https://asd-ste100.org.

STE has two parts: a set of writing rules, and a dictionary of approved words. The
skill in `SKILL.md` implements the rules that a checker can test. This file gives the
wider structure so you can go deeper when a passage needs judgment.

## The writing-rule areas

1. **Words.** Use approved words only. One word has one meaning. One meaning has one
   word. Do not use a word as more than one part of speech. Do not make new words.

2. **Noun clusters.** Do not stack more than three nouns in a row. "runway light
   connection resistance" is a cluster. Break it up with articles and prepositions:
   "the resistance of the connection for the runway lights".

3. **Verbs and tense.** Use only the approved forms of a verb. Use the active voice.
   Use simple tenses (past, present, future). Do not use the "-ing" form as the main
   verb. Do not build long strings of helper verbs.

4. **The passive voice.** Avoid it in procedures. Name the actor and put it first.
   Write "hold the switch", not "the switch must be held".

5. **Sentence length.** Keep procedure sentences to 20 words or fewer. Keep
   descriptive sentences to 25 words or fewer. One instruction per sentence.

6. **Procedures.** Use the imperative. Start each step with the command verb. Use a
   vertical numbered list, one action per step. Put the condition before the command:
   "If the light is on, push the button".

7. **Descriptive writing.** Keep paragraphs to one topic. Use short paragraphs. Keep
   the tense and the point of view constant inside a paragraph.

8. **Warnings and cautions.** Put the warning before the step it applies to. Start it
   with a clear command or a condition. State what happens and how to avoid it.

9. **Punctuation and word count.** Use simple punctuation. Avoid the semicolon; write
   two sentences instead. Keep the standard set of function words (articles,
   prepositions) so the text does not collapse into a noun cluster.

## The approved dictionary (concept)

STE ships an approved word list of roughly nine hundred words. Each entry fixes one
part of speech and one meaning. Words outside the list are either replaced with an
approved synonym or added as approved technical nouns for a specific project. The
skill does not ship the dictionary. It applies the highest-value substitutions
directly (see the WORDS rules in `SKILL.md`) and links to the official source above.

## This skill's one deviation

STE permits the em dash. This skill removes it, because the em dash is a common marker
of AI-generated prose and the goal here includes removing that "slop". Everything else
follows STE.
