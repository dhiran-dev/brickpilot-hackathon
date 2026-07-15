import { generatedDesignSchema, type GeneratedDesign } from "@/lib/design/schema";

const endpoint = "https://api.fireworks.ai/inference/v1/chat/completions";

const systemPrompt = `You are BrickPilot, an architectural feasibility assistant. Convert the user's home-design request into a conservative, dimensionally coherent concept plan. Return only JSON matching this exact shape:
{
  "intent": { "style": "string", "site": { "widthM": number, "depthM": number }, "assumptions": ["string"] },
  "floorPlan": { "totalAreaSqM": number, "rooms": [{ "id": "lowercase-kebab-case", "name": "string", "type": "string", "widthM": number, "depthM": number, "areaSqM": number, "xM": number, "yM": number }], "notes": ["string"] },
  "validation": { "status": "pass|warning|fail", "score": 0, "checks": [{ "name": "string", "status": "pass|warning|fail", "detail": "string" }] },
  "costEstimate": { "currency": "INR", "low": 0, "high": 0, "assumptions": ["string"] }
}
Use metres. Set each room areaSqM close to widthM * depthM. Make assumptions explicit instead of inventing unknown requirements. The result is a concept estimate, not construction approval.`;

export class DesignGenerationError extends Error {}

export async function generateDesign(prompt: string): Promise<GeneratedDesign> {
  const apiKey = process.env.FIREWORKS_API_KEY;
  const model = process.env.AI_MODEL;

  if (!apiKey || !model) throw new DesignGenerationError("The design service is not configured.");

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4_000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify({ request: prompt }) },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new DesignGenerationError("The design service did not respond.");
  }

  if (!response.ok) throw new DesignGenerationError("The design service could not create a plan.");

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new DesignGenerationError("The design service returned an invalid response.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new DesignGenerationError("The design service returned invalid JSON.");
  }

  const result = generatedDesignSchema.safeParse(parsed);
  if (!result.success) throw new DesignGenerationError("The design service returned an incomplete plan.");

  return result.data;
}
