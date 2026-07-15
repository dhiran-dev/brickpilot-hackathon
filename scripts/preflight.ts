/**
 * Phase 0 preflight: verify the three external dependencies before building.
 *   1. Self-hosted Postgres  (DATABASE_URL)
 *   2. Fireworks + MiniMax-M3 in JSON mode  (FIREWORKS_API_KEY, AI_MODEL)
 *   3. Replicate GPT Image 2  (REPLICATE_API_TOKEN)
 *
 * Run with:  bun run preflight
 * Bun auto-loads .env.local.
 */
import postgres from "postgres";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";

let failures = 0;
const ok = (label: string, detail = "") =>
  console.log(`${GREEN}✓${RESET} ${label} ${DIM}${detail}${RESET}`);
const fail = (label: string, detail = "") => {
  console.log(`${RED}✗${RESET} ${label} ${DIM}${detail}${RESET}`);
  failures++;
};

async function checkDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return fail("Postgres", "DATABASE_URL missing");
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql`select 1 as ok`;
    ok("Postgres", `connected → select 1 = ${rows[0].ok}`);
  } catch (e) {
    fail("Postgres", (e as Error).message);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function checkLlm() {
  const key = process.env.FIREWORKS_API_KEY;
  const model = process.env.AI_MODEL;
  if (!key || !model) return fail("Fireworks", "FIREWORKS_API_KEY or AI_MODEL missing");
  try {
    const res = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You output only valid JSON." },
          { role: "user", content: 'Return exactly this JSON: {"ok": true, "provider": "fireworks"}' },
        ],
      }),
    });
    if (!res.ok) return fail("Fireworks", `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return fail("Fireworks JSON mode", `reply was not valid JSON: ${String(content).slice(0, 140)}`);
    }
    ok(`Fireworks + ${model.split("/").pop()}`, `JSON mode OK → ${JSON.stringify(parsed)}`);
  } catch (e) {
    fail("Fireworks", (e as Error).message);
  }
}

async function checkImage() {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return fail("Replicate", "REPLICATE_API_TOKEN missing");
  try {
    const res = await fetch("https://api.replicate.com/v1/models/openai/gpt-image-2/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: { prompt: "a small grey concrete cube on a plain white background", quality: "low" },
      }),
    });
    const data = await res.json();
    if (!res.ok) return fail("Replicate gpt-image-2", `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 220)}`);
    const status = data.status;
    const out = Array.isArray(data.output) ? data.output[0] : data.output;
    if (status === "succeeded" && out) ok("Replicate gpt-image-2", `image generated → ${String(out).slice(0, 60)}…`);
    else if (status === "processing" || status === "starting")
      ok("Replicate gpt-image-2", `job accepted (status=${status}); async/webhook path will deliver`);
    else fail("Replicate gpt-image-2", `status=${status} ${JSON.stringify(data.error ?? "").slice(0, 140)}`);
  } catch (e) {
    fail("Replicate", (e as Error).message);
  }
}

console.log("\nBrickPilot preflight — Phase 0\n");
await checkDb();
await checkLlm();
await checkImage();
console.log("");
if (failures > 0) {
  console.log(`${RED}${failures} check(s) failed — fix before Phase 1.${RESET}\n`);
  process.exit(1);
}
console.log(`${GREEN}All checks passed. Phase 0 ready.${RESET}\n`);
