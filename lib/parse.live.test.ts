import { it } from "vitest";
import { parse } from "./parse";
it.skipIf(!process.env.GROQ_API_KEY)("live groq", async () => {
  for (const t of [
    "Today I did the car insurance renewal",
    "Airtel recharge of 349 done, 28 days validity",
    "remind me to call mom on Friday at 7pm",
    "Your OTP for login is 482910",
    "Met Ravi for coffee at the new cafe",
  ]) { const s = Date.now(); console.log(JSON.stringify(await parse(t, "Asia/Kolkata")), Date.now() - s, "ms"); }
}, 60000);
