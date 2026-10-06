---
name: writing-ste
description: Use when the user asks to write, document, describe or explain a system, app, service, module, package, pipeline or flow in this codebase in ASD-STE100 Simplified Technical English (STE, "simplified English", "controlled English"), or asks to rewrite or check an existing document against STE.
---

# Writing a system description in ASD-STE100

STE (ASD-STE100 Simplified Technical English, Issue 9, January 2025) is a controlled language: approved words with one meaning each, short sentences, simple verb forms. The reader cannot ask a follow-up question, so every sentence must read one way only.

A good STE system document has two properties. It is **true to the code**: every statement traces to a file. It is **STE**: it passes `scripts/ste-check.mjs` and the manual checks below. Most failures come from the first property, not the second. Read the code before you write a word.

## 1. Fix the scope

- Name the module from the request: an app (`apps/api`, `apps/worker`, `apps/extractor`, `apps/web`, `apps/cli`), a package, a directory, or a flow ("document intake", "sign-in").
- If the request names no module, or names a flow that crosses apps, ask one question: which part, and for which reader (developer, operator, investor).
- Default reader: a developer new to this repo whose first language is not English.
- Default output: `docs/systems/<slug>.md`. Use the path the user gives instead, if they give one.

## 2. Read the code, not the docs

1. Find the entry points: routes, handlers, exported functions, job names, CLI commands.
2. Follow one real input to its output. Write down each step with its `file:line`.
3. List the states, errors and retries. Read the tests: they show the intended behaviour.
4. List what the module reads and writes: tables, queues, files, external services, environment variables.
5. Read `docs/*.md` last, to compare. Where a doc and the code disagree, the code wins. Tell the user about the difference.

For a module of more than about 15 files, send `Explore` agents in parallel, one for each part. Ask each for facts with `file:line`, not prose.

Do not write a statement that you cannot trace to a file. If you do not know, write "Not known" and say so in your reply.

## 3. Use this document shape

Write the sections in this order. Leave out a section that has no content. Do not write "None".

1. **Title**: `# <Module name>: system description`.
2. **Terms**: a table of each technical noun and its one meaning. After this table, use each term with this meaning only. Do not use synonyms.
3. **Function**: what the module does and for whom. One paragraph, the most important information first.
4. **Parts**: a table. Columns: Part, Location, Function.
5. **Operation**: a numbered list of the steps from input to output. Descriptive text, simple present tense.
6. **States and errors**: a table. Columns: State or error, Cause, Result.
7. **Data**: what the module reads and writes.
8. **Procedures**: one `###` heading for each task, "To run the tests" for example. Numbered steps in the imperative. Put commands in code blocks.
9. **Warnings and cautions**: only for a real risk. WARNING: a risk to people. CAUTION: a risk of damage to data or equipment. Maester convention, not STE: a risk to an investor's money, credentials or private data is also a WARNING.
10. **Limits**: what the module does not do yet.
11. **Sources**: the files that this document comes from, as links.

## 4. Write in STE

Read [references/rules.md](references/rules.md) before you write. The core rules:

| Rule | Procedural text (steps) | Descriptive text |
| --- | --- | --- |
| Sentence length | 20 words maximum | 25 words maximum |
| Verb form | Imperative ("Run the tests.") | Simple present, simple past, simple future |
| Voice | Active only | Active. Passive only when the agent is not known or not important |
| Content | One instruction for each sentence. Condition first: "If X, do Y." | One topic for each sentence. Six sentences maximum in a paragraph |

Also, for all text:

- Use approved words with their approved meaning and part of speech. See [references/words.md](references/words.md) for frequent replacements.
- Do not use -ing verb forms ("The worker is polling", "after reading the file"). Exception: an -ing word that is part of a technical noun.
- Do not use perfect or progressive tenses ("has started", "is running").
- Maximum three words in a noun cluster. "the document intake retry queue timeout" becomes "the timeout of the retry queue for document intake".
- Do not leave out "the", "a" or "that".
- Do not use semicolons. Use a vertical list for three or more items or conditions.
- Do not use Latin abbreviations (e.g., i.e., etc., via).
- Use American spelling ("behavior", "color"), as the STE dictionary does, even though other docs in this repo use British spelling.

Code names are technical nouns. Write them exactly as the code does, in backticks: `pollSlip`, `/api/documents`, `documents` table. Do not use a code name as a verb ("`upload` the file" is wrong).

## 5. Check, then fix

1. Run the checker:

   ```bash
   node .claude/skills/writing-ste/scripts/ste-check.mjs docs/systems/<slug>.md
   ```

2. Fix every `error`. Read every `warn` and fix it, or keep it if it is a technical noun.
3. Do the manual checks that the script cannot do:
   - Each noun cluster has three words or fewer.
   - Each word has one meaning in the document, and the Terms table agrees.
   - Each step has one instruction.
   - Each statement traces to a file in Sources.
4. Run the checker again until it shows no errors.
5. For a new file under `docs/systems/`, add a row for it to the reading guide in `docs/README.md`.

## 6. Reply

Give the path of the document. Then list, in one short line each:

- Each difference between the code and the existing docs.
- Each "Not known" in the document.
- Each warning that you kept, and why.

Do not paste the document into the reply.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| The document copies `docs/ARCHITECTURE.md` and repeats a stale claim | Read the code first. The code wins. |
| "The system is responsible for handling uploads" | "The system receives uploads." Use a verb, not a noun phrase. |
| "Ensure that the worker is running" | "Make sure that the worker runs." |
| Two names for one thing ("slip", "card", "panel") | Pick one in Terms. Use only that name. |
| A step with two actions: "Start the API and open the page." | Two steps. |
| A WARNING for a normal error state | Use the States and errors table. Keep warnings for real risk. |
