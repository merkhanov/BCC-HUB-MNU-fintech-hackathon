# Russian-language resources for requirements quality checks

Scope: Russian standards, Russian vague-word lists, papers on NLP for Russian requirements, and Russian morphology tooling for Bun. Every URL below returned HTTP 200 to a check on 2026-11-27, except two kinds, which are marked where they appear. docs.cntd.ru did not respond, and npmjs.com pages block scripted requests, so npm facts come from registry.npmjs.org. The word lists in sections 1.4, 2.1 and 2.2 were checked against raw page or PDF text with grep, not against a model summary. Claims I could not confirm are marked unverified.

The repo state this was checked against: `src/rules.ts` (uncommitted) already runs zero-request `codeChecks(text)` from `src/pipeline.ts:332`, and the prompts in `src/prompts.ts` are written in Russian.

## 1. Standards

### 1.1 Russian adoption of ISO/IEC/IEEE 29148: none found

I found no GOST R that adopts ISO/IEC/IEEE 29148. Evidence:

- A search for the exact designation "ГОСТ Р ИСО/МЭК/IEEE 29148" returned zero results.
- ПНСТ 841-2023 (a 2023 Russian preliminary standard on AI quality evaluation) cites the international document directly in its bibliography, entry [4]: "ISO/IEC/IEEE 29148:2018 Программная и системная инженерия. Процессы жизненного цикла. Разработка требований". That is consistent with there being no national adoption as of November 2023, but it does not prove it. https://meganorm.ru/mega_doc/norm/pnst_predvaritelnyj-nacionalnyj-standart/0/pnst_841-2023_ISO_IEC_DTS_25058_predvaritelnyy_natsionalnyy.html
- ГОСТ Р 56713-2015 sometimes appears next to 29148 in Russian lecture slides. According to catalog search results (not opened), it adopts ISO/IEC/IEEE 15289:2011, the standard on the content of life-cycle information items. It is not a 29148 adoption.
- The FGBU "Институт стандартизации" catalog record for ISO/IEC/IEEE 29148:2018 (https://www.gostinfo.ru/catalog/Details/?id=6439527) returned "Неправильный запрос" to my fetch, so I could not check it for a harmonized national document.
- Do not confuse it with ГОСТ Р 70921-2023, which covers SQuaRE quality requirements and is based on ISO/IEC 25030 (search result only, not opened in full), or with ГОСТ Р 57100, which covers architecture description (ISO/IEC/IEEE 42010).

Conclusion: no GOST R number for 29148 was found, so none is given here. The Russian title used in the Russian literature is "Программная и системная инженерия. Процессы жизненного цикла. Разработка требований". The report can use that title when it cites 29148. It should not cite a GOST R number for 29148.

Use in the agent: `src/criteria.ts` line 1 already cites ISO/IEC/IEEE 29148:2018 and IEEE 830. No change is needed. If the report shows Russian standard names, add the Russian title above, but no GOST number.

### 1.2 ГОСТ 34.602-2020 (technical assignment for an automated system)

What it is: "ГОСТ 34.602-2020. Информационные технологии. Комплекс стандартов на автоматизированные системы. Техническое задание на создание автоматизированной системы". In force in Russia from 2022-01-01 (Rosstandart order 19.11.2021 N 1522-ст). It replaced ГОСТ 34.602-89 and references ГОСТ 19.201.
- Full text: https://meganorm.ru/mega_doc/norm/gost_gosudarstvennyj-standart/0/gost_34_602-2020_mezhgosudarstvennyy_standart.html
- Card with status: https://meganorm.ru/Index/76/76009.htm

It has no list of forbidden words, but it does name the quality characteristics of a requirement. Clause 3.4, verbatim from the meganorm text:

> Требования должны обладать следующими характеристиками: единичность, непротиворечивость, актуальность, выполнимость, проверяемость, однозначность. Требования по возможности должны быть максимально детализированы.

These six map onto the 29148 individual criteria the agent already checks: единичность is `singular`, непротиворечивость is set-level `consistent`, выполнимость is `feasible`, проверяемость is `verifiable`, однозначность is `unambiguous`. Актуальность (being current) has no exact 29148 counterpart; `necessary` is the closest. This is the only Russian national standard I found that lists requirement quality characteristics.

Clause 5.3 is the only wording rule that a code check can use (verbatim):

> 5.3 Значения показателей, норм и требований указывают, как правило, с предельными отклонениями или максимальным и минимальным значениями. ... Если конкретные значения показателей, норм и требований не могут быть установлены в процессе разработки ТЗ на АС, в нем следует сделать запись о порядке установления и согласования этих показателей, норм и требований: "Окончательное требование (значение) уточняется... и согласовывается ...".

The second sentence of clause 3.4 uses the loophole phrase "по возможности" itself, so the phrase is common in Russian specs and a lexicon will meet it often.

Use in the agent:
- `src/rules.ts` `emptyValues()` already treats "уточняется" as a placeholder. Under 5.3, "уточняется ... и согласовывается" is the sanctioned way to defer a value. The rule's `fix` text can name the 5.3 wording: state who agrees the value and when. A sentence that says "уточняется" with no "согласов" is the real gap. Zero requests.
- `src/criteria.ts` can add "ГОСТ 34.602-2020, 3.4" to the `source` of `singular`, `feasible`, `verifiable` and `unambiguous`, and of set-level `consistent`. A Russian bank reviewer will recognize that citation. Zero requests.
- The criterion text for `verifiable` can also cite 5.3: a numeric requirement needs a tolerance or a min/max. A code check for a bare number next to a quality word ("время отклика 2 секунды" with no "не более") is possible but noisy. I would not build it without measuring it on more documents.

### 1.3 ГОСТ 19.201-78 (ЕСПД, technical assignment for a program)

What it is: "ГОСТ 19.201-78. Единая система программной документации. Техническое задание. Требования к содержанию и оформлению". It sets the sections of a program TZ (2.4: functional characteristics, reliability, operating conditions, hardware, compatibility, marking, transport, special requirements). It has no wording rules or forbidden words. https://www.swrit.ru/doc/espd/19.201-78.pdf

Use in the agent: only as a completeness checklist of section names for the `complete` set criterion. That fits a spec in the GOST style, not the bank's template in `docs/requirements.md`. Low value here.

### 1.4 ГОСТ Р 2.105-2019 (ЕСКД, general requirements for text documents): the one official Russian word list

This standard has the closest thing to an official list of words for Russian technical texts. It belongs to ЕСКД (design documentation). ГОСТ 34.602-2020 does not reference it; its only normative reference is ГОСТ 19.201. So it applies to a software TZ by analogy only, as the general Russian rule for technical text. Text checked against the PDF at https://guap.ru/standards/db/docs/GOST_R_2.105-2019.pdf (also at https://ecotvet.ru/npa/gost/GST_R_2_105-2019; docs.cntd.ru/document/1200164120 did not respond).

Clause 5.2.2, verbatim:

> Текст документа должен быть кратким, четким и не допускать различных толкований.
> При изложении обязательных требований в тексте применяют слова: "должен", "следует", "необходимо", "требуется", "разрешается только", "не допускается", "запрещается", "не должен", "не следует", "не подлежит", "не могут быть" и т.п. При изложении других положений применяют слова: "могут быть", "как правило", "при необходимости", "допускается", "разрешается" и т.п.

Clause 5.2.3 forbids colloquial phrases, "техницизмы, профессионализмы", and "для одного и того же понятия различные научно-технические термины, близкие по смыслу (синонимы), а также иностранные слова и термины при наличии равнозначных слов и терминов в русском языке". It also forbids arbitrary word formation, non-standard abbreviations, and abbreviated units used without numbers.

Clause 5.2.4 forbids, outside formulas and tables, "математические знаки величин без числовых значений, например > (больше), < (меньше), = (равно), ... а также знаки № (номер), % (процент)".

Use in the agent, all zero requests:
- The 5.2.2 split gives a Russian modal-verb rule with an official source. The mandatory set ("должен", "следует", "необходимо", "требуется", "не допускается", "запрещается", "не должен") marks a binding requirement. The non-binding set ("могут быть", "как правило", "при необходимости", "допускается", "разрешается") marks a provision that is not binding. A sentence the extractor labels a requirement that uses only the second set is a weak requirement, the Russian counterpart of "may/should" in IEEE 830. Put it in `src/rules.ts` as a rule with criterion `unambiguous` or `verifiable`. The current `CodeFinding.criterion` type is `SetCriterion`, so this per-sentence rule needs either a widened type or a mapping to a set criterion.
- The 5.2.3 synonym rule supports a terminology-consistency finding for the `consistent` or `comprehensible` set criterion. A cheap code version would compare a small hand list of known synonym pairs in banking specs, for example "клиент/пользователь" or "порог/лимит". Without such a list this needs the model.
- The 5.2.4 rule is a regex: a comparison sign or "%" with no number beside it.

### 1.5 Official list of forbidden or vague words in Russian TZ

I found none beyond ГОСТ Р 2.105-2019 5.2.2 and 5.2.3. A search for a list of forbidden words in a TZ, including 44-ФЗ procurement TZ guides (Kontur, Tochka), found only general advice to give measurable indicators, with no word list.

## 2. Russian vague-word lists with actual words

### 2.1 Timoshchuk 2020, Proceedings of ISP RAS (peer reviewed, Russian requirements)

Е.В. Тимощук, "Оценка качества требований к программному обеспечению с применением метода GQM и инструментов обработки естественного языка", Труды ИСП РАН 32(2), 2020, pp. 15-28, DOI 10.15514/ISPRAS-2020-32(2)-2, CC BY 4.0.
- Page: https://ispranproceedings.elpub.ru/jour/article/view/1280
- PDF (English text with Russian examples): https://ispranproceedings.elpub.ru/jour/article/download/1280/1071

What it does: metrics for ambiguity, singularity, subjectivity, completeness and readability on Russian requirements. The author translated the English dictionaries of the OpenReq quality service into Russian and ran them through that service. Ambiguity is computed as 1 minus the share of ambiguous words in the requirement. The paper reports no precision or recall.

Table 1 gives these Russian examples (copied from the PDF):

| Type | Russian examples |
|---|---|
| Quality | 'лучший', 'самый', 'подходящий', 'адекватный' |
| Subjectivity | 'легкий в использовании' |
| Quantity | 'примерно', 'несколько', 'немного' |
| Frequency | 'почти всегда', 'обычно', 'как правило' |
| Persistency | 'долго', 'больше', 'прочный', 'сиюминутного' |
| Probability | 'возможно', 'если это возможно', 'вряд ли' |
| Open listings | 'и так далее' |
| Position / size | 'близко', 'больше', 'падение', 'далеко', 'короткий', 'небольшой', 'огромный' |
| Comparative phrases | 'лучше, чем', 'выше качество', 'то же, что' |
| Loopholes | 'если возможно', 'соответствующие', 'в качестве применимого' |
| Weak adverb or adjective | 'по желанию', 'наконец', 'либо', 'в конечном счете', 'если уместно', 'если желательно', 'в случае', 'если необходимо' |

Caveat: these are machine-style translations of English lists, and some are wrong. 'падение' stands for English 'tall'. 'в качестве применимого' is a calque of 'as applicable'. 'больше' appears twice. Take only the entries that read as natural Russian.

The paper cites two Russian sources on requirement quality indicators that I could not open: К.И. Гайдамака, "Характеристики и индикаторы качества требований для русскоязычной инженерной среды", ТРИС-2017, pp. 80-85; and В.К. Батоврин, К.И. Гайдамака, "Некоторые особенности оценки характеристик требований к системам", Информатизация и связь, 2017, no. 4, pp. 191-196. Unverified beyond the citation.

### 2.2 Radzishevskiy 2025, Habr (practitioner guide, based on 29148 and the INCOSE rule numbering)

А. Радзишевский, "Проектирование Информационных систем. Часть 10. Разработка требований 10.1. Правила формирования требований", Habr, 2025-06-25. https://habr.com/ru/articles/921622/

This is a practitioner article, not a peer-reviewed source. Its keywords name ISO 29148, and the article does not mention INCOSE. Its rule numbers and names (R7 vague terms, R8 escape clauses, R9 open-ended clauses) match the INCOSE Guide to Writing Requirements; that match is my own observation. It is the most complete list I found in natural Russian. Verbatim from the raw HTML:

> R7 - Неточные термины.
> Следует избегать наречий: несколько; любой; допустимо; сколько-нибудь; много; большое количество; мало; почти всегда; очень близко к; приблизительно; около; близко к; почти.
> Следует избегать прилагательных: дополнительный; актуальный; обыденный; общий; типовой; важный; гибкий; расширяемый; типичный; достаточный; адекватный; пригодный; эффективный; эффектный; качественный; разумный; общепринятый.
>
> R8 - Снятие ответственности.
> Не использовать слова, размывающие ответственность: насколько это возможно; как можно меньше; где возможно; как можно больше; если это необходимо; при необходимости; по мере необходимости; сообразно обстоятельствам; как требуется; в рамках целесообразного; если это осуществимо.

> R9 - Открытые формулировки. В формулировках следует избегать: «включая, но не ограничиваясь», «и так далее», «и тому подобное».

### 2.3 Not found

I found no Russian translation of the Wiegers ambiguous-terms table that I could open. I found no other Russian requirements-smell lexicon, and no Russian port of Smella or of the Femmer smell list.

## 3. Papers on NLP for Russian requirements and Russian NLI

- **Timoshchuk 2020** (section 2.1). The only peer-reviewed Russian requirements-smell paper with word lists that I found. It has no recall or precision numbers.
- **Гайдамака К.И., candidate dissertation, 2024, МИРЭА.** "Модели и алгоритмы интеллектуальной поддержки принятия решений при контроле качества требований к сложным техническим системам", 162 pp. https://www.dissercat.com/content/modeli-i-algoritmy-intellektualnoi-podderzhki-prinyatiya-reshenii-pri-kontrole-kachestva-tre . The page states the work covers quality control of single requirements and of requirement sets "на предмет наличия дублирований и противоречий" on real Russian projects. It reports that the algorithms raise the effectiveness of quality control by 20% for single requirements and 6% for sets. The methods, models and word lists were not visible to me. This is the closest Russian work to duplicate and contradiction detection. Unverified beyond the summary page.
- **Russian SuperGLUE** (Shavrina et al., EMNLP 2020). It includes two Russian NLI tasks, TERRa and RCB. https://aclanthology.org/2020.emnlp-main.381/ and https://arxiv.org/abs/2010.15925 . These are general-domain datasets, not requirements.
- **MERA** (Fenogenova et al., ACL 2024). A Russian benchmark for generative LLMs: 21 tasks, private scoring. https://aclanthology.org/2024.acl-long.534/ and https://arxiv.org/abs/2401.04531 . General capability, not requirements.

### Do LLMs behave differently on Russian?

Yes, in the measured cases, though on older models. No source covers Gemini or requirements text.
- Etxaniz et al. 2023, "Do Multilingual Language Models Think Better in English?" https://arxiv.org/abs/2308.01223 . Their Table 7 reports few-shot XNLI accuracy. For LLaMA 30B: English 47.9, Russian direct 38.2, Russian after the model translates the input to English itself 47.3. For XGLM 7.5B: English 53.9, Russian 46.3, self-translate 50.0. The abstract concludes that models "are unable to leverage their full multilingual potential when prompted in non-English languages".
- Huang et al. 2023, "Not All Languages Are Created Equal in LLMs" https://arxiv.org/abs/2305.07004 . It reports that performance "varies substantially across different languages", and that a cross-lingual prompt template adds over 10 points on average on arithmetic reasoning and open-domain QA.

Use in the agent: these papers measure base models from 2022 and 2023, not Gemini Flash. They support two cheap steps. Keep the zero-request Russian checks, because they do not depend on how well the model handles Russian. Treat "write the instructions in `src/prompts.ts` in English while quotes stay Russian" as a hypothesis that `eval/recall.ts` would have to confirm. That test costs about 10 requests per run, so run it only if the daily budget allows.

## 4. Russian morphology from TypeScript or Bun

I installed and ran each package under Bun in a scratch directory, not in the repo. The test words were "удобного", "достаточного", "своевременного", "необходимости", "возможности" and others.

| Package (npm registry metadata) | Latest version and date | Result under Bun | Notes |
|---|---|---|---|
| `snowball-stemmers` (https://registry.npmjs.org/snowball-stemmers, repo https://github.com/mazko/jssnowball) | 0.6.0, 2016-02-01 | Works. "удобный/удобного/удобным" all give "удобн". "необходимость/необходимости" both give "необходим". | ISC. Not updated since 2016, but the Snowball Russian algorithm is fixed, so age matters little. |
| `natural` (https://registry.npmjs.org/natural, repo https://github.com/NaturalNode/natural) | 8.2.6, 2026-10-26 | Works through `PorterStemmerRu`. It is inconsistent: "необходимости" gives "необходимост" but "необходимость" gives "необходим". "возможности" gives "возможност". | MIT, actively released. Large dependency for one stemmer. |
| `@nlpjs/lang-ru` (https://registry.npmjs.org/@nlpjs/lang-ru) | stable 4.26.1, 2023-01-12; latest tag 5.0.0-alpha.5, 2025-01-23 | `StemmerRu` gives the same stems as Snowball on every test word. | MIT. |
| `az` (Az.js, https://registry.npmjs.org/az, repo https://github.com/deNULL/Az.js) | 0.2.3, 2016-06-16 | Works. It is a real lemmatizer with part of speech: "удобного" gives "удобный" ADJF, "необходимости" gives "необходимость" NOUN, "своевременно" gives ADVB. | MIT. Based on pymorphy2 dictionaries (https://github.com/pymorphy2/pymorphy2). Dictionaries take 11 MB on disk and load asynchronously. Unmaintained since 2016. |

Measured on `docs/requirements.md`: a Snowball-stemmed lexicon of about 60 candidate words and 23 phrases matched only "в случае" (5 times), "безопасный" (2), "возможно" (1), "все" (1), "необходимый" (1) and "может быть" (1). Every hit is a false positive. "в случае" occurs in the descriptions of HTTP status codes. "может быть" and "все" occur in the template's review checklist rows (lines 77 and 81). "возможно" is a stem collision: Snowball maps the noun "возможность" (line 23, "Дать клиенту возможность") to the same stem as the hedge adverb "возможно". None of the 12 defects in `eval/requirements.known.ts` is a vague-word defect. On this spec, a lexicon rule adds no recall. Its value is on other documents the judges may run.

Recommendation: add no dependency. `src/rules.ts` already matches word stems with hand-written prefixes such as `/(сохран|созда|измен|удал|обнов|запис)\p{L}*/iu`. A Russian lexicon fits the same style. Single words become a prefix plus `\p{L}*` (for example `достаточн\p{L}*`). Hedges whose stem collides with a common noun ("возможно", "обычно") become exact word forms bounded by non-letters. Multi-word phrases become fixed strings with `\s+` between words. Two filters keep precision up: skip the review-checklist table and the status-code descriptions, the way `emptyValues()` already treats tables. If a stemmer is still wanted, `snowball-stemmers` is the smallest and was consistent on every test word. Use `az` only if part-of-speech matters, and it costs 11 MB.

## 5. Proposed Russian vague-word list (33 entries)

Source tags:
- [G2105] ГОСТ Р 2.105-2019, clause 5.2.2, list of words for non-binding provisions (section 1.4).
- [T20] Timoshchuk 2020, Table 1 (section 2.1).
- [H25] Radzishevskiy 2025, Habr, rules R7, R8, R9 (section 2.2).

"Match" is how to match the entry in `src/rules.ts`. "prefix" means a stem plus `\p{L}*`. "exact" means the whole word form, bounded by non-letters. "phrase" means the words in order with `\s+` between them.

| # | Entry | Category | Match | Source |
|---|---|---|---|---|
| 1 | при необходимости | escape clause | phrase | [G2105] [H25] |
| 2 | по мере необходимости | escape clause | phrase | [H25] |
| 3 | если (это) необходимо | escape clause | phrase | [H25] [T20] |
| 4 | насколько это возможно | escape clause | phrase | [H25] |
| 5 | где возможно | escape clause | phrase | [H25] |
| 6 | если (это) возможно | escape clause | phrase | [T20] |
| 7 | как можно больше / как можно меньше | escape clause | phrase | [H25] |
| 8 | как требуется | escape clause | phrase | [H25] |
| 9 | если это осуществимо | escape clause | phrase | [H25] |
| 10 | по желанию | escape clause | phrase | [T20] |
| 11 | как правило | non-binding, frequency | phrase | [G2105] [T20] |
| 12 | допускается | non-binding modal | exact | [G2105] |
| 13 | разрешается (without "только") | non-binding modal | exact | [G2105] |
| 14 | может быть / могут быть | non-binding modal | phrase | [G2105] |
| 15 | и так далее / и т.д. | open-ended | phrase | [T20] [H25] |
| 16 | и тому подобное / и т.п. | open-ended | phrase | [H25] |
| 17 | включая, но не ограничиваясь | open-ended | phrase | [H25] |
| 18 | несколько | vague quantity | exact | [T20] [H25] |
| 19 | много / большое количество | vague quantity | exact / phrase | [H25] |
| 20 | мало / немного | vague quantity | exact | [H25] [T20] |
| 21 | около / приблизительно / примерно | vague quantity | exact | [H25] [T20] |
| 22 | почти / почти всегда | vague quantity, frequency | exact / phrase | [H25] [T20] |
| 23 | обычно | frequency | exact | [T20] |
| 24 | возможно (adverb only, not "возможность") | probability | exact | [T20] |
| 25 | вряд ли | probability | phrase | [T20] |
| 26 | достаточн- | vague adjective | prefix | [H25] |
| 27 | адекватн- | vague adjective | prefix | [H25] [T20] |
| 28 | эффективн- | vague adjective | prefix | [H25] |
| 29 | гибк- | vague adjective | prefix | [H25] |
| 30 | разумн- | vague adjective | prefix | [H25] |
| 31 | качественн- | vague adjective | prefix | [H25] |
| 32 | подходящ- / пригодн- | vague adjective | prefix | [T20] [H25] |
| 33 | лучш- / самый (superlative) | superlative | prefix / exact | [T20] |

Entries left out on purpose:
- "в случае" [T20]: 5 hits in `docs/requirements.md`, all false positives.
- "любой", "дополнительный", "актуальный", "общий", "типовой", "важный" [H25]: these words are often neutral in bank specs, and "любой" often states a deliberate universal. Add them only after checking precision on more documents.
- "либо", "наконец" [T20]: the first is a coordination word (a singularity signal, not vagueness). The second is rare in specs.
- "по возможности": it is natural Russian and ГОСТ 34.602-2020 itself uses it, but none of the three sources lists it verbatim. It is a reasonable addition to the escape-clause family. Mark it as unsourced if added.
- "быстро", "удобно", "интуитивно понятный", "своевременно", "оптимальный": common subjective words in Russian specs, but none of the three sources lists them in Russian. Smella's English list has the English equivalents. Add them under a "translated from Smella" tag if wanted.

How the rule would report a hit, in the style of `src/rules.ts`: quote the sentence with `sentenceWith()`. Tag escape clauses, open-ended phrases and non-binding modals as `unambiguous` or `verifiable`. Give a fix that asks for a number, a bound or a closed list. The `topic` regexp is the matched word, so a model finding about the same word suppresses the code finding. Zero LLM requests.
