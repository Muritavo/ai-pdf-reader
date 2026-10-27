const API_KEY = "stub";
/** The endpoint used while none was chosen on the AI status */
export const DEFAULT_AI_ENDPOINT: string = import.meta.env.VITE_AI_ENDPOINT ?? "http://127.0.0.1:8000";

let currentEndpoint = DEFAULT_AI_ENDPOINT;

/** Every request goes to the endpoint chosen on the AI status, read when it is made */
export function setAIEndpoint(endpoint: string) {
  currentEndpoint = endpoint;
}

export const getAIEndpoint = () => currentEndpoint;
import { wrapFunction } from "../utils/hash";

const MODEL =
  // "gemma-4-26b-a4b-it-UD-MLX-4bit"
  "mlx-community/Qwen3.8-27B-4bit"
// "Ornith-1.0-9B-oQ4-fp16"
// 'Ornith-1.0-9B-oQ4-fp16'
// "Ornith-1.0-9B-mlx-4Bit"

/** A part of a message, for the models that read images too */
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export async function callOpenAiApi(
  messages: { role: string; content: string | ContentPart[] }[],
  /** Receives each piece of the answer as it streams */
  onProgress?: (chunk: string) => void,
  /** False tells the server not to keep the prompt on its cache, for prompts that are not asked again */
  { cache = true }: { cache?: boolean } = {},
): Promise<string> {
  const response = await fetch(`${currentEndpoint}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      // Servers that don't report the loaded model are still used, with the default model
      model: (await getLoadedModelId().catch(() => null)) ?? MODEL,
      messages,
      stream: true,
      chat_template_kwargs: { enable_thinking: false },
      ...(cache ? {} : { cache: false }),
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
              onProgress?.(content);
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
  ], undefined, { cache: false });

  return normalizedText;
}
export const normalizePdfText = wrapFunction(_normalizePdfText);

/**
 * The start of every conversation about a document: the document, and the assistant acknowledging it.
 * It must stay identical between the features (and start with nothing that changes), so the server
 * can reuse the prompt it already processed (KV cache) and only handle the question that follows.
 */
function documentContextMessages(context: string) {
  return [
    {
      role: "user",
      content: `Here is the context of the document:

${context}`,
    },
    {
      role: "assistant",
      content:
        "Understood. I have the document and will answer based on it. What would you like to know?",
    },
  ];
}

async function _defineWordInContext(
  word: string,
  context: string,
): Promise<string> {
  return callOpenAiApi([
    ...documentContextMessages(context),
    {
      role: "user",
      content: `What does "${word}" mean in this context? Please provide a concise definition based on the context.`,
    },
  ]);
}
export const defineWordInContext = wrapFunction(_defineWordInContext);

/** What the model answers when the passage cites nothing it could find on the document */
export const REFERENCE_NOT_FOUND = "NOT_FOUND";

async function _findReferenceInContext(
  passage: string,
  context: string,
): Promise<string> {
  return callOpenAiApi([
    ...documentContextMessages(context),
    {
      role: "user",
      content: `Find the bibliographic reference(s) that the following passage of the document cites, or is based on, using the reference list of the document.

Passage: """${passage}"""

Answer only with each reference entry as it is written in the reference list of the document, one per line, in markdown. If the passage cites no reference, or it can't be found on the reference list, answer exactly ${REFERENCE_NOT_FOUND}.`,
    },
  ]);
}
export const findReferenceInContext = wrapFunction(_findReferenceInContext);

async function _askAboutImage(
  question: string,
  imageDataUrl: string,
  context: string,
): Promise<string> {
  return callOpenAiApi([
    ...documentContextMessages(context),
    {
      role: "user",
      content: [
        { type: "text", text: `This image is a figure of the document. ${question}` },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ]);
}
/** Kept by the question, the image and the document, so asking the same again is instant */
export const askAboutImage = wrapFunction(_askAboutImage);

async function _askContext(
  prompt: string,
  context: string,
): Promise<string> {
  return callOpenAiApi([
    ...documentContextMessages(context),
    {
      role: "user",
      content: prompt,
    },
  ]);
}
export const askContext = wrapFunction(_askContext);

async function _getLoadedModelId(): Promise<string | null> {
  const response = await fetch(`${currentEndpoint}/v1/models/status`, {
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

/**
 * A single request to check the server is reachable, for when it does not report the loaded model.
 * Any answer means it is up, even an error status. Only a failure to connect means it is not.
 */
export async function pingServer(): Promise<boolean> {
  try {
    await fetch(`${currentEndpoint}/v1/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    return true;
  } catch {
    return false;
  }
}
