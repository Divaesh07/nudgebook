import * as chrono from "chrono-node";

export type Parsed = {
  ignore?: boolean;
  title: string;
  category: string;
  happened_on: string | null; // YYYY-MM-DD
  due_date: string | null; // YYYY-MM-DD
  due_time: string | null; // HH:MM
  recur: string | null; // "1 year", "28 days"
};

export const CATEGORIES = [
  "insurance", "recharge", "bill", "vehicle", "health", "document", "finance", "home", "work", "personal", "other",
];

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isTime = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const validRecur = (s: unknown) =>
  typeof s === "string" && /^\d{1,3} (day|week|month|year)s?$/.test(s) ? s : null;

/** YYYY-MM-DD for "now" in the given IANA timezone. */
export const todayIn = (tz: string, now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);

/** Minutes east of UTC for tz at `now` (e.g. Asia/Kolkata → 330). */
export function tzOffset(tz: string, now = new Date()) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

export function addPeriod(date: string, recur: string) {
  const [n, unit] = recur.split(" ");
  const k = Number(n);
  const d = new Date(date + "T00:00:00Z");
  if (unit.startsWith("day")) d.setUTCDate(d.getUTCDate() + k);
  else if (unit.startsWith("week")) d.setUTCDate(d.getUTCDate() + 7 * k);
  else if (unit.startsWith("month")) d.setUTCMonth(d.getUTCMonth() + k);
  else d.setUTCFullYear(d.getUTCFullYear() + k);
  return d.toISOString().slice(0, 10);
}

// [pattern, category, default repeat]. First match wins.
const RULES: [RegExp, string, string | null][] = [
  [/\b(otp|one[- ]time password|verification code)\b/i, "ignore", null],
  [/\b(insurance|policy|premium)\b/i, "insurance", "1 year"],
  [/\b(puc|pollution)\b/i, "vehicle", "6 months"],
  [/\b(car|bike|scooter|vehicle)\b.*\bservic/i, "vehicle", "6 months"],
  [/\b(recharge|recharged|prepaid|top[- ]?up)\b/i, "recharge", "28 days"],
  [/\b(rent|emi|electricity|broadband|wifi|wi-fi|bill|subscription|netflix|spotify)\b/i, "bill", "1 month"],
  [/\b(licen[cs]e|passport|visa|aadhaar|pan card)\b/i, "document", null],
  [/\b(doctor|dentist|check-?up|medicine|vaccine|hospital)\b/i, "health", null],
  [/\b(sip|mutual fund|tax|itr|fixed deposit|fd)\b/i, "finance", null],
];

const ymd = (c: chrono.ParsedComponents) =>
  [c.get("year"), c.get("month"), c.get("day")].map((v, i) => String(v).padStart(i ? 2 : 4, "0")).join("-");

export const titleFrom = (text: string) => {
  const t = text.trim().replace(/\s+/g, " ").split(/[.!?\n]/)[0];
  return (t.length > 60 ? t.slice(0, 57) + "…" : t).replace(/^./, (c) => c.toUpperCase());
};

/** Dates named in the text: latest past/today one = happened, first future one = due. */
export function chronoDates(text: string, tz: string, now = new Date()) {
  const today = todayIn(tz, now);
  let happened = today, due: string | null = null, time: string | null = null;
  for (const r of chrono.parse(text, { instant: now, timezone: tzOffset(tz, now) }, { forwardDate: false })) {
    const d = ymd(r.start);
    const laterToday = d === today && r.start.isCertain("hour") && r.start.date() > now;
    if (d <= today && !laterToday) { happened = d; continue; }
    if (due) continue;
    due = d;
    if (r.start.isCertain("hour")) time = `${String(r.start.get("hour")).padStart(2, "0")}:${String(r.start.get("minute") ?? 0).padStart(2, "0")}`;
  }
  return { happened, due, time };
}

/** Offline parser: keyword rules + chrono dates. Used when the LLM is down. */
export function parseLocal(text: string, tz: string, now = new Date()): Parsed {
  const today = todayIn(tz, now);
  const rule = RULES.find(([re]) => re.test(text));
  const base = { title: titleFrom(text), category: "other", happened_on: today, due_date: null, due_time: null, recur: null };
  if (rule?.[1] === "ignore") return { ...base, ignore: true };

  let recur = rule?.[2] ?? null;
  const days = text.match(/\b(\d{1,3})\s*days?\b/i);
  if (rule?.[1] === "recharge" && days) recur = `${days[1]} days`;

  const { happened, due: explicit, time } = chronoDates(text, tz, now);
  let due = explicit;
  if (!due && recur) due = addPeriod(happened, recur);

  return { ...base, category: rule?.[1] ?? "other", happened_on: happened, due_date: due, due_time: time, recur };
}
