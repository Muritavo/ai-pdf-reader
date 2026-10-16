const API_KEY = "stub";
export const AI_ENDPOINT = "http://localhost:9876";
const API_URL = `${AI_ENDPOINT}/v1/chat/completions`;
const MODEL_STATUS_URL = `${AI_ENDPOINT}/v1/models/status`;
import { wrapFunction } from "../utils/hash";

const MODEL =
  // "gemma-4-26b-a4b-it-UD-MLX-4bit"
  "UNKNOWN"
// "Ornith-1.0-9B-oQ4-fp16"
// 'Ornith-1.0-9B-oQ4-fp16'
// "Ornith-1.0-9B-mlx-4Bit"

export async function callOpenAiApi(
  messages: { role: string; content: string }[],
  /** Receives the amount of characters received so far while the answer streams */
  onProgress?: (receivedCharacters: number) => void,
): Promise<string> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: (await getLoadedModelId()) ?? MODEL,
      messages,
      stream: true,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  if (!response.ok) {
    throw new Error("API request failed");
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  const timer = setInterval(() => {
    console.log("[AI Stream] Current content:", accumulated.slice(-2000));
  }, 5000);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              accumulated += content;
              onProgress?.(accumulated.length);
            }
          } catch {
            // skip malformed JSON lines
          }
        }
      }
    }

    return accumulated;
  } finally {
    clearInterval(timer);
    console.log("[AI Stream] Final content:", accumulated);
  }
}

async function _normalizePdfText(rawText: string): Promise<string> {
  const prompt = `Here is unstructured text extracted from a PDF:

  ${rawText}

  Please return a continuous, readable text by fixing line breaks and ordering. Do not add any extra commentary. Just return the normalized text.`;

  const normalizedText = await callOpenAiApi([
    { role: "user", content: prompt },
  ]);

  return normalizedText;
}
export const normalizePdfText = wrapFunction(_normalizePdfText);

async function _defineWordInContext(
  word: string,
  context: string,
): Promise<string> {
  return callOpenAiApi([
    {
      role: "user",
      content: `Here is the context of the document:

${context}`,
    },
    {
      role: "user",
      content: `What does "${word}" mean in this context? Please provide a concise definition based on the context.`,
    },
  ]);
}
export const defineWordInContext = wrapFunction(_defineWordInContext);

async function _askContext(
  prompt: string,
  context: string,
): Promise<string> {
  return callOpenAiApi([
    {
      role: "user",
      content: `Here is the context from a document:

${context}`,
    },
    {
      role: "user",
      content: prompt,
    },
  ]);
}
export const askContext = wrapFunction(_askContext);

async function _getLoadedModelId(): Promise<string | null> {
  const response = await fetch(MODEL_STATUS_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error("Model status request failed");
  }

  const data = await response.json();
  const loadedModel = (data?.models ?? []).find(
    (m: { id: string; loaded: boolean }) => m.loaded === true,
  );
  return loadedModel?.id ?? null;
}
export const getLoadedModelId = _getLoadedModelId;
