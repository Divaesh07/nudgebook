import { addPeriod, CATEGORIES, chronoDates, isDate, isTime, parseLocal, titleFrom, todayIn, validRecur, type Parsed } from "./rules";

const SYSTEM = `Turn a personal note or SMS into JSON for a reminder app. Reply ONLY with:
{"ignore":bool,"title":str,"category":str,"happened_on":"YYYY-MM-DD"|null,"due_date":"YYYY-MM-DD"|null,"due_time":"HH:MM"|null,"recur":"<n> day(s)|week(s)|month(s)|year(s)"|null}
Rules:
- title: short noun phrase, max 6 words, e.g. "Car insurance renewal".
- category: one of ${CATEGORIES.join(",")}.
- happened_on: when it was done (default today).
- Done something that repeats (insurance yearly, phone recharge by validity else 28 days, rent/bills monthly, vehicle service 6 months): due_date = next due date, recur = period.
- A future date/time to be reminded: due_date/due_time from it.
- Plain log, nothing due: due_date null, recur null.
- ignore=true for OTPs, promos, spam, balance alerts needing no action.`;

// "Mon 2026-11-02(today), Tue 2026-11-03, ..." so the model never does weekday math.
const week = (today: string) =>
  Array.from({ length: 8 }, (_, i) => {
    const d = new Date(Date.parse(today) + i * 864e5);
    return `${d.toUTCString().slice(0, 3)} ${d.toISOString().slice(0, 10)}${i ? "" : "(today)"}`;
  }).join(", ");

const MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"];

async function groq(model: string, text: string, today: string) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      model,
      temperature: 0,
      reasoning_effort: "low",
      max_completion_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Calendar: ${week(today)}
Note: ${text}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`groq ${res.status}`);
  return JSON.parse((await res.json()).choices[0].message.content);
}

/** LLM first (two models), offline rules last. Never throws. */
export async function parse(text: string, tz: string): Promise<Parsed & { via: string }> {
  const local = parseLocal(text, tz);
  if (!process.env.GROQ_API_KEY) return { ...local, via: "rules" };
  const today = todayIn(tz);
  for (const model of MODELS) {
    try {
      const j = await groq(model, text, today);
      // LLM decides meaning; dates are computed here (LLMs miscount days)
      const named = chronoDates(text, tz);
      const recur = validRecur(j.recur);
      const happened = isDate(j.happened_on) && j.happened_on <= today ? j.happened_on : today;
      return {
        ignore: j.ignore === true,
        title: typeof j.title === "string" && j.title.trim() ? j.title.trim().slice(0, 80) : titleFrom(text),
        category: CATEGORIES.includes(j.category) ? j.category : local.category,
        happened_on: happened,
        due_date: named.due ?? (recur ? addPeriod(happened, recur) : isDate(j.due_date) ? j.due_date : null),
        due_time: named.due ? named.time : isTime(j.due_time) ? j.due_time : null,
        recur,
        via: model,
      };
    } catch (e) {
      console.warn("parse", model, e);
    }
  }
  return { ...local, via: "rules" };
}
