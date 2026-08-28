const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

export type OcrKind = "payment_receipt" | "meter_reading";

export type OcrResult = {
  raw_text: string | null;
  confidence: number | null;
  data: Record<string, unknown>;
};

const RECEIPT_PROMPT = `You are reading a prepaid electricity payment receipt or bank transfer receipt.
Return STRICT JSON only, no prose, no markdown fences, with these keys (use null when absent):
{
  "amount": number|null,
  "amount_paid": number|null,
  "units_kwh": number|null,
  "meter_number": string|null,
  "beneficiary_id": string|null,
  "token": string|null,
  "token_last4": string|null,
  "session_id": string|null,
  "transaction_time": "HH:MM"|null,
  "provider": string|null,
  "transaction_reference": string|null,
  "transaction_number": string|null,
  "customer_name": string|null,
  "service_address": string|null,
  "transaction_date": "YYYY-MM-DD"|null,
  "tariff_class": string|null,
  "tariff_rate": number|null,
  "raw_text": string|null,
  "confidence": number
}
"token" is the full prepaid credit token exactly as printed (usually 20 digits, often shown in groups of four). Copy every digit.
"units_kwh" is the number of electricity units purchased.
"confidence" is 0-100 and reflects how certain you are of the extracted numbers.`;

const METER_PROMPT = `You are reading the digital display of an electricity meter from a photograph.
Return STRICT JSON only, no prose, no markdown fences:
{
  "reading_kwh": number|null,
  "meter_number": string|null,
  "raw_text": string|null,
  "confidence": number
}
"reading_kwh" is the cumulative/registered kWh value shown on the display.
"confidence" is 0-100 and reflects how legible the display is.`;

function parseJson(content: string): Record<string, unknown> {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function runVisionOcr(params: {
  base64: string;
  mimeType: string;
  kind: OcrKind;
}): Promise<OcrResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured for this project.");

  const response = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: params.kind === "payment_receipt" ? RECEIPT_PROMPT : METER_PROMPT,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the fields from this image." },
            {
              type: "image_url",
              image_url: { url: `data:${params.mimeType};base64,${params.base64}` },
            },
          ],
        },
      ],
    }),
  });

  if (response.status === 429) throw new Error("OCR rate limit reached. Try again shortly.");
  if (response.status === 402) throw new Error("AI credits exhausted for this workspace.");
  if (!response.ok) {
    throw new Error(`OCR failed (${response.status}): ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  const data = parseJson(content);

  const rawConfidence = Number(data["confidence"]);
  return {
    raw_text: typeof data["raw_text"] === "string" ? (data["raw_text"] as string) : content || null,
    confidence: Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(100, rawConfidence))
      : null,
    data,
  };
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
