# Open-source tools and rule catalogues for requirements review

Research date 2026-11-27. Every URL below was opened during this research, through the GitHub API (`gh api`) or a page fetch. Star counts and last commit dates come from the GitHub API on that date. "Last commit" is the committer date of the newest commit on the default branch.

## What the agent does today (baseline for comparison)

- `src/prompts.ts` sends four kinds of request: extract, check per batch of 8 requirements against 10 criteria from 29148 5.2.5 and 830 4.3, check the whole set against 7 criteria, and build questions. Every criterion goes into one prompt. Nothing runs one prompt per criterion.
- `src/rules.ts` already holds set-level code checks that make no LLM call: `money-units`, `field-types`, `mutating-get`, `json-without-body`, `status-section`, `error-in-success`, `empty-values`, plus a `PLACEHOLDER` regex (TBD, TODO, "уточняется"). Each `CodeFinding` has a `topic` regex, so a code finding is added only when the model missed it.
- `eval/recall.ts` with `eval/requirements.known.ts` measures recall against a hand-written list of known defects in the issued document. It makes no API calls.
- The ROLE prompt already says "пропущенный дефект дороже лишнего вопроса". AQUSA's Perfect Recall Condition (section 3) takes the same position.
- No code check works at the level of a single requirement's wording. The prompt asks the model to look for "размытые слова", but no word list exists in code. Most items below fill that gap.

## 1. speclint (rules first, an LLM confirms or dismisses)

- Repo: https://github.com/MichaelD-42/speclint . MIT. 0 stars. Created 2026-11-06, last commit 2026-11-11. It is three weeks old with one author, so treat it as a design reference, not a proven tool.
- What it does: it lints English and German requirements specs (ReqIF, CSV, Markdown), flags phrases and gives the character offsets of each match, and grades each requirement A to F. Each rule names the INCOSE GtWR rule that inspired it.
- How it prompts. Deterministic rules produce every finding and every grade. Then an optional review stage sends batches of 25 requirements, each with its code findings attached, to a Haiku subagent. The subagent returns `confirmed` or `dismissed` per finding, plus one question and one rewrite per requirement. In the README's words: "Haiku subagents confirm or dismiss each finding and write a clarification question and a rewrite for each requirement. They never set grades." Items the model is unsure about go once to Sonnet (`batches --unsure`).
- Files read:
  - Rule lists and severities: https://github.com/MichaelD-42/speclint/blob/main/src/speclint/rules.toml
  - Reviewer prompt: https://github.com/MichaelD-42/speclint/blob/main/agents/req-reviewer.md
  - Batch and merge code, which validates model output: https://github.com/MichaelD-42/speclint/blob/main/src/speclint/review.py
  - README: https://github.com/MichaelD-42/speclint/blob/main/README.md
- How it reports results. Each finding has `start`/`end` offsets with `match == text[start:end]`, a rule id, an INCOSE reference (for example `incose = "R7, R34"`), a severity, and a message. A JSON schema defines the output. A requirement with no findings is shown as "no findings", not as a top grade.
- Benchmark. It has none for defect detection. The README says PROMISE "has no quality labels", so `bench/promise.py` prints random hits for checking precision by hand. The 97% figure in the README is for classifying requirement versus information on 70 items, not for finding defects.

Prompt patterns worth copying (quoted from `agents/req-reviewer.md`):

> "Confirm when the matched text really makes the requirement vague, non-binding, open-ended, ambiguous, unverifiable or unrealistic. Dismiss only when the context clearly shows it is not a defect"

> "When unsure, confirm. Give a reason of at most 15 words."

> "`rewrite`: an improved requirement text in the same language. Never invent values: use placeholders such as `[TBD: max. response time in ms]`"

> "Copy `key` and `id` of each requirement and `index` and `rule` of each finding unchanged from the batch; reviews with a wrong key or id, and verdicts with a wrong index or rule, are discarded."

It also lists dismissal cases per rule. For example, `absolute` is not a defect "on a verifiable prohibition ("shall never display the password")", and `missing-tolerance` is not a defect "on a value that is an identifier, a standard number or a reference".

What to copy:
- Run a Russian phrase-list pass in `src/rules.ts` over each extracted requirement. Pass its hits into the existing `checkPrompt` batch as hints: "the code found «по возможности» in R3. Confirm it as a finding or dismiss it with a reason." This adds no requests, only tokens in a prompt that is already sent. The model sees a candidate it might otherwise skip, so recall should rise. The quote is already grounded because code copied it from the document.
- Change the `fix` field instruction to use `[TBD: ...]` placeholders instead of invented numbers. Today `fix` says "Как переформулировать или что добавить" and does not forbid inventing values. This costs zero requests.
- The per-rule dismissal cases above make good negative examples for the hint list.

What to avoid: the A to F grade. This repo's verdict already comes from criticality in code, and a second scale would compete with it.

Extra requests: 0 for hints in `checkPrompt`. Escalating "unsure" items to a stronger model would cost 1 more request per run, and the free-tier budget makes that hard to justify.

## 2. INCOSE Guide to Writing Requirements v4 as a rule catalogue

- Primary source: the INCOSE Requirements Working Group page https://www.incose.org/group/requirements-working-group/ links a free GtWR v4 Summary Sheet: https://www.incose.org/docs/default-source/working-groups/requirements-wg/guidetowritingrequirements/incose_rwg_gtwr_v4_summary_sheet.pdf (7 pages, 2023, redirects to `incose.org/wp-content/uploads/legacy/...`). The full guide (INCOSE-TP-2010-006-04, June 2023) is sold in the INCOSE store.
- Licence of the summary sheet, verbatim: "permission to reproduce and use this summary is granted, with attribution to INCOSE and the original author(s) where practical, provided this copyright notice is included with all reproductions and derivative works." So rule numbers, names and short paraphrases with attribution are fine. Do not paste text from the full guide.
- The sheet lists characteristics C1 to C9 for one statement and C10 to C15 for a set. These match 29148 5.2.5 and 5.2.6, which this repo already uses, plus C15 "Correct" for a set, which this repo's SET list lacks. It also lists rules R1 to R42.
- An implementation that cites the rules: https://github.com/gitvendis/incose-requirements (Apache-2.0, 1 star, last commit 2026-10-24). Its NOTICE says the Apache licence "grants no rights to INCOSE material" and that the rule text is "paraphrased from that summary sheet". Rule table: https://github.com/gitvendis/incose-requirements/blob/main/references/rules.md . Regex checker: https://github.com/gitvendis/incose-requirements/blob/main/scripts/req_lint.py . It is a Claude skill that pairs a regex linter with an LLM instruction to "Review every applicable rule in context, including those with no automated finding."

Split of the rules between code and the LLM. Rule names are verified against the summary sheet. "Code" means a phrase list or regex finds candidates, which `req_lint.py` or speclint's `rules.toml` already shows in English. Each list has to be rewritten in Russian; the English lists do not carry over.

| Rule | Name | Check by | Russian candidates (my suggestion, not from a source) |
|---|---|---|---|
| R7 | Vague Terms | code finds candidates, LLM confirms | быстро, удобно, достаточно, приемлемо, оптимально, своевременно, интуитивно, и т.п. |
| R8 | Escape Clauses | code | по возможности, при необходимости, если требуется, по мере необходимости, как правило |
| R9 | Open-Ended Clauses | code | и т.д., и т.п., и др., в том числе, включая, например (when used as a list) |
| R15 | Logical Expressions | code for "и/или" | и/или |
| R17 | Use of Oblique Symbol | code, excluding units | слеш between words, excluding units such as км/ч |
| R24 | Pronouns | code finds candidates, LLM confirms the antecedent | он, она, оно, они, этот, такой, данный, соответствующий, вышеуказанный |
| R26 | Absolutes | code finds candidates, LLM confirms | всегда, никогда, все, любой, 100 %, мгновенно |
| R34 | Measurable Performance | code finds candidates, LLM confirms | быстрый, высокий, минимальный, максимально без числа |
| R35 | Temporal Dependencies | code finds candidates, LLM confirms | сразу, немедленно, своевременно, в ближайшее время, после, до без срока |
| R6, R33 | Units, Range of Values | code for a number without a unit or a bound | a number without a unit, a value without "не более", "от...до" or ± |
| R37, R4 | Acronyms, Defined Terms | code for an acronym never expanded in the document | regex `\b[А-ЯA-Z]{2,}\b` checked against a glossary or a "(расшифровка)" pattern |
| R30 | Unique Expression | code for near-duplicates | word-overlap duplicate check, set level |
| R40 | Decimal Format | code | "1,5" and "1.5" in one document |
| R18, R19 | Single Thought, Combinators | code finds candidates, LLM decides | count of "должен/должна/должно" per requirement; "а также", "кроме того" |
| R2, R3, R5, R12-R14 | Grammar group | low value for Russian SRS (R5 Definite Articles does not apply to Russian) | skip |
| R11, R20-R23, R25, R27-R29, R31, R32, R36, R38, R39, R41, R42 | Context-dependent | LLM | already covered by the 29148 criteria in `checkPrompt` and `setPrompt` |

What to copy: the rule ids. Add an optional `rule` field (for example "R8") to `CheckSchema`, or have code put it on code-sourced hints. A reviewer can then trace each finding to a published rule, which supports the "Трассируемость" story in the report. This costs zero requests.

What to avoid: running all 42 rules through the LLM. Most of them restate 29148 criteria the prompt already covers.

Extra requests: 0.

## 3. QUS framework and AQUSA (code for syntax, people or an LLM for semantics)

- Paper: Lucassen, Dalpiaz, van der Werf, Brinkkemper, "Improving agile requirements: the Quality User Story framework and tool", Requirements Engineering 21(3), 2016, pp. 383-403. https://link.springer.com/article/10.1007/s00766-016-0250-x . Open access, CC BY 4.0.
- QUS has 13 criteria in three groups. Syntactic: well-formed, atomic, minimal. Semantic: conceptually sound, problem-oriented, unambiguous, conflict-free. Pragmatic: full sentence, estimatable, unique, uniform, independent, complete. This grouping is copied verbatim from the paper in the amolsha prompt file (section 4).
- The split between code and semantics, quoted from the paper: "the first version of AQUSA focuses on the QUS criteria for which the probability of fulfilling the Perfect Recall Condition is high; thus, we include the syntactic criteria and a few pragmatic criteria that can be algorithmically checked, but we exclude semantic criteria as they require deep understanding of requirements' content".
- The Perfect Recall Condition, quoted: "we require AQUSA to detect defects with close to 100 % recall ... On the other hand, precision ... should be high enough so the user perceives AQUSA to report useful errors." It builds on Berry et al., "The case for dumb requirements engineering tools" (REFSQ 2012).
- Evaluation: 1023 user stories from 18 companies. Micro average recall 93.8%, precision 72.2%. Macro average recall 82.2%, precision 77.0%.
- Open implementations, both MIT:
  - https://github.com/RELabUU/aqusa-core (21 stars, last commit 2023-03-09), a command-line version. The defect table is in https://github.com/RELabUU/aqusa-core/blob/master/corefiles/globals.py (`ERROR_KINDS`: well_formed_content, atomic, unique, uniform). Each defect kind has a `severity` and a `highlight` message.
  - https://github.com/gglucass/AQUSA (34 stars, last commit 2023-09-14), the archived Flask backend. Its README points to aqusa-core.
- AQUSA's atomic check is a plain conjunction list: `CONJUNCTIONS = [' and ', '&', '\+', ' or ', '>', '<', '/', '\\']`. Its `uniform` check works out the most common template in the set and flags each story that departs from it: "Use the most common template: %s".

What to copy:
- The "uniform" idea as a set-level code rule. Find the dominant requirement pattern (for example "Система должна ..." or a numbered "Ф-N" prefix) and flag requirements that depart from it. This maps to 29148 5.2.5 i "conforming", which is now left entirely to the LLM. It costs 0 requests.
- Exact and near-duplicate detection in code (QUS "unique", INCOSE R30). It costs 0 requests.
- Report recall and precision separately per defect kind, as AQUSA does. `eval/recall.ts` reports recall only.

What to avoid: AQUSA's NLTK and Stanford POS tagger stack. It parses English only and adds dependencies this Bun project does not need.

Extra requests: 0.

## 4. LLM studies that publish their prompts

### 4a. Lubos et al., "Leveraging LLMs for the Quality Assurance of Software Requirements", RE 2024 (RE@Next!)

- https://arxiv.org/abs/2408.10886 , DOI 10.1109/RE59067.2024.00046. I found no code repository.
- Setup: Llama 2 70B, 9 ISO 29148 characteristics, one characteristic per request. The prompt template, from the PDF: "Your task is to evaluate the quality of a software requirement. Evaluate whether the following requirement is {quality_characteristic}. {quality_characteristic} means: {quality_characteristic_explanation} The evaluation result must be: 'yes' or 'no'. ... Explain your decision and suggest an improved version."
- Data: 10 requirements written by an LLM ("Stopwatch") and 63 requirements from PURE ("DigitalHome").
- Results. Read these carefully. "Independent" means raters judged before seeing the LLM's answer. "Bound" means they judged after seeing it. On DigitalHome, independent results were precision 0.13, recall 0.74, Cohen's kappa 0.05. The bound results (precision 0.32, recall 1.0, kappa 0.22) show raters adopting the model's view, so they are not a measure of accuracy. The authors say: "the number of wrongly identified flaws by the LLM is quite high."
- What to avoid: one request per criterion per requirement. For this agent that would multiply step 2 by about 10, and the study's own numbers show poor precision on a real document. It is evidence for keeping all criteria in one prompt with code-side grounding.
- What to copy: the request "explain your decision and suggest an improved version", which this repo already has as `problem` and `fix`.

### 4b. Sharma and Tripathi, "Evaluating user story quality with LLMs: a comparative study", Journal of Intelligent Information Systems 63, 2025

- https://link.springer.com/article/10.1007/s10844-025-00939-3 (paywalled, so I read only the abstract).
- Prompts and data: https://github.com/amolsha/UserStoryQualityEvaluation (no licence file, 2 stars, last commit 2025-03-27). Files: https://github.com/amolsha/UserStoryQualityEvaluation/blob/main/Prompts_ContextMinimalPrompting_CMP.txt and https://github.com/amolsha/UserStoryQualityEvaluation/blob/main/Prompts_ContextRichPrompting_CRP.txt . The dataset of 960 LLM-generated user stories with student labels is in the `.xlsx` files.
- Prompt structure: one criterion per request, with many stories per request, and a yes/no answer per story ("No explanation please."). The context-rich variant adds a paragraph and one bad example with its fix for each criterion.
- Result, from the abstract only: GPT-4o and GPT-4-Turbo did best "particularly excelling in syntactic and pragmatic criteria with minimal impact from additional contextual details", and GPT-3.5-Turbo got worse with richer context.
- What to copy: possibly one short bad example with its fix per criterion in `describeCriteria`. The abstract suggests strong models gain little from this, so it is low priority. The repo has no licence, so write your own examples rather than copying theirs.
- What to avoid: yes/no answers without a quote. They cannot be grounded.

Extra requests: 0 for adding examples. One request per criterion would cost about 10x.

## 5. Other rule-based smell detectors (word lists only)

- NALABS: https://github.com/eduardenoiu/NALABS (MIT, 1 star, last commit 2025-06-18). Rules: https://github.com/eduardenoiu/NALABS/blob/master/NALABSpy/func_core/nalabs_rules.py . It checks ambiguous words, Flesch readability, TextBlob subjectivity, and keyword counts (optionality and others). English only, and the readability and subjectivity scores do not transfer to Russian. Skip it except as another word-list reference.
- NLP4RE tools list: https://github.com/JulianFrattini/nlp4re-tools/blob/main/tools/nlp4re-tools.md (MIT, 8 stars, last commit 2025-03-31). It lists 126 tools from 2019-2023 venues. Among its detection tools are MAANA (https://github.com/SNTSVV/MAANA, MIT, coordination and PP-attachment ambiguity) and the anaphoric ambiguity detector of Ezzini et al. (ICSE 2022, GitLab, GPL-3.0). It lists no LLM-based reviewer. Use it to find more tools, not as something to copy.
- incose-requirements-workbench: https://github.com/ssaleem74/incose-requirements-workbench (no licence, 0 stars, last commit 2026-02-11). It is a single-file HTML tool that claims "42-rule quality analysis". I did not read its code. Unverified, and nothing to copy.

## 6. Benchmarks and annotated datasets

- PURE: https://zenodo.org/records/1414117 (CC BY 4.0). Ferrari, Spagnolo, Gnesi, RE 2017. It has 79 public requirements documents and **no defect labels**. Lubos et al. used one PURE document (DigitalHome) and had people label it. PURE gives you raw SRS text, not ground truth.
- Seeded-smell benchmark: https://zenodo.org/records/17441075 (CC BY 4.0, one zip of 3.6 MB, published 2025-10-25), "Replication Package: On the Impact of Requirement Smells in LLM-Based Code Generation". From its description: "we progressively introduced semantic, syntactic, and lexical smells into otherwise clear requirements". It reuses the benchmark and smell taxonomy of Vogelsang et al., ICSE-NIER 2025 (https://arxiv.org/abs/2501.04810). The domain is four game applications, in English. I did not unpack the zip, so its labels are unverified.
- Multi-label smell set: https://github.com/arsalaniltaf/RequirementSmells (no licence, 0 stars, last commit 2026-09-04). It has five labels (Subjective, Ambiguous, Nonverifiable, Negative, Vague), "harmonized" from several datasets. The README does not name the source datasets or their licences. Unverified as a source of ground truth.
- AQUSA's evaluation set (1023 stories from 18 companies) is described in the paper. I found no public download with the defect annotations.
- speclint's `bench/classify_eval.csv` (70 items, English and German) labels requirement versus information, not defects.

Conclusion: no open, Russian, defect-annotated SRS benchmark turned up. This repo's `eval/requirements.known.ts` with `eval/recall.ts` is already the right shape. The practical idea to borrow from Zenodo 17441075 is **seeding**. Take one clean requirements document, inject known defects of each kind (a vague word, an escape clause, a missing unit, a contradiction between two sections, a GET that writes data), and measure recall and precision per kind. Each evaluation run costs one normal agent run, about 10 requests per seeded document. It adds no requests to a user's run.

## Ranked list: the 5 most useful things to copy, by expected gain per extra request

All five add zero requests to a user's run. They are ranked by expected gain in recall and trust.

1. **A Russian INCOSE phrase layer in `src/rules.ts`, sent to `checkPrompt` as hints to confirm or dismiss.** Rules R7, R8, R9, R15 (и/или), R24, R26, R34 and R35 go into one Russian list. Code finds the phrase inside each extracted requirement's quote. The batch prompt gets "кандидаты от проверки кодом: R3 «по возможности» (INCOSE R8)" and must confirm with a finding or dismiss with a reason of 15 words or fewer. "When unsure, confirm" (speclint `agents/req-reviewer.md`). Escape clauses (R8) and open-ended lists (R9) can be reported directly from code, as the existing `CodeFinding` set rules are. Cost: 0 requests, a few hundred tokens per batch. Gain: a deterministic floor of recall on lexical defects, with the same results on every run.
2. **No invented values in `fix`.** Add to the ROLE or `checkPrompt` rules: "In `fix`, do not invent numbers, limits or names. Write a placeholder such as [TBD: максимальное время ответа, мс] and ask for the value in `question`." Source: speclint `agents/req-reviewer.md`. Cost: 0 requests. Gain: the report stops proposing thresholds the author never chose, which a reviewer could take as a factual error.
3. **More set-level code rules: acronyms never expanded (R37/R4), near-duplicates (R30, QUS unique), template uniformity (QUS uniform, 29148 conforming), and mixed decimal format (R40).** Sources: speclint whole-spec rules in `README.md` and `rules.toml`, and AQUSA `uniform_rule` and `identical_rule` in `corefiles/analyzer.py`. Each fits the existing `CodeFinding` shape with `topic` deduplication. Cost: 0 requests.
4. **A seeded-defect benchmark next to `eval/recall.ts`.** Inject one defect of each kind into a clean copy of the document, then report recall and precision per defect kind, as AQUSA reports per criterion. Sources: Zenodo 17441075 (seeding method) and the AQUSA paper (per-kind reporting). Cost: 0 requests per user run, about 10 requests per evaluation run. Gain: a measured answer to "did a prompt change help", instead of one document's known list.
5. **An INCOSE rule id on each finding.** Add an optional `rule` field (for example "R8") to `CheckSchema`, and fill it from code for code-sourced findings. Attribute INCOSE once in the report with the summary-sheet notice. Source: speclint `incose = "R7, R34"` fields in `rules.toml`, and gitvendis `references/rules.md`. Cost: 0 requests. Gain: each finding cites a public rule a reviewer can look up. This is a gain in trust, not recall, so it ranks last.

Not recommended: one prompt per criterion (Lubos et al. 2024, Sharma and Tripathi 2025). It multiplies step 2 by about 10, and the one independent measurement on a real document (DigitalHome) gave precision 0.13 and kappa 0.05.
