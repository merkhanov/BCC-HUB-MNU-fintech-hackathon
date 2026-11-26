# Agent architecture, reliability and evaluation for the requirements review agent

Research date: 2026-11-27. Every arXiv ID and GitHub repository below was opened during this research. Numbers come from the cited paper's abstract, tables or text. Where a paper's own table and text disagree, both values are given.

## 0. Baseline this report prices against

The submitted report (`reports/requirements.report.json`, model `gemini-3.6-flash`) has 46 requirements and a passport that records 8 calls: 1 extraction, 6 check batches (46 / 8 rounded up) and 1 set check. The questions step adds 1 more, so a clean run is 9 requests and about 10 with retries. On a free tier of 20 requests per model per day this gives the following prices:

| Kind of change | Extra requests per run |
| --- | --- |
| Code only (regex, index, schema field, post-processing) | 0 |
| One extra call per run (one more pass over the whole document or over all findings) | 1 to 2 |
| One extra call per check batch | about 6 |
| One more full sample of the whole pipeline (self-consistency over the whole run) | about 9 to 10, half the daily quota |

The last row rules out naive self-consistency over the whole pipeline. Only the variants in section 2 fit the budget.

### Which known defects are of which kind

I ran `bun run eval/recall.ts reports/requirements.report.json` (no API calls). It finds 11 of 12. The README records a Flash-Lite run that found 7 of 12 and missed `tiyn-vs-tenge`, `f3-vs-f4`, `jan31-vs-f2`, `no-version` and `acceptance-gaps`. Sorting the 12 defects in `eval/requirements.known.ts` by what it takes to find them:

| Defect id | Kind | Could code find or localize it? |
| --- | --- | --- |
| `get-saves` | HTTP method vs. action name (`saveLimit`, REST type GET) | Yes: method field vs. verb in URL and description |
| `save-vs-read` | Description vs. requirements wording | Partly: needs the model |
| `error-in-200` | Status code vs. result value (200 with `ERROR`) | Yes: status code table vs. `result` enum |
| `404-in-403` | Status code inside the wrong section | Yes: section heading code vs. codes mentioned in its body |
| `f3-vs-f4` | Rule ID vs. rule ID | Localize only: both rules share the topic "push" and "порог" |
| `jan31-vs-f2` | Acceptance criterion vs. rule Ф-2 | Localize only: criterion mentions a date, Ф-2 defines the month |
| `tiyn-vs-tenge` | Unit mismatch (line 49: "сумму покупки в тиынах ... порог в тенге") | Yes: unit index. Missed by both Flash and Flash-Lite |
| `types-mismatch` | Field type in request table vs. response table | Yes: field name index across tables |
| `json-without-body` | Content-Type vs. "Тело не используется" | Yes: header value vs. body statement |
| `no-prod-url` | Empty field ("Prod: —") | Yes: empty-value detection |
| `no-version` | Empty version/date, unchecked checklist | Yes: empty fields and `[ ]` |
| `acceptance-gaps` | Rules not covered by acceptance criteria | Partly: which Ф-n IDs no criterion references |

Nine of 12 are contradictions between entities (units, numbers, HTTP methods, status codes, field types, rule IDs) or empty fields. Four of the five Flash-Lite misses are in that group. This is the main reason the ranking at the end puts code-side entity checks first.

## 1. Multi-agent designs for requirements engineering, and debate

### 1.1 MARE and other role-based RE frameworks

**(a) What it is.** MARE splits requirements engineering into elicitation, modeling, verification and specification, with five agents, nine actions and a shared workspace where agents post intermediate artifacts. Agent4RE adds two self-refinement loops to a pipeline of specialized agents. Both target generating requirements, not reviewing an existing document.

**(b) Evidence.**
- MARE reports requirements models that are 15.4% more correct than the state of the art on five public cases, one dataset and four new cases ([arXiv:2405.03256](https://arxiv.org/abs/2405.03256)).
- Agent4RE variants beat a domain-context-augmented prompting baseline by an average of 8% on text-based metrics over 8 LLMs, and by about 0.8 points on a four-point human and LLM-judge scale ([arXiv:2610.10628](https://arxiv.org/abs/2610.10628)).
- OpenRE-Bench reimplements MARE and iReDev under one harness because, in its authors' words, such frameworks "are typically evaluated on their own runtimes, metrics, and small sets of curated system descriptions" ([arXiv:2611.13925](https://arxiv.org/abs/2611.13925)).
- An attribution study on PROMISE NFR+ (625 requirements, three 7B to 8B models) finds the F1 gain over a single call comes from a two-call variant with specialized prompts (up to +0.075 F1). Adding a validated typed state between agents adds only -0.003 to +0.013 F1, significant in one of six comparisons ([arXiv:2610.31280](https://arxiv.org/abs/2610.31280)).

**(c) Change to this agent.** None of these papers measures defect-finding precision on a finished SRS. The usable lesson from 2610.31280 is that the gain comes from a second, specialized call, not from agent roles. This agent already has specialized calls (per-requirement checks and a set check) and a zod-validated typed state, which that paper finds adds little accuracy but stops out-of-range outputs at the boundary. Adding roles would not target any of the known misses.

**(d) Cost.** A role pipeline over this document would add at least one call per role per batch, so 6 or more requests per role. Not recommended.

### 1.2 Multi-agent debate (MAD)

**(a) What it is.** Several model instances answer, read each other's answers and revise over rounds, then a final answer is chosen by vote or consensus ([arXiv:2305.14325](https://arxiv.org/abs/2305.14325)).

**(b) Evidence.**
- MAD applied to requirements classification (functional vs. non-functional) raised F1 from 0.726 to 0.835 with n=0 and 0.841 with n=1. The paper defines n=0 as "no interaction between debaters" (independent debaters plus a judge) and n=1 as one round of interaction, so almost all of the gain came before any debate happened. Tokens grew from 160,839 to 1,521,643 and 3,043,286, and cost from 0.43 EUR to 6.98 EUR and 14.41 EUR (Tables II and III of [arXiv:2507.05981](https://arxiv.org/abs/2507.05981)).
- "Debate or Vote" splits MAD into majority voting and debate across seven benchmarks and finds that "majority voting alone accounts for most of the performance gains typically attributed to MAD". The authors prove that debate alone is a martingale over the agents' belief in the right answer, so it does not raise expected correctness ([arXiv:2508.17536](https://arxiv.org/abs/2508.17536), code at [deeplearning-wisc/debate-or-vote](https://github.com/deeplearning-wisc/debate-or-vote)).
- "Should we be going MAD?" benchmarks debate protocols on seven QA datasets and finds they "do not reliably outperform" self-consistency and ensembling. Medprompt, which does not debate, performs best overall at lower cost ([arXiv:2311.17371](https://arxiv.org/abs/2311.17371)).
- "Voting or Consensus?" changes only the decision protocol: voting is +13.2% on reasoning tasks and consensus +2.8% on knowledge tasks. More discussion rounds before voting reduce performance ([arXiv:2502.19130](https://arxiv.org/abs/2502.19130)).

**(c) Change to this agent.** Skip debate. Where several samples exist, use a vote over them (section 2), which the three papers above credit with most of the gain.

**(d) Cost.** Debate needs at least 2 agents times (1 + rounds) calls per unit of work. For the check step that is 12 or more extra requests. Not viable on this quota.

## 2. Self-consistency and voting across samples

**(a) What it is.** Sample several answers to the same prompt and keep the one most answers agree on. For free-form outputs, a model or a similarity rule picks the most consistent answer. Disagreement between samples is also a signal that an item is unreliable.

**(b) Evidence.**
- Self-consistency over chain-of-thought samples: GSM8K +17.9%, SVAMP +11.0%, AQuA +12.2%, StrategyQA +6.4%, ARC-challenge +3.9% ([arXiv:2203.11171](https://arxiv.org/abs/2203.11171)).
- Universal self-consistency lets the LLM pick the most consistent of several free-form answers and matches standard self-consistency on math ([arXiv:2311.17311](https://arxiv.org/abs/2311.17311)).
- "More Agents Is All You Need": accuracy scales with the number of sampled agents under sampling and voting, and the gain grows with task difficulty ([arXiv:2402.05120](https://arxiv.org/abs/2402.05120)).
- SelfCheckGPT: statements that diverge across stochastic samples are more likely hallucinated. It beats grey-box baselines on sentence-level AUC-PR ([arXiv:2303.08896](https://arxiv.org/abs/2303.08896)).
- VERIMED uses disagreement between independent LLM formalizations of the same requirement, checked by SMT equivalence, as a test for ambiguity ([arXiv:2605.13817](https://arxiv.org/abs/2605.13817)).
- Caution for variance: the INCOSE requirements-quality benchmark ran 100 independent runs at five temperatures and found the error profile "shifts only modestly" with temperature ([arXiv:2609.03230](https://arxiv.org/abs/2609.03230)). That result concerns detection and false-flag rates. It does not show that lowering temperature fixes run-to-run differences in finding count, so do not rely on temperature for that.

**(c) Change to this agent.** Two variants fit the budget.
1. **Vote across saved reports, 0 new requests, for development and evaluation only.** A script can align findings from N runs by grounded location (start/end offsets from `Grounder.find`) plus criterion, and tag each finding with how many runs produced it. Findings seen in 1 of N runs are the unstable ones behind the 10 to 25 percent variance. This is not a runtime fix. `reports/` holds one report today, and a user who runs the CLI once on a new document has no earlier runs. The answer cache is keyed by provider, model, prompt and schema (`cacheKey` in `src/llm.ts`), so re-running the same document returns the cached answers and yields no new sample. Use it on runs that happen anyway during development, with the cache bypassed or keyed by run, to find which criteria and prompts produce unstable findings.
2. **Sample only the set step twice, +1 request.** The set step is where cross-section contradictions are found and where Flash-Lite lost `f3-vs-f4` and `jan31-vs-f2`. Take the union of grounded findings for recall, or the intersection for a stable "high agreement" tier. This is the self-consistency setting applied to the one call where misses cluster. The second call needs a sample index in its cache key, or it is a cache hit and returns the first answer.

**(d) Cost.** Variant 1: 0 new requests, but it needs runs that happen anyway. Variant 2: +1 per run. Full self-consistency over the pipeline: +9 to 10 per sample, ruled out.

## 3. Verifier or critic pass over findings

**(a) What it is.** A second model call receives the candidate findings and keeps or rejects each one. It works when the verifier must produce specific evidence. It fails when it is a bare "re-check your answer" prompt.

**(b) Evidence.**
- **BitsAI-CR (ByteDance code review).** RuleChecker finds issues, then ReviewFilter, a separate fine-tuned LLM, answers yes or no per comment. In Table 2 ("Only RuleChecker" vs. "With ReviewFilter"), overall precision goes from 57.03% to 65.59% and recall falls from 45.50% to 39.77%. The paper's text gives different values for the same ablation ("from 54.50% to 67.12%"). On 400 extra samples, a "Conclusion-First" output pattern (decision token first, then reasoning) reached 77.09% precision and 69.00% recall at a 55.25% filter rate and 1.7 s per sample. Reasoning-First had 81.80% recall but took 31 s per sample ([arXiv:2501.15134](https://arxiv.org/abs/2501.15134)). These are filter-stage metrics from fine-tuned models, not end-to-end results from a prompted model.
- **VeriSpec (inconsistencies in the OpenAI Model Spec).** Rules are extracted, clustered by topic, then an LLM verifier must give a witness situation, an unsatisfiability argument and a context-resolution argument before it may report a conflict. This cut candidates from 221 to 13 and raised precision from 1.4% to 38.5%. The two baselines that read the whole specification reported 9 and 16 candidates and none survived manual validation. Their recurring failure was reporting an apparent tension "while missing a nearby exception that resolves the pair" ([arXiv:2610.01847](https://arxiv.org/abs/2610.01847), code at [HIPREL-Group/VeriSpec](https://github.com/HIPREL-Group/VeriSpec)).
- **Chain-of-Verification.** The model plans verification questions and answers them independently of the draft. Precision on Wikidata list questions more than doubled, from 0.17 to 0.36 (Llama 65B), and FActScore on biographies rose from 55.9 to 71.4 ([arXiv:2309.11495](https://arxiv.org/abs/2309.11495)).
- **Counter-evidence.** Without external feedback, LLMs "struggle to self-correct" reasoning and sometimes get worse ([arXiv:2310.01798](https://arxiv.org/abs/2310.01798)). In CR-Bench, a Reflexion loop that pushes the agent to find more bugs raised GPT-5.2 recall from 27.01% to 32.76% but dropped its signal-to-noise ratio from 5.11 to 1.95. For GPT-5-mini the SNR fell from 2.89 to 0.91 ([arXiv:2603.11078](https://arxiv.org/abs/2603.11078)). That smaller-model collapse is the closest evidence available for what a "look harder" loop would do on Flash-Lite.

**(c) Change to this agent.** Keep the decision in code, as the agent already does for grounding and criticality.
1. **Schema field, 0 requests.** Add to the check and set schemas a required field such as `checked_context`: the quote of the nearest passage that could resolve the problem, plus why it does not. Code grounds that quote with `Grounder.find` like any other. This copies VeriSpec's "context-resolution argument" into the existing calls. It targets the grounded-but-wrong class where the model sees a tension but misses the exception that resolves it.
2. **Batched verifier, 1 to 2 requests.** One call receives all grounded findings (57 in the submitted report) with their quotes and the full document. For each one it returns `keep` or `reject`, decision first (BitsAI-CR's Conclusion-First pattern). A `reject` counts only if it comes with a counter-quote that `Grounder.find` locates and that differs from the finding's own quotes. A reject without a grounded counter-quote is ignored, and the finding stays. Rejected findings move to the existing `rejected` list with the counter-quote, so a reader can audit them. Measure it against the 11 known hits before turning it on by default: a verifier that drops one known hit has a measured cost.
3. Do not add a "find what you missed" loop. CR-Bench shows it trades precision for recall, worst on the smaller model.

**(d) Cost.** Schema field: 0. Batched verifier: 1, or 2 if the findings plus document exceed what one answer can cover.

## 4. LLM-as-judge with rubrics, and confidence calibration

**(a) What it is.** An LLM grades outputs against a rubric, or the model reports its own confidence per answer. Agent pipelines use either to rank or filter.

**(b) Evidence.**
- Strong LLM judges reach over 80% agreement with human preferences, the same level as agreement between humans. The paper also documents position, verbosity and self-enhancement biases ([arXiv:2306.05685](https://arxiv.org/abs/2306.05685)).
- Verbalized confidence is overconfident across five LLMs. Consistency among multiple responses and better aggregation reduce the overconfidence, but no technique consistently beats the others and all struggle on tasks that need professional knowledge ([arXiv:2306.13063](https://arxiv.org/abs/2306.13063)).
- On requirements quality against an INCOSE expert ground truth, the best model detected a median of 47% of expert issues while false-flagging 11%. Necessity and correctness issues were "almost always missed", and newer model generations were not always better ([arXiv:2609.03230](https://arxiv.org/abs/2609.03230)).
- In a study with software engineers, an LLM assessed requirements against ISO 29148 characteristics and explained its decisions; participants then judged whether they agreed and whether the explanation was plausible ([arXiv:2408.10886](https://arxiv.org/abs/2408.10886)).

**(c) Change to this agent.** Do not add a model-reported confidence score and do not let it drive criticality. Criticality is already computed in code, which avoids the overconfidence problem. If a per-finding reliability tier is wanted, derive it from code-side signals: run agreement (section 2), whether the finding passed the verifier (section 3), and whether its quote contains the entities its problem text names (section 5). An LLM judge is useful only offline, as a cheaper stand-in for human labels in evaluation (section 7), and only after checking it against human labels on this document.

**(d) Cost.** Code-side tiers: 0. A runtime judge would be another per-run call (+1) with no evidence of gain over the verifier.

## 5. Grounding and citation verification

**(a) What it is.** Each output claim carries a pointer to source text, and a checker confirms that the pointer exists and that the text supports the claim. The agent already does the first half with normalized exact matching in `src/ground.ts`.

**(b) Evidence.**
- ALCE (citation benchmark): even the best models lacked complete citation support 50% of the time on ELI5 ([arXiv:2305.14627](https://arxiv.org/abs/2305.14627)).
- LongCite trains models to give sentence-level citations in long-context QA and introduces the LongBench-Cite benchmark ([arXiv:2409.02897](https://arxiv.org/abs/2409.02897)).
- FActScore splits output into atomic facts and scores the share supported by a source. Its automated estimator has under 2% error against human FActScore ([arXiv:2305.14251](https://arxiv.org/abs/2305.14251)).
- MiniCheck: a 770M-parameter fact checker reaches GPT-4 accuracy on the LLM-AggreFact grounding benchmark at 400x lower cost ([arXiv:2404.10774](https://arxiv.org/abs/2404.10774), [Liyan06/MiniCheck](https://github.com/Liyan06/MiniCheck)). It is an English model, so it would need testing on Russian text.
- **google/langextract** ([repo](https://github.com/google/langextract), Python). Every extraction is aligned to character offsets in the source. Extractions that cannot be located get `char_interval = None`, and the README advises filtering them out. `resolver.py` tries an exact token match first, then an LCS-based fuzzy window with default threshold 0.75 and minimum density 1/3. Results are labeled `MATCH_EXACT`, `MATCH_LESSER`, `MATCH_GREATER` or `MATCH_FUZZY`. The README also uses `extraction_passes=3` ("improves recall through multiple passes") with small chunks (`max_char_buffer=1000`).
- TypeScript options for approximate span matching: [robertknight/approx-string-match-js](https://github.com/robertknight/approx-string-match-js) ("fast approximate string matching library for JavaScript", TypeScript) and [google/diff-match-patch](https://github.com/google/diff-match-patch), whose match function finds a fuzzy location of a pattern in text.

**(c) Change to this agent.**
1. **Claim-quote consistency check, 0 requests.** Grounding proves that the quote exists. It does not prove that the quote supports the problem. Cheap code check: extract the entities named in the finding's `problem` text (HTTP methods, status codes, numbers, units, field names, rule IDs such as `Ф-3`) and require that each one appears in at least one of the finding's grounded quotes, or in the requirement it is attached to. A finding that says "200 with ERROR" but quotes only a passage without 200 or ERROR goes to `rejected` or to a "weak evidence" tier. This is the FActScore idea applied with a regex instead of a model.
2. **Record a match level, 0 requests.** Copy langextract's labels. `Grounder.find` already distinguishes a single exact fragment from an ellipsis match of several fragments. Report the level per finding, and optionally add a fuzzy fallback (approx-string-match-js) labeled `fuzzy` that never counts as fully grounded. This keeps findings whose quote has one PDF hyphenation glitch, while still marking them.
3. Keep the hard rule that a finding without any located quote is rejected. ALCE and the langextract README both treat unlocated citations as failures.

**(d) Cost.** 0 for all three. MiniCheck would also cost 0 LLM requests but adds a Python model runtime to a Bun CLI, so it does not pay off here.

## 6. Long documents and cross-section reasoning

**(a) What it is.** Choose between giving the model the full document, chunking it, or first extracting structured facts with code or a model and then reasoning over small focused groups of those facts.

**(b) Evidence.**
- Models use information at the start and end of a context best and degrade "significantly" when the relevant passage is in the middle ([arXiv:2307.03172](https://arxiv.org/abs/2307.03172)).
- RULER adds multi-hop tracing and aggregation tasks to needle-in-a-haystack. Of 17 models that claim 32K or more context and score nearly perfectly on the plain needle test, only half keep satisfactory performance at 32K ([arXiv:2404.06654](https://arxiv.org/abs/2404.06654)).
- NoCha: true/false claims about books that need global reasoning. No open-weight model beat chance and GPT-4o reached 55.8%. Models did much better when a claim needed only sentence-level retrieval ([arXiv:2406.16264](https://arxiv.org/abs/2406.16264)).
- Chain of Agents processes long input in segments with worker agents and a manager agent, so each call sees a short context ([arXiv:2406.02818](https://arxiv.org/abs/2406.02818)).
- VeriSpec (section 3): grouping rules by document section missed cross-section conflicts, and checking all pairs of 405 rules would mean over 80,000 pairs. Clustering by topic gave the best precision and the lowest cost per validated inconsistency, 11.12 USD against 15.82 USD for the next baseline ([arXiv:2610.01847](https://arxiv.org/abs/2610.01847)).
- FSARC detects conflicts between functional requirements with an eight-tuple semantic model and heuristic rules, with recall near 100% and 83.88% average precision on four datasets ([arXiv:2103.02255](https://arxiv.org/abs/2103.02255)).
- Paska detects requirement smells with NLP rules and reached 89% precision and recall on 2,725 annotated requirements from 13 systems in the financial domain ([arXiv:2305.07097](https://arxiv.org/abs/2305.07097)).
- An industrial two-stage workflow first extracts verifiable rules from natural-language requirements, flagging ambiguity and self-contradiction, then checks against those rules. The authors present the structured intermediate form as their way to reduce hallucination, output variability and context loss ([arXiv:2605.17926](https://arxiv.org/abs/2605.17926)).

**(c) Change to this agent.** Build an entity index in code after loading the document, before any LLM call. The issued document is 13.5 KB of Markdown with tables, so regexes over tables and lines cover most of it:
- **Units and amounts.** Every mention of `₸`, `тенге`, `тиын`, `KZT`, with the field or sentence it belongs to. Rule: one quantity (purchase amount, threshold) stored or compared in two units is flagged. This targets `tiyn-vs-tenge`, which both models missed (line 49 of `docs/requirements.md`).
- **Fields.** For each field name (`amount`, `enabled`, `cardId`), its type, length and range in every table where it appears. Rule: the same name with a different type across request and response tables. Targets `types-mismatch`.
- **HTTP facts.** The method, Content-Type, the "body not used" statement, status codes per section heading and status codes mentioned in each section's body. Rules: GET with a mutating action name (`save`, `create`, `update`); JSON Content-Type with no body; a section headed 403 whose body names 404; a success code paired with `result: ERROR`. Targets `get-saves`, `json-without-body`, `404-in-403`, `error-in-200`.
- **Empty and unchecked values.** `—`, empty table cells, `[ ]` checkboxes, unfilled version and date. Targets `no-prod-url`, `no-version`.
- **Rule IDs.** Every `Ф-n` definition and every place that references it. Rule: an `Ф-n` that no acceptance criterion references is a coverage gap. Targets part of `acceptance-gaps`.
- **Topic clusters for the model.** Group requirements and rules that share entities (for example Ф-3 and Ф-4 both name "push" and "порог"; the 31 January criterion and Ф-2 both concern the month of a purchase). Pass these clusters into the existing set prompt as "check these groups against each other", instead of leaving the model to find pairs in the whole document. Targets `f3-vs-f4` and `jan31-vs-f2`, the two cross-section defects Flash-Lite lost.

Index hits can feed the report in two ways. A deterministic rule with a quote from the index becomes a finding directly, grounded by construction and marked as found by code. A softer hit becomes a hint inside the set prompt. Keep the set step on the full document as well, so the index adds focus and removes nothing.

The rules must be generic patterns, not strings from this document: GET with a mutating verb in the action name, one quantity in two units, one field name with two types, a section heading code that differs from the code in its body. The unit list above (`₸`, `тенге`, `тиын`) is an example of a general unit table that would also hold currencies, time units and sizes. Because the rules were designed by reading the 12 known defects, a recall gain on `recall.ts` is guaranteed in advance and proves nothing. Their value has to be confirmed on a second requirements document, or on defects held out from the rule design.

**(d) Cost.** Index and deterministic rules: 0. Clusters injected into the existing set prompt: 0. A separate cross-check call per cluster group: +1 for one batched call over all clusters, more if split.

## 7. Evaluation methodology

**(a) What it is.** Measure an agent against gold annotations with precision, recall and run-to-run stability, and check the gold itself with agreement between annotators.

**(b) Evidence and tools.**
- The INCOSE requirements-quality benchmark is a direct template: an expert-derived ground truth, 100 independent runs per model, and reporting of median detection rate and false-flag rate rather than single runs ([arXiv:2609.03230](https://arxiv.org/abs/2609.03230)).
- CR-Bench reports precision, recall and F1, plus a usefulness rate and a signal-to-noise ratio (useful findings vs. noise), and uses an LLM judge to match agent comments to known bugs ([arXiv:2603.11078](https://arxiv.org/abs/2603.11078)).
- BitsAI-CR adds a production proxy, the Outdated Rate: the share of flagged code that developers later changed ([arXiv:2501.15134](https://arxiv.org/abs/2501.15134)).
- LLM judges reach about 80% agreement with humans, equal to human-human agreement, but show position and verbosity biases ([arXiv:2306.05685](https://arxiv.org/abs/2306.05685)).
- [MantisAI/nervaluate](https://github.com/MantisAI/nervaluate) computes entity-level precision and recall with strict, exact, partial and type matching (SemEval 2013 scheme). The same idea fits matching a finding's quote span to a gold span.
- Harnesses: [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) (TypeScript, prompt and agent tests with assertions, runs from a config file), [UKGovernmentBEIS/inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai) (Python evaluation framework), [confident-ai/deepeval](https://github.com/confident-ai/deepeval) (Python, pytest-style LLM metrics), [openai/evals](https://github.com/openai/evals) (Python framework and benchmark registry).

**(c) Change to this agent.** `eval/recall.ts` measures recall only. Nothing in the repo measures the grounded-but-wrong problem.
1. **Label precision once, 0 requests.** Label each of the 57 findings in the submitted report as true positive, false positive or duplicate. Store the labels next to `requirements.known.ts`, keyed by grounded offsets and criterion so they carry over to future runs. If a second person labels the same 57, compute Cohen's kappa to see how subjective the false-positive calls are.
2. **Extend `recall.ts`.** Report precision against the labels, an SNR in the CR-Bench sense (true findings divided by false ones), and run-to-run overlap: Jaccard similarity of the sets of (grounded location, criterion) pairs across all reports in a directory. Unlabeled new findings are listed for labeling, not counted as errors.
3. **Report medians over runs.** Because a single run varies by 10 to 25 percent, compare a change on the median of several runs. The answer cache makes re-scoring old runs free. New runs cost the normal 9 to 10 requests each. Three runs per arm is about 30 requests, which is 1.5 days of one model's quota. Comparing two arms takes about 3 days, or 1.5 days if the baseline runs already exist.
4. promptfoo is the only harness above written in TypeScript. It is worth adopting only if the team wants prompt regression tests in CI. The extended `recall.ts` covers what is needed now with no new dependency.

**(d) Cost.** 0 requests for labeling and the script. Each evaluation run costs one normal run.

## 8. Ranked list: the 5 most promising changes by expected gain per extra request

1. **Entity index with deterministic cross-section rules (section 6). 0 extra requests.** Its rules target 8 of the 12 known defects directly, including `tiyn-vs-tenge`, which both models missed. Flash already finds 7 of those 8, so on Flash the gain is `tiyn-vs-tenge` plus findings that are identical across runs. The larger gain is on the Flash-Lite fallback. The rules must be generic patterns, and their value must be confirmed on a document or defects not used to design them (section 6). Of the five Flash-Lite misses, the rules cover `tiyn-vs-tenge` and `no-version` and part of `acceptance-gaps`, and the topic clusters it builds feed change 4 for the other two. Code findings are grounded by construction and identical across runs, so they also reduce variance. Evidence: VeriSpec (whole-document detection found nothing valid, topic clustering did), FSARC (83.88% precision with rule-based conflict detection), Paska (89% precision and recall in finance), NoCha and RULER (models are weak at global reasoning over long input).
2. **Precision labels and an extended `recall.ts` (section 7). 0 extra requests.** It makes the false-positive problem and run variance measurable, which is required before turning on changes 3 to 5, since each of them can cost recall. Evidence: the INCOSE benchmark and CR-Bench protocols.
3. **Claim-quote consistency check plus a `checked_context` field in the existing schemas (sections 3 and 5). 0 extra requests.** It targets grounded-but-wrong findings: a quote that exists but does not contain what the problem claims, or a tension that the document resolves nearby. Evidence: VeriSpec's context-resolution requirement (precision from 1.4% to 38.5%), FActScore's atomic support check, ALCE's 50% unsupported citations.
4. **Topic clusters fed into the set step, and the set step sampled twice with a vote (sections 2 and 6). +1 request.** It targets the cross-section misses (`f3-vs-f4`, `jan31-vs-f2`) and the instability of set findings. Union of the two samples raises recall on the fallback model, and agreement gives a stable tier. Evidence: self-consistency (+3.9 to +17.9 points), "Debate or Vote" (voting carries most of the multi-agent gain), VeriSpec clustering.
5. **Batched verifier with a grounded counter-quote (section 3). +1 to 2 requests.** It targets the remaining false positives after change 3. Code honors a reject only with a located counter-quote, and the change ships only if the labels from change 2 show higher precision with all 11 known hits kept. Evidence: BitsAI-CR (precision from 57.03% to 65.59% in its Table 2, recall from 45.50% to 39.77%), VeriSpec, CoVe. Counter-evidence that sets the guard: 2310.01798 on intrinsic self-correction, and CR-Bench's SNR collapse from 2.89 to 0.91 on a smaller model.

Not recommended on this quota: multi-agent debate and role pipelines (6 or more extra requests, with the gain credited to voting or to a second specialized call), full-pipeline self-consistency (9 to 10 requests per extra sample), Reflexion-style "find more" loops (lower SNR, worst on small models), and model-reported confidence scores (overconfident, and criticality is already computed in code).
