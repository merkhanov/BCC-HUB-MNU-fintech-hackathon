# Clarifying questions and the answer loop: research notes

Scope: methods for generating good clarifying questions, LLM support for requirements elicitation, ways to evaluate question quality, and loops that feed answers back into a spec. For each method: (a) what it is, (b) evidence with numbers and the source, (c) what it would change in this agent, (d) cost in extra LLM requests per run.

Every arXiv ID below was checked against its arxiv.org/abs page or the arXiv API on 2026-11-27, and every repository was checked with the GitHub API. Numbers come only from the abstract or from passages of the paper that I read. Where a paper gives no number for a claim, the note says so.

## Baseline this note assumes

I read `src/prompts.ts` (`questionsPrompt`, `answersBlock`), `src/pipeline.ts` (`askQuestions`), `src/answers.ts`, `eval/recall.ts` and README sections 4 and 5.

- Step 4 is one request. It receives every finding as a `FindingBrief` (id, where, criterion, severity, critical, quote, problem, draft question) and returns 8 to 20 questions with `addressee`, `question`, `why`, `options`, `source_ids`.
- The prompt already asks for closed, specific questions with options, merges findings that one answer resolves, and puts critical findings first. Code drops questions without valid `source_ids`, takes places and severity from the findings, sorts by the top severity of the sources, and keeps at most 20.
- An answer is stored as `{question, answer}` text only. On a re-run, `answersBlock` appends all answers to every step 2 batch prompt and to the step 3 prompt. The question ID, its `reqIds` and its source findings are not kept with the answer.
- A run on the 46-requirement sample document costs about 9 requests by my count from `BATCH_SIZE = 8`: 1 extraction, 6 check batches, 1 set check, 1 questions step. The README says a re-run costs the same as the first run.
- The response cache key is a SHA-256 of provider, model, full prompt text and schema (README, "Кэш ответов"). A prompt that is byte-identical to the first run's is served from the cache at 0 requests.
- `eval/recall.ts` matches report findings to 12 known defects of the sample document. It does not look at questions.

Every proposal below is a change from this baseline, not a restatement of it.

## 1. Generating the questions

### 1.1 ClarifyGPT: questions derived from competing interpretations

(a) ClarifyGPT decides that a requirement is ambiguous when several sampled code solutions give different outputs on the same test inputs. It then shows the model one solution from each behaviour cluster and asks it to first analyse what makes the solutions differ and then write targeted questions. Answers are appended to the original requirement as question and answer pairs, and the refined requirement is used for the final generation.

(b) In a study with ten human participants, GPT-4 Pass@1 on MBPP-sanitized rose from 70.96% to 80.80%, a 13.87% relative gain, and on MBPP-ET from 51.52% to 60.19%. The tool asked an average of 2.85 questions for each of the 140 problems it flagged as ambiguous. With simulated answers on four benchmarks, GPT-4 went from 68.02% to 75.75% and ChatGPT from 58.55% to 67.22%. The paper says vague or broad questions "increase the risk of getting off-topic or irrelevant responses". Source: https://arxiv.org/abs/2310.10996. Replication package: https://github.com/ClarifyGPT/ClarifyGPT (its README names the paper).

(c) The detection half (sampling many solutions) does not transfer at this budget. The question half does. Today the model sees a finding and its draft question. Following ClarifyGPT, the prompt would require each question to name the two or three concrete readings of the quoted text, with each option stating what an implementer or tester would build or check under that reading. For a set finding of the contradiction type, the options are side A as quoted, side B as quoted, and "both, under condition X". The agent already stores two quotes for a contradiction, so the options can name both places. Code can check that a question with options has at least two of them and that they are not near-duplicates.

(d) 0 extra requests. This is a prompt change to step 4 and an optional schema field such as `interpretations`.

### 1.2 Interviewer mistake types as a checklist for the question writer

(a) Shen, Singhal and Breaux built a catalogue of 14 common interviewer mistakes from the literature. They then had GPT-4o write follow-up questions in requirements elicitation interviews, either with minimal guidance or with instructions to avoid a given mistake. Raters scored relevancy, clarity and informativeness, which the paper takes from Grice's maxims.

(b) With minimal guidance, the GPT-4o questions were "no worse" than questions from trained human interviewers. With mistake guidance, raters preferred GPT-4o's question in 87 of 128 blind pairs (68.0%). Mean scores on a 1 to 5 scale were 4.4 against 3.5 for relevancy, 4.5 against 3.9 for clarity, and 4.1 against 3.6 for informativeness, with all p-values below 0.05. GPT-4o and a human analyst agreed on 81.0% of 420 mistake classifications. When asked to avoid all 14 mistakes at once, 28 of 30 questions avoided at least 11 and only 1 of 30 avoided all 14. Prompt lessons from the paper: state each mistake positively ("a good question considers alternatives" rather than "does not fail to consider alternatives"), add a one-shot example for the mistake types that scored badly (4 of 14), and capitalise role labels. Source: https://arxiv.org/abs/2507.02858.

(c) Add a short checklist to `questionsPrompt`, phrased positively and limited to the mistakes that apply to a written spec. The paper's own data shows that compliance drops when all 14 are listed. The relevant ones are:
- Ask about tacit assumptions and tacit knowledge that the document leaves implicit, such as units, time zones and who triggers an action.
- Offer alternatives.
- When two places conflict, quote both and ask which one holds.
- Cover one kind of requirement per question.
- Keep jargon out of questions for the `business` addressee.
- Ask about the needed behaviour, not about how to build it.
- Keep the question short.

The 68% preference result is the closest published evidence that this kind of guidance improves questions that humans rate.

(d) 0 extra requests.

### 1.3 CLAMBER: an ambiguity taxonomy and the ways clarifying questions fail

(a) CLAMBER is a benchmark of about 12K queries labelled with a taxonomy of ambiguity types: epistemic misalignment (contradiction, unfamiliar terms), linguistic ambiguity (lexical, semantic) and aleatoric output (missing what, whom, when or where). Humans rate each generated clarifying question as helpful or not. Unhelpful questions are sorted into four failure types: wrong aspect, under-specified, over-specified (asking for something the query already states) and generation error.

(b) The best setting, ChatGPT with few-shot chain-of-thought prompting, scored 53.29 on the binary helpfulness measure, so about half of its questions helped. On self-contradictory queries ChatGPT reached only 38 accuracy and 28.17 F1, and 81.97% of its errors were false negatives, meaning it called a contradictory query unambiguous. In the "aleatoric output" categories, wrong-aspect questions averaged a 52.25% error rate. The authors report that chain-of-thought and few-shot prompting "may result in overconfidence" and give only marginal gains in detecting ambiguity. Human raters reached Krippendorff's alpha above 0.70. Source: https://arxiv.org/abs/2405.12063. Data: https://github.com/zt991211/CLAMBER.

(c) Two uses. First, the four failure types make a ready-made rubric for reviewing the agent's questions offline (section 3). Second, "over-specified" is a failure this agent can partly catch in code. Add a field `already_in_doc` to the question schema. The model fills it with a quote when it thinks the document answers the question elsewhere. Code runs the existing quote search on that quote. The search proves only that the quote exists, not that it answers the question, so three guards are needed:
- Skip the check for contradiction findings, because one side of a contradiction is always in the document.
- Accept the quote only if it lies outside the finding's own `places`.
- Do not drop the question silently. Mark the source finding as a possible false positive in the report and move the question to the end of the list.

This turns a known LLM failure into a signal grounded in the document, in the same way the agent already handles findings.

(d) 0 extra requests.

### 1.4 Choosing questions by expected value or information gain

(a) Rao and Daumé III rank candidate clarifying questions by the expected value of perfect information: a good question is one whose likely answer would make the post most useful. Uncertainty of Thoughts (UoT) simulates possible answers, rewards questions by information gain, and propagates the reward to choose the next question. Active Task Disambiguation frames the choice as Bayesian experimental design, picking questions that most narrow the space of viable solutions. LIPS uses an LLM to propose questions, translates them into programs, and scores their expected information gain by Monte Carlo sampling.

(b) Rao and Daumé built about 77K StackExchange posts paired with clarification questions and evaluated the model against expert judgments on 500 samples, reporting "significant improvements" over baselines. The abstract gives no single headline number. Source: https://arxiv.org/abs/1805.04655. UoT reports a 38.1% average improvement in successful task completion over direct prompting across several LLMs, with fewer questions needed. Source: https://arxiv.org/abs/2402.03271, code at https://github.com/zhiyuanhubj/UoT. Active Task Disambiguation reports that this kind of selection is more effective than reasoning only within the space of questions, without a headline number in the abstract. Source: https://arxiv.org/abs/2502.04485. LIPS reports that a modest Monte Carlo budget gives questions as informative as human ones in its Battleship task. Source: https://arxiv.org/abs/2402.19471. The ceiling for one good question is large: on Qulac, an oracle that asks one good question improves P@1 by more than 170%. Source: https://arxiv.org/abs/1907.06554.

(c) Running a full information-gain search would need many simulated answers for each question and does not fit 20 requests a day. A code-only proxy keeps the idea. `number()` in `askQuestions` sorts by the top severity of a question's sources and cuts at 20. Keep two tiers: questions with a critical source first, then the rest. Inside each tier, rank by top severity and break ties with the summed severity weights of all findings the question resolves. A question that resolves four medium findings then outranks one that resolves a single medium finding. This matters because the cap of 20 drops the tail. Do not let the sum override the tiers, and cap how much the source count can add. Otherwise the model gains rank by packing unrelated findings into one question, which goes against the "one kind of requirement per question" rule in section 1.2. Show the number of findings each question resolves in the questions file, so the author sees why a question comes first.

(d) 0 extra requests.

### 1.5 Closed questions with answer options

(a) Several systems make answering cheap by offering choices. Bing's search clarification panes (the MIMICS data) show a question with up to five candidate answers. TiCoder asks the user yes or no about generated tests, which formalises intent one test at a time. HiddenLens has a layer that produces ranked resolution options, which a human confirms, edits or rephrases before another layer rewrites the requirement.

(b) MIMICS has over 400k queries with clarification panes and click signals. Its 2k-query manual set has graded quality labels for the question, for the set of candidate answers, and for the result page of each candidate. Source: https://arxiv.org/abs/2006.10174. TiCoder (Codex) improved pass@1 by 22.49 to 37.71 absolute points on MBPP and 24.79 to 53.98 on HumanEval with 1 to 5 simulated queries. Source: https://arxiv.org/abs/2208.05950. A follow-up user study with 15 programmers found that participants judged AI code correctly significantly more often and reported significantly lower cognitive load. Across four LLMs, pass@1 rose by an average of 45.97 absolute points within 5 interactions. Source: https://arxiv.org/abs/2404.10100, code at https://github.com/microsoft/TiCoder. HiddenLens reports an end-to-end F1 of 0.79 on 312 requirements annotated with 847 hidden assumptions, 71% and 61% above keyword and QuARS-adapted baselines. Source: https://arxiv.org/abs/2610.29996.

(c) The agent already offers up to 3 options, and `--ask` picks one with a digit. Three refinements follow from these sources. First, make the options mutually exclusive and concrete, so that picking one is a full answer (section 1.1). Second, when the document already states one reading, make that reading option 1 and quote it, so the author can confirm it in one keystroke. Third, for questions that need a value rather than a choice, such as a limit or a deadline, ask for the unit and format in the question, for example "число дней, целое". MIMICS rates the answer set as its own quality dimension, which supports reviewing options as carefully as the question text.

(d) 0 extra requests.

### 1.6 When not to ask

(a) Several studies find that models are bad at deciding whether a question is needed. They either ask too rarely or ask about things that are already clear. For this agent, "when to ask" means deciding which findings need the author at all, because the review step has already decided that there is a defect.

(b) On HumanEvalComm, ChatGPT, CodeLlama and CodeQwen1.5 Chat asked clarifying questions less than 20% of the time on problems that needed them. DeepSeek Coder reached 30.76% and DeepSeek Chat 37.93%. Even with 90% of a description removed, only 54% of responses asked a question. The paper's own agent, Okanagan, "sometimes asked unnecessary questions" on original problems that needed none. Source: https://arxiv.org/abs/2406.00215. Su and Cardie find that models often recognise ambiguity when asked to judge it but rarely ask about it when answering, and that retrieved context widens this gap. Source: https://arxiv.org/abs/2605.25284. On Ambig-SWE, models "struggle to distinguish between well-specified and underspecified instructions", but interaction improves results by up to 74% over the non-interactive setting. Source: https://arxiv.org/abs/2502.13069. Zhang and Choi's intent-sim estimates the entropy over simulated user answers to decide when to ask. When only 10% of examples may be clarified, it doubles the gain of random selection. It needs 10 sampled answers for each input. Source: https://arxiv.org/abs/2311.09469.

(c) Many findings under 830 4.3.7 (modifiability), and many wording issues, can be fixed by the analyst without a decision from the author. Ranking findings (830 4.3.5) are different: importance and stability are business decisions, so they belong in the questions. Asking the author about the analyst's fixes makes the list longer and pushes real decisions past the cap of 20. Add a rule and a schema flag `needs_author: boolean` to step 4. A question needs the author only when the answer is a business, legal, integration or acceptance decision that the document does not settle. Code keeps the other findings in the report with their `fix` and leaves them out of the questions file. The author-facing list gets shorter and every remaining question asks for a decision. The prompt's lower bound ("от 8 до 20") has to go or become "up to 20". Otherwise the model pads the list when the filter leaves fewer than 8 real decisions. The intent-sim style of sampling is not worth its cost here: it would multiply the step 4 requests by the number of samples.

(d) 0 extra requests for the flag. Intent-sim style sampling would cost about S extra requests per run, with S = 10 in the paper, so I do not recommend it.

## 2. LLMs in requirements elicitation

### 2.1 Implicit requirements are what LLM interviewers miss

(a) ReqElicitGym is an evaluation environment with 101 website elicitation scenarios, an oracle user and an automatic evaluator, both of which agree well with real users and experts. Elicitron uses simulated users to surface latent needs. GATE has the model elicit what the user wants by asking open questions or showing edge cases.

(b) Across seven LLMs in ReqElicitGym, models elicited "less than half" of the users' implicit requirements, and their effective questions tended to come late in the dialogue. They handled interaction and content requirements but consistently struggled with style requirements. Source: https://arxiv.org/abs/2602.18306. In GATE's preregistered experiments, open questions and synthesised edge cases elicited responses that were often more informative than user-written prompts or labels, and users reported that it took less effort. Source: https://arxiv.org/abs/2310.11589. Elicitron reports that its simulated interviews found more latent needs than conventional human interviews. Its abstract gives no count. Source: https://arxiv.org/abs/2404.16045.

(c) The agent's questions come only from findings, so implicit requirements surface only if step 3 reports a completeness gap. Two cheap changes follow. First, the "tacit assumptions" item from section 1.2 makes step 4 phrase completeness findings as questions about the missing decision, for example "who resets the counter, and when?", rather than "please add details". Second, GATE's edge-case technique fits the options. For a vague rule, one option can be a concrete edge case, for example "a payment created on the 31st of a 30-day month", and the author says how the system should behave. Edge cases are also what QA needs for acceptance criteria.

(d) 0 extra requests.

### 2.2 LLM-generated clarification questions for real requirement texts

(a) Several RE papers apply LLMs to defects in real requirement texts. KC et al. detect ambiguous and incomplete open-source feature requests and generate clarification questions. Lubos et al. have an LLM assess requirements against ISO/IEC/IEEE 29148 characteristics, explain its decision and propose improved versions, and they validate this with software engineers. Nair and Anish simulate stakeholders with novice, intermediate and expert knowledge bases to detect pragmatic ambiguity.

(b) KC et al. compare their output with human annotations and interview GitHub developers. The abstract gives no headline number. Source: https://arxiv.org/abs/2507.13555. Lubos et al. report a study with software engineers and no headline number in the abstract. Source: https://arxiv.org/abs/2408.10886. Nair and Anish report that GPT-4o-mini reached a macro-averaged recall of 0.75 and an F2 of 0.75 for detecting pragmatic ambiguity on two PURE documents. Source: https://arxiv.org/abs/2607.04436.

(c) These papers confirm the agent's design: findings first, then questions, with ISO 29148 criteria named. They add no new question technique beyond what sections 1.1 to 1.6 cover. Nair and Anish's idea of readers with different expertise maps onto the existing `addressee` field. One cheap use is to have step 4 phrase each question for its addressee: business wording for `business` and technical wording for `architect`.

(d) 0 extra requests.

## 3. Evaluating question quality

### 3.1 Metrics and rubrics that exist

(a) Papers use three kinds of measure. The first is rates: how often the model asks when it should (Communication Rate) and the share of its questions labelled Good (Good Question Rate). The second is human rubrics: binary helpfulness plus a failure type (CLAMBER), and relevancy, clarity and informativeness on a 1 to 5 scale with blind pairwise comparison (section 1.2). The third is downstream effect: how much the task output improves after the answers (Pass@1 in ClarifyGPT and TiCoder, P@1 in Qulac).

(b) HumanEvalComm labels each response Good (it recovers all the missing information), Fair or Bad. Its LLM evaluator "tends to label more good questions that should have been labelled fair/bad", and prompt variants move Good Question Rate more than the other metrics. The authors call this a sign that the metric is unreliable. Its False Recovery Rate (the simulated answerer leaking the missing information even when no relevant question was asked) was 30% to 40% for several models. Source: https://arxiv.org/abs/2406.00215, code at https://github.com/jie-jw-wu/human-eval-comm. ClarifyCoder, from the same group, reports a 63% Communication Rate and a 52% Good Question Rate after fine-tuning. Source: https://arxiv.org/abs/2504.16331. ClarifyCodeBench proposes a Turn-discounted Key Question Rate that penalises inefficient questioning, and finds that clarification quality "degrades sharply as the density of ambiguities increases". Source: https://arxiv.org/abs/2607.00711. In legal intake triage, Steenhuis and Harvey found that "LLM-as-judge and human ratings diverge" when scoring questions. Source: https://arxiv.org/abs/2606.00272. AGENT-CQ uses several LLM instances as a simulated crowd to judge clarifying questions on ClariQ. Source: https://arxiv.org/abs/2410.19692. On the general reliability of LLM judges, MT-Bench reports over 80% agreement between GPT-4 and human preferences on chat answers. That result is about answers, not questions. Source: https://arxiv.org/abs/2306.05685.

(c) Add a question metric to `eval/` that needs no model.
- Key-defect coverage: for each of the 12 known defects, check whether at least one question cites, through `source_ids`, a finding that `recall()` already matches to that defect. A report that finds 11 of 12 defects but asks about only 6 of them shows a gap in step 4, and this metric shows it.
- Question precision proxy: the share of questions whose sources match at least one known defect. This measure is weak, because the 12 defects are not exhaustive. Still, a falling share warns that questions are drifting to minor issues.
- Write a short human rubric file for the team: per question, helpful yes or no and, if no, the CLAMBER failure type (wrong aspect, under-specified, over-specified, format). Optionally add the 1 to 5 relevancy, clarity and informativeness scores. One person can score 20 questions in a few minutes, and the result is a number the jury can read in the README.

The ClarifyCodeBench density result is a warning for this document. It has more than 50 findings, so asking the model to cover all of them in one step 4 request is the hard case. The value ordering in section 1.4 and the `needs_author` filter in section 1.6 both lower the density the model has to handle.

(d) 0 requests per run. An LLM judge for every run would cost +1 request and, by the HumanEvalComm and legal-triage results, would overrate questions. If one is used, use it offline with a model other than the generator, and check it against the human rubric first.

## 4. Feeding answers back and re-checking

### 4.1 Append answers to the requirement (what the agent does now)

(a) ClarifyGPT appends each question and answer pair to the requirement and generates again (section 1.1). This agent does the same at the document level: `answersBlock` appends all answers to every step 2 and step 3 prompt.

(b) The numbers in section 1.1 support this design. Its limit is cost. Every batch prompt changes when any answer exists, so every request misses the cache.

(c) This is a baseline, not a change. See 4.2.

(d) The current re-run costs about 9 requests, the same as the first run.

### 4.2 Localised re-check: re-check only what the answers touch

(a) VeriSpecGen splits natural-language intent into atomic requirements, keeps a traceability map from each test back to its requirement, and when validation fails, repairs only the clauses the failure points to. ClarifyGPT refines only the requirements it flagged as ambiguous.

(b) VeriSpecGen reaches 86.6% on the VERINA SpecGen task with Claude Opus 4.5, up to 31.8 points above baselines. Source: https://arxiv.org/abs/2604.10392. ClarifyGPT: see section 1.1.

(c) Keep each answer's question ID, `reqIds` and source finding labels in `<report>.answers.md`. They are on `Question` at run time, but the questions file does not write them and `Answer` holds only the question and answer text, so the answers file has to start carrying them. On a re-run, pass an answer only to the step 2 batches that contain one of its `reqIds`. Keep passing all answers to step 3, because answers can affect the whole set. Batches that no answer touches then have byte-identical prompts and come from the cache, and step 1 already does. If five answers touch requirements in two of six batches, the re-run costs 2 + 1 + 1 = 4 requests instead of 9. This needs the first run's cache, so it does not help after `--no-cache` on another machine. The `--ask` prompt that says "это ещё ~N запросов" can then show the real count.

(d) Saves requests: about minus 5 for the example above. The exact saving depends on how many batches the answers touch.

### 4.3 Measure what each answer closed

(a) ClarifyGPT, TiCoder and Ambig-SWE all report the effect of the answers as a before and after difference on the same tasks. TiCoder reports it per number of interactions. A requirements re-check can report the same thing per answer.

(b) The numbers are in sections 1.1, 1.5 and 1.6. Eliciting Specifications (Allaham et al.) shows why the effect has to be measured rather than assumed. On 189 Lean specification tasks with budgets of 3 and 10 questions, the pipeline that used the same model (Claude Sonnet 4.6) as elicitation agent and as formaliser had negative strict pass@1 estimates at both budgets. The best pipeline, with a different formaliser model, gained 6.3 points and reached 65.6%. The authors conclude that elicitation "is not a uniform accuracy booster". Source: https://arxiv.org/abs/2610.22382.

(c) With the question ID and its source findings saved (section 4.2), the re-run can report what each answer did. A naive comparison of findings across runs would be confounded. The README reports that finding counts vary by up to 25% between runs on the same model, so a finding missing from a re-sampled batch may be closed or may be noise. Two ways around this:
- Preferred: add a `closed` array to the step 2 and step 3 output schemas, for example `{question_id, criterion}`. The model then states which answer closed which defect. Code checks that each `question_id` exists and that the answer targeted that requirement. The report prints "ответы закрыли X из Y находок" and lists answers that raised a new defect.
- Cheaper but weaker: compare by `reqId` and criterion, and label a missing finding "больше не найдено" rather than "закрыто", with the caveat in the report.

Batches served from the cache (section 4.2) have no run-to-run variance, which makes either comparison cleaner. To test the loop, write the answers for the sample document's 12 known defects by hand rather than having Gemini simulate them. HumanEvalComm's False Recovery Rate of 30% to 40% for several models shows that a simulated answerer can leak information the question never asked for, which would inflate the measured effect.

(d) 0 extra requests for the closure report, with a few more output tokens for the `closed` field. Testing with human-written answers costs one targeted re-run, done once offline.

### 4.4 Rewrite the requirement from the confirmed answer

(a) HiddenLens has the human confirm, edit or rephrase a resolution option, then rewrites the requirement into an "explicit, testable, and traceable" one. Mircea et al. had an LLM revise stakeholders' requirement statements and asked the stakeholders to rate the revisions.

(b) HiddenLens: see section 1.5. In Mircea et al., 26 participants produced 130 requirement statements. They rated the LLM revisions significantly higher than their own originals on alignment with intent, readability, reasoning and unambiguity. Source: https://arxiv.org/abs/2601.16699.

(c) In the re-run's step 2, for each requirement that has an answer, ask for a field `revised_text`: the requirement rewritten to include the answer. The report then shows the author a ready replacement line next to each closed finding. Step 2 already returns a `fix` text, so this adds an output field, not a request.

(d) 0 extra requests, with somewhat more output tokens per affected batch.

## 5. GitHub projects that implement parts of this

All of these were checked through the GitHub API.

- https://github.com/ClarifyGPT/ClarifyGPT. Replication package for ClarifyGPT: consistency check, question prompt, answer simulation.
- https://github.com/microsoft/TiCoder. Test-driven interactive clarification with yes or no queries, plus a benchmarking harness.
- https://github.com/jie-jw-wu/human-eval-comm. HumanEvalComm benchmark and its LLM evaluator for Communication Rate and Good Question Rate.
- https://github.com/zt991211/CLAMBER. CLAMBER data with the ambiguity taxonomy.
- https://github.com/zhiyuanhubj/UoT. Uncertainty of Thoughts: question selection by simulated information gain.
- https://github.com/heyjoonkim/APA. Code for "Aligning Language Models to Explicitly Handle Ambiguity" (https://arxiv.org/abs/2404.11972), a fine-tuning approach that does not apply to an API-only agent.

None of them targets a requirements document. The prompts and metric definitions in the first three are the parts worth copying.

## 6. Methods I do not recommend at this budget

- Sampling-based ambiguity detection (ClarifyGPT's consistency check, intent-sim, or the stochastic formalisations in VERIMED at https://arxiv.org/abs/2605.13817). Each needs several samples per requirement or per question, so it would cost 5 to 10 times the step 4 or step 2 budget.
- Choosing the next question with an LLM after each answer in `--ask`, as UoT, Qulac and GATE do. This costs +1 request per answered question.
- Fine-tuning to ask better questions, as in STaR-GATE (https://arxiv.org/abs/2403.19154), ACT (https://arxiv.org/abs/2406.00222) and ClarifyCoder. The agent uses a hosted model on the free tier.
- An LLM judge on every run. This costs +1 request and would overrate questions (section 3.1).

## 7. Ranked list: the 5 most promising changes

Ranked by expected gain per extra request. All five cost 0 extra requests per run or save requests, so the order follows expected gain on the jury criterion "asks the right clarifying questions", then ease of building.

1. Options built from competing interpretations, plus a short positive checklist of interviewer mistakes in `questionsPrompt`. Each option is one concrete reading with its effect on implementation or testing. For contradictions, the options are side A, side B, or both under a condition. When the document states one reading, that reading is option 1. The checklist covers tacit assumptions, alternatives, explicit handling of contradictions, one requirement kind per question, no jargon for `business`, and no solution questions. Evidence: ClarifyGPT (2310.10996), mistake-guided questions preferred in 68% of pairs (2507.02858), TiCoder's lower cognitive load (2404.10100). Cost: 0. This is the most visible improvement to the questions themselves.
2. Fewer and better-targeted questions. Add `needs_author` so that wording and modifiability fixes stay in the report and leave the questions file, and relax the minimum of 8 questions so the model does not pad the list. Add `already_in_doc` with a quote that code verifies, skipping contradictions and quotes from the finding's own places, and flag the finding instead of dropping the question silently. Evidence: CLAMBER's over-specified failure type (2405.12063), Okanagan's unnecessary questions (2406.00215), ClarifyCodeBench's density result (2607.00711). Cost: 0. Uses the existing quote search.
3. Save the question ID, `reqIds` and source findings with each answer, then use them twice. First, re-check only the step 2 batches that the answers touch and take the rest from the cache. Second, have steps 2 and 3 return a `closed` list, so the report states per answer which findings it closed ("ответы закрыли X из Y") without confusing closure with run-to-run noise. Evidence: localised repair in VeriSpecGen (2604.10392), before and after measurement in ClarifyGPT and TiCoder. Cost: saves requests, about 4 instead of 9 in the example in 4.2. This changes the README's claim that a re-run costs as much as the first run, and it gives the answer loop a measured result.
4. Value ordering in code. Keep critical questions as the first tier, and inside each tier break ties by the summed severity of all findings a question resolves, with a cap so that packing findings into one question does not pay. Show that count in the questions file. Evidence: EVPI ranking (1805.04655), information-gain selection (2402.03271, 2502.04485). Cost: 0. Small code change in `number()`.
5. A question metric in `eval/`: key-defect coverage by questions, a precision proxy, and a short human rubric (CLAMBER failure types, optionally relevancy, clarity and informativeness from 1 to 5). Test the answer loop once with human-written answers for the 12 known defects, because a simulated answerer can leak information (HumanEvalComm's False Recovery Rate). Evidence: HumanEvalComm's metrics and its warning about LLM judges (2406.00215), human and LLM-judge divergence (2606.00272), and the finding that elicitation gains are not guaranteed (2610.22382). Cost: 0 per run, plus one targeted re-run done once offline. This turns "the agent asks the right questions" into a number in the README.

Next in line: `revised_text` for answered requirements (section 4.4, 0 requests, extra output tokens) and edge-case options for vague rules (section 2.1, 0 requests).
