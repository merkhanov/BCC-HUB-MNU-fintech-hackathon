/**
 * Defects of docs/requirements.md that a reviewer finds by reading the document. This list is only for
 * measuring the agent: the prompts never see it. A finding counts for a defect when one of its quotes
 * matches `where` (the place in the document) and its problem or fix text matches `about`.
 */
export interface KnownDefect {
  id: string;
  title: string;
  where: RegExp;
  about: RegExp;
}

export const KNOWN: KnownDefect[] = [
  {
    id: "get-saves",
    title: "Метод сохранения порога описан как GET",
    where: /REST type|GET|curl -G|Тело не используется|saveLimit/i,
    about: /GET[\s\S]{0,160}(сохран|измен|мутир|POST|PUT|PATCH)|(сохран|измен|мутир|POST|PUT|PATCH)[\s\S]{0,160}GET/i,
  },
  {
    id: "save-vs-read",
    title: "Description: сохранение порога, но в требованиях чтение порога",
    where: /Сохранение порога|чтение порога|читает и сохраняет/i,
    about: /чтени|читает|прочит/i,
  },
  {
    id: "error-in-200",
    title: "Ответ 200 с result ERROR при неверной сумме, хотя для неверных параметров есть 400",
    where: /ERROR|\b200\b|\b400\b|Successful/i,
    about: /(200[\s\S]*(ERROR|ошибк))|((ERROR|ошибк)[\s\S]*200)/i,
  },
  {
    id: "404-in-403",
    title: "В разделе 403 сказано, что возвращается 404",
    where: /403|404|чужой карты/i,
    about: /(403[\s\S]*404)|(404[\s\S]*403)/,
  },
  {
    id: "f3-vs-f4",
    title: "Ф-3 (один push в месяц) противоречит Ф-4 (push после смены порога независимо от истории)",
    where: /Ф-3|Ф-4|максимум один|независимо от истории|Изменение порога сохраняет/i,
    about: /(один[\s\S]{0,40}push|Ф-3|Ф-4)[\s\S]*(противореч|конфликт|несовмест|неясно|не определ|не указ)|(противореч|конфликт|несовмест)[\s\S]*(один[\s\S]{0,40}push|Ф-3|Ф-4)|(один[\s\S]{0,40}push|ограничива)[\s\S]*независимо|независимо[\s\S]*(один[\s\S]{0,40}push|ограничива)/i,
  },
  {
    id: "jan31-vs-f2",
    title: "Критерий приёмки про покупку 31 января противоречит правилу Ф-2 о дате покупки",
    where: /31 января|Февральский/i,
    about: /Ф-2|дат[аеы] (совершения )?покупк|январ/i,
  },
  {
    id: "tiyn-vs-tenge",
    title: "Сумма покупки хранится в тиынах, порог в тенге: единицы не согласованы",
    where: /тиын/i,
    about: /тиын|единиц|тенге/i,
  },
  {
    id: "types-mismatch",
    title: "amount и enabled в запросе integer, в ответе string",
    where: /amount|enabled|string|integer/i,
    about: /(string[\s\S]*integer)|(integer[\s\S]*string)|(строк[\s\S]*(цел|числ))|((цел|числ)[\s\S]*строк)/i,
  },
  {
    id: "json-without-body",
    title: "Content-Type application/json при запросе без тела",
    where: /Content-Type|Тело не используется/i,
    about: /тел[оа]|body|Content-Type/i,
  },
  {
    id: "no-prod-url",
    title: "Не указан Prod URL",
    where: /Prod/,
    about: /Prod|продуктив|промышлен/i,
  },
  {
    id: "no-version",
    title: "Версия и дата документа не заполнены, чек-лист ревью не отмечен",
    where: /версия\/дата|не заполнен|отметки не проставлены|Да \/ Нет/i,
    about: /верси|дат[аы]|чек-лист|отмет/i,
  },
  {
    id: "acceptance-gaps",
    title: "Критерии приёмки не покрывают Ф-4, возвраты, снятие наличных или границы порога",
    where: /Ф-4|Возврат|снятие наличных|Ф-1|1 000|Критерии|48 500|19 900|31 января/i,
    about: /(не покрыт|нет (ни одного )?(сценари|критери|тест)|отсутству[а-я]* (сценари|критери|тест)|без (сценари|критери))/i,
  },
];
