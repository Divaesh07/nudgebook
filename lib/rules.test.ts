import { describe, expect, it } from "vitest";
import { addPeriod, parseLocal, todayIn, tzOffset } from "./rules";

const now = new Date("2026-11-02T08:00:00Z"); // 13:30 IST
const tz = "Asia/Kolkata";

describe("parseLocal", () => {
  it("insurance done today → due in 1 year, yearly", () => {
    const p = parseLocal("Today I did the car insurance renewal", tz, now);
    expect(p).toMatchObject({ category: "insurance", happened_on: "2026-11-02", due_date: "2027-11-02", recur: "1 year" });
  });

  it("recharge uses validity days from text", () => {
    const p = parseLocal("Jio recharge done 299 for 84 days", tz, now);
    expect(p).toMatchObject({ category: "recharge", due_date: "2027-01-25", recur: "84 days" });
  });

  it("explicit future date + time wins", () => {
    const p = parseLocal("remind me to pay school fees on 5 Dec at 6pm", tz, now);
    expect(p).toMatchObject({ due_date: "2026-12-05", due_time: "18:00", recur: null });
  });

  it("later today with a time is a reminder", () => {
    expect(parseLocal("remind me to call the bank at 6pm today", tz, now)).toMatchObject({ due_date: "2026-11-02", due_time: "18:00" });
  });

  it("past date becomes happened_on", () => {
    const p = parseLocal("paid electricity bill yesterday", tz, now);
    expect(p).toMatchObject({ category: "bill", happened_on: "2026-11-01", due_date: "2026-12-01" });
  });

  it("OTP SMS ignored", () => {
    expect(parseLocal("Your OTP is 123456. Do not share.", tz, now).ignore).toBe(true);
  });

  it("plain log has no reminder", () => {
    expect(parseLocal("Met Ravi for coffee", tz, now)).toMatchObject({ category: "other", due_date: null });
  });
});

describe("date helpers", () => {
  it("tz offset + today", () => {
    expect(tzOffset(tz, now)).toBe(330);
    expect(tzOffset("America/New_York", now)).toBe(-300);
    expect(todayIn("Pacific/Auckland", new Date("2026-11-02T12:00:00Z"))).toBe("2026-11-03");
  });
  it("addPeriod", () => {
    expect(addPeriod("2026-11-02", "1 month")).toBe("2026-12-02");
    expect(addPeriod("2026-11-02", "2 weeks")).toBe("2026-11-16");
  });
});
