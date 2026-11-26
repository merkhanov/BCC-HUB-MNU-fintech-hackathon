# Detecting requirements defects with LLMs and NLP

Research notes for the requirements review agent (Bun/TypeScript, Gemini Flash free tier, 20 requests per day per model). Every arXiv ID and URL below was opened on 2026-11-27 and returned the expected page. Numbers come from the cited paper's own tables or text.

Two facts about the current code shape the recommendations:

- `checkPrompt` already tells the model to compare units, types and formats of the same field across sections. `setPrompt` already tells it to find pairs of rules that fire on the same event or period. The model still misses tiyn vs tenge and Ф-3 vs Ф-4. More prompt text will not fix these misses, so the strongest options below move work into code or give the model a narrower task.
- `eval/requirements.known.ts` lists the known defects (`f3-vs-f4`, `jan31-vs-f2`, `tiyn-vs-tenge`, `types-mismatch` and others), and `bun run recall` scores a report against them without API calls. Each change below names the defect IDs it should move, so the harness can measure it.

Almost all of the evidence is from English (some German) documents. No paper I found evaluates Russian requirements. Lexicons and thresholds from these papers need translating and re-tuning. They cannot be copied.

---

## 1. LLM quality assessment against ISO 29148 / IEEE 830

### 1.1 One prompt per requirement and characteristic (Lubos et al., 2024)

**(a) Method.** The LLM receives the project scope description, one requirement, and the definition of one ISO 29148 characteristic. It returns a fulfilled or not-fulfilled verdict, an explanation and an improved requirement. At least four software engineers labelled each item by majority vote to form the ground truth.

**(b) Evidence.** Llama-2-70B-chat ran at temperature 0.01 on two projects. With independent assessment, precision was 0.50 and recall 0.89 on Stopwatch. On DigitalHome, precision was 0.13 and recall 0.74. Cohen's kappa between the LLM and the engineers was weak or non-existent. After the engineers saw the LLM's explanation, precision rose to 0.88 and 0.32 and recall to 1.0. The authors conclude that the LLM finds most flawed requirements but needs manual verification because of false positives. Source: https://arxiv.org/abs/2408.10886

Related numbers come from Fazelnia et al. ChatGPT, queried one requirement per chat, scored F1 57 (ambiguous), 61 (non-measurable), 51 (non-atomic) and 40 (directive) on a defect-type dataset. A fine-tuned RoBERTa NLI model scored 76, 67, 65 and 100 on the same classes. Source: https://arxiv.org/abs/2405.05135 (Table X).

A 2025 survey of 74 LLM-for-RE studies reports that most use GPT models with zero-shot or few-shot prompting. It also reports that defect detection is now studied less than elicitation and validation. Source: https://arxiv.org/abs/2509.11446

**(c) Change for this agent.** Step 2 already follows this design, with 8 requirements and 10 criteria per request instead of one requirement and one criterion. The evidence predicts what the runs show: high recall on single-requirement defects and a large share of weak findings. The 10 to 25 percent variation in finding counts fits the same picture, since a low-precision detector produces a different set of borderline findings each run. No new LLM step is needed here. Precision gains come from the deterministic checks in sections 2 and 3, which give the model concrete hits to confirm instead of open-ended judgement.

**(d) Cost.** 0 extra requests.

---

## 2. Requirements smells and ambiguity

### 2.1 Dictionary and POS-rule smell detection (Smella, QuARS, NALABS)

**(a) Method.** Fixed word lists, plus a few part-of-speech or morphology rules, flag phrases that ISO 29148 section 5.2.7 lists as unacceptable in requirements. Examples are subjective words, vague adverbs, loopholes ("as far as possible"), open-ended terms, superlatives, comparatives, negative statements and vague pronouns. Each match is an exact span of the document.

**(b) Evidence.**
- Smella covers 8 smells: subjective language, ambiguous adverbs and adjectives, loopholes, open-ended non-verifiable terms, superlatives, comparatives, negative statements and vague pronouns. On industrial and university cases, average precision was 59% at average recall of 82%. Precision per smell, from 616 inspected findings: subjective language 0.96. Non-verifiable terms, loopholes and ambiguous adverbs 0.70 to 0.81. Comparatives and superlatives about 0.5. Negative statements and vague pronouns 0.25 to 0.33. The tool produced about 44 findings per 1,000 words. Source: https://arxiv.org/abs/1611.08847
- The related-work table in the Smella paper shows that QuARS covers loopholes/options and subjectivity, with examples and counts but no precision analysis. QuARS official pages: https://www.sei.cmu.edu/library/quars-a-tool-for-analyzing-requirement/ and the NLP4RE 2019 tool paper https://ceur-ws.org/Vol-2376/NLP4RE19_paper07.pdf
- NALABS (MIT licence, C#) publishes its keyword lists. They cover vagueness ("may", "could", "some", "appropriate", "up to", "adequate", "as applicable", "be able to", "normal"), optionality ("can", "may", "optionally"), subjectivity ("similar", "better", "take into account", "as possible"), weakness ("adequate", "as appropriate", "timely", "easy to", "effective"), references ("see document", "Figure", "Table") and readability (ARI). It also counts conjunctions as a size measure. The paper gives no precision or recall. Source: https://arxiv.org/abs/2202.05641 and repo https://github.com/eduardenoiu/NALABS

**(c) Change for this agent.** Add `src/smells.ts`, which runs over each extracted requirement's quote before step 2.
- Build a Russian lexicon per category. Candidates include "удобный", "быстро", "своевременно", "при необходимости", "по возможности", "как правило", "и т.д.", "и др.", "соответствующий", "достаточный", "минимальный", "максимально", "оптимальный", "в разумные сроки", "может", "должен уметь" and "не менее/не более" without a number. Russian inflects heavily, so match lemmas or stems. Mixed Russian/English documents also need "should", "TBD" and "N/A".
- Emit high-precision categories as findings directly. These are subjective language, loopholes, non-verifiable terms and TBD placeholders. A match is an exact substring, so `ground.ts` accepts it.
- Pass low-precision categories into the `checkPrompt` batch as per-requirement hints, for example "the code flagged 'соответствующий' in R5; confirm or dismiss". These are pronouns, negatives and comparatives. A Smella precision of 0.25 to 0.33 is too low to report them unconfirmed.
- Deterministic findings do not change between runs, so they also lower the run-to-run variance.

**(d) Cost.** 0 extra requests. Hints add a few hundred tokens to each step 2 request.

### 2.2 Structural smells with a controlled language (Paska)

**(a) Method.** Paska parses each requirement with constituency trees and Tregex patterns. It then matches the requirement against Rimay, a controlled natural language for requirements, and reports structural smells together with the pattern the requirement should follow.

**(b) Evidence.** On 13 financial-domain systems with 2,725 annotated requirements, the evaluation set gave 89% precision and 89% recall for smells. Pattern suggestion reached 96% precision and 94% recall. The 9 smells are non-atomic, incomplete requirement, incorrect order, coordination ambiguity, not a requirement, incomplete condition, incomplete system response, passive voice and imprecise verb. On the evaluation set, precision and recall were 0.89 and 0.90 for non-atomic, 1.00 and 1.00 for incomplete requirement, 0.81 and 1.00 for incorrect order, and 0.82 and 0.90 for coordination ambiguity. I read only these four rows of the table. The discussion section names the weak cases. Not a requirement had precision 0.50 in one batch. Incomplete system response had precision 0.33 and 0.67 in two batches, from 1 to 2 true positives. Incomplete condition had recall 0.67 in one batch. Source: https://arxiv.org/abs/2305.07097 and repo https://github.com/SNTSVV/Paska (Python plus a Java 8 jar, English Stanford models).

**(c) Change for this agent.** Porting the parser to Russian is out of scope. The smell catalogue is still useful as a checklist, and it is close to the banking domain. Two items cost nothing in code:
- Incomplete condition, meaning a trigger with no "else" branch. Flag requirements that contain "если/когда/при" but no "иначе/в противном случае/если нет". Send them to step 2 as hints.
- Coordination ambiguity, meaning a condition that mixes "и" and "или" without brackets or numbering. A regex over the quote can find it.
The other Paska smells are already covered by the step 2 criteria (singular, complete, verifiable).

**(d) Cost.** 0 extra requests.

### 2.3 Anaphoric ambiguity (TAPHSIR)

**(a) Method.** A machine-learning classifier decides whether each pronoun in a specification is ambiguous. A BERT-variant resolver then proposes its antecedent. Source: https://arxiv.org/abs/2206.10227, tool on Zenodo https://doi.org/10.5281/zenodo.5902117

**(b) Evidence.** The tool paper describes the design and states that the tool is available. I did not read accuracy numbers for it, so I report none here.

**(c) Change for this agent.** The tool is English-only and needs a local model. It is not usable directly. The cheap part to reuse is the trigger list. In Russian these are "он/она/оно/они/его/её/их", "этот/такой/данный/указанный/соответствующий" and "вышеупомянутый" at the start of a requirement. Feed them as hints, as in 2.1. Smella's vague-pronoun precision of about 0.3 means these should stay hints and never become direct findings.

**(d) Cost.** 0 extra requests.

### 2.4 "ReqSmells"

I could not find a primary source for a tool with this name. The GitHub search returned a student thesis project (https://github.com/Thitsugaya1/ReqSmellsWeb) and an LLM prototype backend (https://github.com/Mikun07/LLM_Prototype_Backend). Neither has a published evaluation. Treat the name as unverified and do not cite it as evidence.

### 2.5 Hidden assumptions and pragmatic ambiguity (LLM approaches, recent)

Two 2026 preprints report LLM pipelines for ambiguity in requirements. HiddenLens reports end-to-end F1 0.79 on its own 312-requirement corpus and claims to beat a QuARS-adapted baseline by 61% (https://arxiv.org/abs/2610.29996). A retrieval-augmented approach that simulates novice, intermediate and expert readers reports a best macro recall of 0.75 with GPT-4o-mini on two PURE documents (https://arxiv.org/abs/2607.04436). Both use several LLM calls per requirement and were evaluated on small, self-built data. Neither is worth the request budget here.

---

## 3. Conflict, contradiction and inconsistency detection

### 3.1 Pairwise classification (NLI and fine-tuned encoders)

**(a) Method.** Each pair of requirements is classified as conflict or not. The classifier is an NLI model (premise and hypothesis), a fine-tuned BERT/DeBERTa, or a zero-shot LLM given one pair per prompt.

**(b) Evidence.**
- Fazelnia et al. tested cross-project, zero-shot conflict detection on 7 projects. NLI scored F1 22 to 55 and ChatGPT 9 to 30. NLI won on every project, but the authors call the accuracy "suboptimal". NLI missed compositional conflicts that involve three or more requirements. ChatGPT found some of them, because it saw all the requirements together. Source: https://arxiv.org/abs/2405.05135 (Table XI and lessons learned).
- Malik et al. found that MNLI-initialised models (bert-base-uncased-MNLI, deberta-base-mnli) keep working on highly imbalanced open datasets. They reached macro-F1 90.8 on WorldVista, 84.1 on OPENCOSS, 87.7 on UAV and 94.8 on PURE. TF-IDF, SBERT and SR-BERT baselines collapsed to the majority class (macro-F1 about 0.5). Source: https://arxiv.org/abs/2301.03709

**(c) Change for this agent.** Running a local NLI model would need an extra runtime in a Bun CLI and a multilingual model that nobody has evaluated on Russian requirements. Skip it. The useful lesson is negative. Pairwise checking alone misses conflicts that need a third requirement. Ф-3 vs Ф-4 also depends on the definition of "смена порога", so whole-set context must stay in the prompt.

**(d) Cost.** 0 LLM requests, but a new local model dependency. Not recommended.

### 3.2 Candidate pairs from similarity and shared entities (S3CDA, FSARC)

**(a) Method.** S3CDA works in two phases. Phase I embeds each requirement and keeps pairs above a learned cosine-similarity cut-off. Phase II keeps pairs whose extracted entities (actor, action, object, metric) overlap by at least 75%. FSARC turns each functional requirement into an eight-slot semantic tuple and applies heuristic rules for 7 conflict types.

**(b) Evidence.**
- S3CDA macro-F1: OpenCoss 0.57, WorldVista 0.87, UAV 0.92, PURE 0.90, IBM-UAV 0.71. Zero-shot pairwise LLMs on the same folds: GPT-4o 0.46 to 0.94, Gemini-1.5-pro 0.52 to 0.70, Sonnet-3.5 0.55 to 0.65, GPT-3.5 0.34 to 0.54. Gemini-1.5-pro lost to S3CDA on 4 of 5 datasets. In conflicting pairs, average cosine similarity and entity overlap were both high (functional conflicts 0.85 to 0.97). The authors note that the method "may fail with unit conversions". Source: https://arxiv.org/abs/2206.13690 (Tables V, IX and threats to validity).
- FSARC reports recall of nearly 100% and average precision of 83.88% on four datasets. Source: https://arxiv.org/abs/2103.02255

**(c) Change for this agent.** Generate candidate pairs in code after step 1 and give them to step 3, so the model checks named pairs instead of searching the whole set.
- For each extracted requirement, compute a set of key terms. These are lemmatised nouns from a small domain list or from capitalised and Latin tokens ("push", "порог", "лимит", "amount", "enabled"), numbers with their units, and frequency or period words ("месяц", "раз", "повторно", "каждый", "максимум", "не более").
- Score each pair by term overlap (Jaccard). Give a bonus when one side has a cap ("максимум один", "не более N", "только один раз") and the other has a trigger or override ("повторно", "независимо от", "при изменении", "сбрасывает"). Keep the top 10 to 15 pairs across different sections.
- Add the list to `setPrompt`: "Check each of these pairs explicitly: R7 + R12 (both concern push and period)". Ask for a verdict on each listed pair.
- Expected effect: `f3-vs-f4`. In `docs/requirements.md`, Ф-3 has "push", "порог" and the cap "максимум один". Ф-4 has "порог", "push" and the override "независимо от истории". The pair shares two key terms and gets the cap and override bonus. `jan31-vs-f2` may also pair up when the acceptance row "Покупка 31 января..." is extracted as a requirement, but it shares fewer terms with Ф-2 (only the month concept). Measure with `bun run recall` over several runs.

**(d) Cost.** 0 extra requests. The step 3 prompt grows by about 1 KB.

### 3.3 Grouping by behaviour plus a verifier contract (VeriSpec)

**(a) Method.** VeriSpec extracts rules from a long specification, assigns each rule to behaviour topics, and builds a graph. A semantic edge joins rules on the same topic. A syntactic edge joins rules in the same subsection, with a shared example, or with a cross-reference. VeriSpec then clusters related rules into units of 5 to 26 rules. For each unit, an LLM must report an inconsistency with three parts: a witness (a concrete situation where both rules apply), an unsatisfiability argument (no response satisfies both), and a context-resolution argument (no nearby exception resolves it).

**(b) Evidence.** On the OpenAI Model Spec (405 rules), the work ran 32 units × 5 attempts = 160 requests. These produced 13 candidates, and 5 were validated (precision 38.5%). Baselines:
- Whole-specification prompting, both single-call and agent, found 0 validated inconsistencies from 9 and 16 candidates.
- Grouping by source section found only the one inconsistency whose two rules sat in the same section. It missed the cross-section cases.
- The same units without the witness contract produced 221 candidates at 1.4% precision.
- Unique candidates stopped growing after the fifth attempt.
Source: https://arxiv.org/abs/2610.01847 and code https://github.com/HIPREL-Group/VeriSpec

**(c) Change for this agent.** Two parts, both folded into the existing step 3 request:
- Grouping. Use the candidate pairs or clusters from 3.2 (shared terms) instead of the document's section order. This is the cross-section fix the paper isolates.
- Verifier contract. Extend `SetSchema` for findings with criterion "непротиворечивость". Add a required `witness` field (a concrete sequence of events, for example "порог изменён 10-го, push уже был 3-го") and an `exception_checked` field. Each field quotes the place that would resolve the conflict, or says that no such place exists. In `pipeline.ts`, reject a consistency finding that has an empty witness or fewer than two grounded quotes. It then goes to the appendix like any other rejected finding.
This targets precision of contradiction findings and gives the author a reproducible scenario in the question. VeriSpec used five attempts per unit. The agent cannot afford that, so expect recall gains only from the grouping.

Caveat: VeriSpec ran Claude Opus 5 at high reasoning effort. Gemini Flash may leave the witness empty on a real contradiction. `eval/recall.ts` reads only `findings` and `setFindings`, not the appendix of rejected findings, so a rejection rule can lower measured `f3-vs-f4` recall. Measure that defect's hit rate over several runs before and after. If it drops, lower the severity of witness-less contradictions instead of rejecting them.

**(d) Cost.** 0 extra requests if folded into step 3. A separate verification request per cluster would cost one request per cluster, which the budget cannot cover.

### 3.4 Anchored search instead of open search (ContraDoc, FIND, ContraVis)

**(a) Method.** The model receives a specific statement, or a small neighbourhood of related paragraphs, and is asked what contradicts it. The open alternative asks it to find all contradictions in the document.

**(b) Evidence.**
- ContraDoc has 449 documents, each with one inserted self-contradiction. GPT-4 hit the evidence in 70.2% of documents (GPT-3.5: 42.8%). Numeric contradictions were among the easiest types (GPT-4 87.7%, negation 85.1%). Global contradictions, more than four sentences apart, were not harder than local ones (89.0% vs 63.2%). In a separate, easier task, the model was given one evidence sentence and asked to find the sentence that contradicts it. GPT-4 found 77.2% and GPT-3.5 found 51.6%. These are different tasks with different metrics, so the 7 to 9 point gap is not a controlled ablation. In free-form output without a fixed format, GPT-3.5 found the correct evidence in only 27.8% of cases. Source: https://arxiv.org/abs/2311.09182, data https://github.com/ddhruvkr/CONTRADOC
- FIND inserts expert-written inconsistencies into long financial and technical documents. The best models recovered 64% (gpt-5) and 61% (gemini-2.5-pro), and recall fell as input length grew. On evidence score, gemini-2.5-flash averaged 21, against 32 for gemini-2.5-pro and 33 for gpt-5. This matches the observation in this repo that the cheaper model misses more cross-section contradictions. Numeric inconsistencies are the largest class (204 of 375). Source: https://arxiv.org/abs/2512.18601
- ContraVis tested four contracts of 15 to 55 pages, each with 5 injected contradictions. Standalone LLM recovery dropped to 1 of 5 on the two longest contracts. Giving the model each paragraph's graph neighbourhood (1-hop references plus top-5 semantic neighbours) kept recovery at 3 to 4 of 5. Source: https://arxiv.org/abs/2609.27014 (Table II; small ablation, four documents).

**(c) Change for this agent.** This is the evidence for spending one extra request, and only on contradictions. After step 3, take the top-K candidate pairs from 3.2 that step 3 did not already report as a contradiction. Send one request with only those pairs, each pair's two quotes, and the surrounding section text (not the whole document). Ask for a verdict on each pair with the witness contract from 3.3. This gives the cheaper model the anchored, short-context version of the task, where all three papers show the largest gains. Skip the request when no pair is left, so it costs nothing on clean documents.

**(d) Cost.** +1 request per run, and 0 when every candidate pair was already handled in step 3.

### 3.5 Formalisation and solvers (VERIMED, SAT over a data dictionary)

**(a) Method.** Requirements are translated into logic, through an LLM or a data dictionary. A SAT/SMT solver then checks the formulas for inconsistency.

**(b) Evidence.** VERIMED treats disagreement between independent LLM formalisations of one requirement as an ambiguity signal. Concrete SMT counterexamples raised verified accuracy on a hemodialysis QA benchmark from 55.4% to 98.5%. Source: https://arxiv.org/abs/2605.13817. Yatkın and Ovatman apply a SAT solver to high-level DO-178C requirements that are already structured. They report time savings without precision or recall. Source: https://arxiv.org/abs/2405.00163

**(c) Change for this agent.** Full formalisation is too costly in requests. A small typed slice of it is cheap and covers the unit defect, which all models miss. Section 3.6 describes it.

**(d) Cost.** Full approach: several requests per requirement, not viable. Typed slice: 0.

### 3.6 Typed quantity extraction checked in code (unit and type mismatches)

**(a) Method.** This is the agent-specific combination of 3.2 and 3.5. Code pulls every (term, number, unit, comparator, period) tuple and every declared field type, then compares tuples for the same term.

**(b) Evidence.** No paper evaluates exactly this check. The supporting facts:
- S3CDA reports that embedding and entity methods fail on unit conversions (https://arxiv.org/abs/2206.13690).
- ContraDoc and FIND show that LLMs do best on numeric contradictions once the two places are localised, and worst when they have to search a long document (https://arxiv.org/abs/2311.09182, https://arxiv.org/abs/2512.18601).
- The repo's own runs show that all models miss tiyn vs tenge, even with the unit instruction in `checkPrompt`.

**(c) Change for this agent.** Add `src/quantities.ts`, which runs on the document text and makes no LLM call.
- Use a regex to find money and unit mentions. Money: "тиын", "тенге", "₸", "KZT", "коп". Time: "мс", "сек", "мин", "час", "день", "месяц". Counts: "раз", "шт". For each mention, record the nearest field name or term in the same line, table row or JSON key (`amount`, "сумма покупки", "порог").
- Rule A, mixed money units. If the document uses two money units (tiyn, and tenge or ₸) and no sentence states the conversion ("1 тенге = 100 тиын", "×100"), emit one finding. It quotes the place that names both units, or one place for each unit, with criterion "непротиворечивость" and severity medium. A check for one term carrying two units would not fire on the sample document. There, line 49 stores "сумму покупки в тиынах" and "порог в тенге". These are two different fields in one sentence, and Ф-3 compares them. Rule A fires on that line.
- Rule B, same field with two types. When one field name appears as `integer` or `number` in one table and as `string` in another, report the mismatch with both quotes. In the sample document, `amount` is `integer` at line 143 (request) and `string` at line 156 (response).
- Expected effect: `tiyn-vs-tenge` (Rule A) and `types-mismatch` (Rule B) become deterministic hits in every run. Both rules were checked by reading `docs/requirements.md` and have not been run.

**(d) Cost.** 0 extra requests.

---

## 4. Variance between runs

**(a) Method.** Self-consistency samples several outputs and aggregates them: a majority vote for answers, or the union of findings for recall.

**(b) Evidence.** Self-consistency improved chain-of-thought accuracy by 17.9 points on GSM8K, 11.0 on SVAMP and 12.2 on AQuA (https://arxiv.org/abs/2203.11171). In VeriSpec, new unique inconsistencies kept appearing until the fifth attempt per unit, so a single sample misses part of what the model can find (https://arxiv.org/abs/2610.01847).

**(c) Change for this agent.** A second sample of step 3 with the union taken in code would raise recall on set-level defects. It costs one request and adds near-duplicates that the questions step must merge. The deterministic checks in 2.1, 3.2 and 3.6 lower variance at no request cost, because their findings are identical in every run. Do those first. Take a second step 3 sample only if `bun run recall` over several runs still shows `f3-vs-f4` hit in some runs and missed in others.

**(d) Cost.** +1 request per extra sample.

---

## 5. Datasets and benchmarks

| Dataset | What it contains | Use for this agent | Source |
| --- | --- | --- | --- |
| PURE | 79 public natural-language requirements documents (XML and originals), Ferrari, Spagnolo, Gnesi, RE 2017 | Source documents for injected-defect tests. Many conflict papers sample from it | https://zenodo.org/records/1414117 , https://zenodo.org/records/7118517 |
| PROMISE NFR / PROMISE_exp / Promise+ | Requirements labelled functional vs non-functional subtypes. PROMISE_exp has 444 FR and 525 NFR. This count comes from a third-party repo README, not from the dataset authors (Lima et al.) | Classification only. No defect or conflict labels, so it is of little use here | https://github.com/AleksandarMitrevski/se-requirements-classification , https://zenodo.org/records/12805484 , NoRBERT relabelling https://github.com/tobhey/NoRBERT |
| Conflict pair sets (UAV, WorldVista, PURE, OPENCOSS, CN, CDN) | Requirement pairs labelled conflict or neutral. The open sets are very sparse: UAV 18 conflicts in 6,670 pairs, WorldVista 35 in 10,878, PURE 20 in 2,211, OPENCOSS 10 in 6,786 | Shows that conflicts are rare and that whole-set prompting must not expect many. Too sparse and too English to test this agent | https://arxiv.org/abs/2301.03709 (Table IV), https://arxiv.org/abs/2206.13690 |
| Fazelnia et al. sets | Defect-type set (ambiguous, directive, non-measurable, optional, uncertain, non-atomic) and conflict sets for 7 projects | Defect categories match step 2 criteria | https://arxiv.org/abs/2405.05135 |
| Paska industrial set | 2,725 annotated financial requirements from 13 systems | I could not confirm that the full set is public. The repo has examples only | https://github.com/SNTSVV/Paska |
| ContraDoc | 449 documents with one inserted self-contradiction each, tagged by type and scope | Shows how to build a contradiction test by insertion | https://github.com/ddhruvkr/CONTRADOC |
| FIND | Long documents with expert-inserted inconsistencies (204 numeric, 63 non-numeric, 108 structural) | Same insertion method. Gemini Flash numbers included | https://arxiv.org/abs/2512.18601 |
| TAPHSIR data | Anaphoric ambiguity in requirements | English pronouns only | https://doi.org/10.5281/zenodo.5902117 |

None of these is in Russian or in banking requirements. The most relevant benchmark is the repo's own `eval/requirements.known.ts`. The cheapest way to extend it follows ContraDoc and FIND. Copy `docs/requirements.md` into a few variants, each with one inserted defect: a second unit mismatch, a cap vs re-trigger pair in distant sections, an integer vs string field. Add a `KnownDefect` entry for each variant. Building the variants costs no requests. Running them costs one full run each, so keep 2 or 3 variants and run them only when one of the changes below lands.

---

## 6. Ranked changes for this agent (expected gain per extra request)

Changes that cost no requests rank first. Within that group, the order follows which known defects each change targets and how strong the evidence is.

1. **Typed quantity and field-type check in code (3.6).** 0 requests. It targets `tiyn-vs-tenge` and `types-mismatch`, which every model currently misses. The finding becomes deterministic, so run-to-run variance for these defects drops to zero. The evidence is indirect (S3CDA's stated failure on units, numeric contradictions easy once localised). The direct evidence is this repo's own repeated misses.
2. **Candidate pairs from shared terms, passed into `setPrompt` (3.2 with the grouping half of 3.3).** 0 requests. It targets `f3-vs-f4` and possibly `jan31-vs-f2`. In VeriSpec, section grouping caught only the same-section case and topic grouping caught the cross-section ones. S3CDA beat zero-shot Gemini-1.5-pro on 4 of 5 datasets with similarity and entity overlap. The existing prompt line about rules on the same event shows that an instruction without named pairs is not enough.
3. **Witness contract for contradiction findings, with code-side rejection (3.3).** 0 requests. Without the contract, VeriSpec's precision was 1.4% (221 candidates). With it, precision was 38.5% (13 candidates). This mainly improves precision and the quality of the author question. It does not raise recall, so it ranks below 1 and 2.
4. **Russian smell lexicon (2.1, with the Paska and TAPHSIR triggers from 2.2 and 2.3).** 0 requests. Emit high-precision categories (Smella subjective 0.96, loopholes and non-verifiable 0.70 to 0.81) as findings and low-precision ones as hints. Expected effect: stable single-requirement findings and lower variance. Gain on the current known-defect list is small, because those defects are mostly set-level.
5. **One anchored contradiction request on leftover candidate pairs (3.4).** +1 request, skipped when nothing is left. The case rests mainly on ContraVis (four documents) and FIND. ContraDoc adds only a weak signal: 77.2% for GPT-4 on the easier anchored task, against a 70.2% evidence hit rate on open search, which is a different metric. In ContraVis, recovery stayed at 3 to 4 of 5 with neighbourhood context while the standalone model fell to 1 of 5 on the longest contracts. FIND shows Gemini Flash well below Pro on open search. This is the best use of an extra request if `f3-vs-f4` is still missed after change 2.

Runner-up: a second step 3 sample with a union in code (section 4, +1 request). Use it only if `bun run recall` over several runs still shows the cross-section contradictions appearing in some runs and missing in others.
