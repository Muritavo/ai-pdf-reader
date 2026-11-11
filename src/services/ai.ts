import { clearCached, wrapFunction } from "../utils/hash";

const MODEL = "mlx-community/Qwen3.8-27B-4bit";

// ─── Configuration ──────────────────────────────────────────────────────────

/** The endpoint used while none was chosen on the AI status */
export const DEFAULT_AI_ENDPOINT: string = import.meta.env.VITE_AI_ENDPOINT ?? "http://127.0.0.1:8000";

/** The models that can be chosen for a request. Hardcoded for now */
export const AI_MODELS: string[] = [MODEL, "mlx-community/Qwen3.6-35B-A3B-4bit"];

/** The model and the thinking mode of a request, as chosen for something (as a book of the literature) */
export type AISettings = { name: string; thinkingEnabled: boolean };

export const DEFAULT_AI_SETTINGS: AISettings = { name: MODEL, thinkingEnabled: false };

/** How soon the server handles a request, before or after the others waiting */
export type AIPriority = "foreground" | "normal" | "background";

/** What the model answers when the passage cites nothing it could find on the document */
export const REFERENCE_NOT_FOUND = "NOT_FOUND";

// ─── Main functions ─────────────────────────────────────────────────────────

export const normalizePdfText = wrapFunction(_normalizePdfText);

export const defineWordInContext = wrapFunction(_defineWordInContext);

/** Forgets the cached definition of the word, so defining it again asks the AI */
export const forgetWordDefinition = (word: string, context: string) => clearCached([word, context]);

export const findReferenceInContext = wrapFunction(_findReferenceInContext);

/** What is asked to warm the document up, answered shortly so the server spends its time only reading the document */
const WARM_UP_QUESTION = 'Reply only with "OK" and wait for the next question.';

/**
 * Asks a stub question about the document, so the server already has the document read (KV cache)
 * when the first real question comes. Its answer is of no use, so it is not kept
 */
export async function warmUpDocumentContext(context: string): Promise<void> {
  await callOpenAiApi([...documentContextMessages(context), { role: "user", content: WARM_UP_QUESTION }], undefined, {
    priority: "background",
  });
}

/** Kept by the question, the image and the document, so asking the same again is instant */
export const askAboutImage = wrapFunction(_askAboutImage);

/** Kept by the document and the images of its pages, so validating again is instant */
export const validateAgainstPages = wrapFunction(_validateAgainstPages);

export const askContext = wrapFunction(_askContext);

/** Clearer wordings of the research query, to be asked about the document */
export async function suggestPrompts(researchQuery: string, context: string): Promise<string[]> {
  const answer = await suggestPromptsCached(SUGGEST_PROMPTS_INSTRUCTIONS, researchQuery, context);
  return answer
    .split("\n")
    // The model may still number or bullet the lines
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^"(.*)"$/, "$1").trim())
    .filter(Boolean);
}

/**
 * Recall: the question about all the documents turned into one to be asked about each document alone.
 * Kept by the question, so recalling the same again reuses it (and the answers of each document)
 */
export const singleDocumentPrompt = (broadPrompt: string) => singleDocumentPromptCached(SINGLE_DOCUMENT_INSTRUCTIONS, broadPrompt);

/** What a document answers to the single document prompt when it has nothing about it */
export const RECALL_NOT_ADDRESSED = "NOT_ADDRESSED";

/** One document as the synthesis of the recall sees it: what is known of it, and what it answered */
export type RecallAnswer = {
  title: string;
  authors: string;
  year: string;
  journal: string;
  doi: string;
  answer: string;
};

/** Recall: the answers of every document put together, to answer the question about all of them */
export function synthesizeRecall(
  broadPrompt: string,
  answers: RecallAnswer[],
  onProgress?: (chunk: string) => void,
): Promise<string> {
  const documents = answers
    .map(
      (a, i) => `### Document ${i + 1}
- Title: ${a.title || "(unknown)"}
- Authors: ${a.authors || "(unknown)"}
- Year: ${a.year || "(unknown)"}
- Journal: ${a.journal || "(unknown)"}
- DOI: ${a.doi || "(none)"}

Answer found in this document:
${a.answer.trim()}`,
    )
    .join("\n\n");

  return callOpenAiApi(
    [
      {
        role: "user",
        content: `A researcher asked a question about a collection of documents. The question was asked about each document alone, and each answer is below, with what is known of the document.

Question: """${broadPrompt}"""

${documents}

Answer the question about the whole collection, in markdown and in the same language as the question. Use only the answers and the information of the documents above: do not make up anything. Name the documents by their title (and year) when you refer to them. Leave out the documents whose answer was ${RECALL_NOT_ADDRESSED} or does not help to answer the question. If no document answers it, say so.`,
      },
    ],
    onProgress,
    { cache: false, priority: "normal" },
  );
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
      headers: { Authorization: `Bearer ${currentApiKey}` },
    });
    return true;
  } catch {
    return false;
  }
}

export async function callOpenAiApi(
  messages: { role: string; content: string | ContentPart[] }[],
  /** Receives each piece of the answer as it streams */
  onProgress?: (chunk: string) => void,
  /**
   * False tells the server not to keep the prompt on its cache, for prompts that are not asked again.
   * `settings` chooses the model and the thinking mode; without it, the loaded model and no thinking.
   * `priority` tells the server how soon to handle it; without it, the server decides.
   * `onPromptProgress` receives how much of the prompt the server already read (from 0 to 1), before it starts answering
   */
  {
    cache = true,
    settings,
    priority,
    onPromptProgress,
  }: { cache?: boolean; settings?: AISettings; priority?: AIPriority; onPromptProgress?: (progress: number) => void } = {},
): Promise<string> {
  const response = await fetch(`${currentEndpoint}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentApiKey}`,
    },
    body: JSON.stringify({
      // Servers that don't report the loaded model are still used, with the default model
      model: settings?.name ?? currentDefaultModel ?? (await getLoadedModelId().catch(() => null)) ?? MODEL,
      messages,
      stream: true,
      chat_template_kwargs: { enable_thinking: settings?.thinkingEnabled ?? false },
      ...(cache ? {} : { cache: false }),
      ...(priority ? { priority } : {}),
      // Asks the server to report the reading of the prompt, which servers that can't do it ignore
      ...(onPromptProgress ? { return_progress: true } : {}),
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
            const promptProgress = parsed.prompt_progress;
            if (onPromptProgress && promptProgress?.total) {
              onPromptProgress(Math.min(1, promptProgress.processed / promptProgress.total));
            }
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

    // The stream may open and then end without content, which is a failure and must not be cached
    if (!accumulated.trim()) {
      throw new Error("API returned an empty response");
    }

    return accumulated;
  } finally {
    clearInterval(timer);
    console.log("[AI Stream] Final content:", accumulated);
  }
}

/**
 * Every request goes to the provider chosen on the AI status, read when it is made.
 * Without a default model, the requests use the one the server has loaded
 */
export function setAIProvider({ endpoint, apiKey, defaultModel }: { endpoint: string; apiKey?: string; defaultModel: string | null }) {
  currentEndpoint = endpoint;
  currentApiKey = apiKey || "stub";
  currentDefaultModel = defaultModel;
}

// ─── Internals ──────────────────────────────────────────────────────────────

let currentEndpoint = DEFAULT_AI_ENDPOINT;
let currentApiKey = "stub";
let currentDefaultModel: string | null = null;

/** A part of a message, for the models that read images too */
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

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

// ─── Implementations behind the exports above ───────────────────────────────

async function _normalizePdfText(rawText: string): Promise<string> {
  const prompt = `Here is unstructured text extracted from a PDF:

  ${rawText}

  Please return a continuous, readable text by fixing line breaks and ordering. Do not add any extra commentary. Just return the normalized text.`;

  const normalizedText = await callOpenAiApi([
    { role: "user", content: prompt },
  ], undefined, { cache: false });

  return normalizedText;
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
  ], undefined, { priority: "foreground" });
}

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
  ], undefined, { priority: "foreground" });
}

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

async function _validateAgainstPages(
  context: string,
  ...pageImages: string[]
): Promise<string> {
  return callOpenAiApi([
    ...documentContextMessages(context),
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `The document above was organized from the text extracted from its PDF. Here is an image of each of its pages, in order. Validate how the content was organized against the images:

- Tables, above all: the same columns, headers and rows as the image, with every value in the right cell, nothing merged, split, shifted or missing
- Headings, paragraphs and columns of text in the reading order of the page
- Figure and table captions, footnotes and notes kept with what they belong to
- Content missing, duplicated or that is not on the pages

Answer in markdown, with each problem found under the page it is on: what the page shows, and what the organized text has instead. For a wrong table, also write it as it is on the page, as a markdown table. If the content matches the pages, say so.`,
        },
        ...pageImages.flatMap((image, index): ContentPart[] => [
          { type: "text", text: `Page ${index + 1}:` },
          { type: "image_url", image_url: { url: image } },
        ]),
      ],
    },
  ]);
}

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

/** How the suggestions are asked. Part of the cache key, so changing it asks the AI again */
const SUGGEST_PROMPTS_INSTRUCTIONS = `Rewrite the research query above as 5 alternative wordings of the same question, to be asked about a research article. Each one must keep exactly the meaning and scope of the query: do not add new topics, details or sub-questions, and do not narrow or broaden it. Only make it clearer and simpler, in a single short sentence, in the same language as the query.

Answer only with the rewordings, one per line, without numbering, bullets or any other commentary.`;

async function _suggestPrompts(
  instructions: string,
  researchQuery: string,
  context: string,
): Promise<string> {
  return callOpenAiApi([
    ...documentContextMessages(context),
    {
      role: "user",
      content: `Research query: """${researchQuery}"""

${instructions}`,
    },
  ]);
}
const suggestPromptsCached = wrapFunction(_suggestPrompts);

/** How the single document prompt is made. Part of the cache key, so changing it asks the AI again */
const SINGLE_DOCUMENT_INSTRUCTIONS = `The question above is about a collection of research documents. It will be asked about each document of the collection alone, and the answers put together afterwards to answer it.

Rewrite it as a single question to be asked about one document: what that one document must tell so the answers of all of them answer the question above. Keep every point of the question that one document can answer, and ask for the passages (quoted) that support the answer. Leave out the comparisons between documents, which are made when the answers are put together. End by telling to answer exactly ${RECALL_NOT_ADDRESSED} when the document does not address it. Write it in the same language as the question.

Answer only with the rewritten question, without any other commentary.`;

async function _singleDocumentPrompt(instructions: string, broadPrompt: string): Promise<string> {
  return callOpenAiApi(
    [{ role: "user", content: `Question: """${broadPrompt}"""\n\n${instructions}` }],
    undefined,
    { cache: false },
  );
}
const singleDocumentPromptCached = wrapFunction(_singleDocumentPrompt);

async function _getLoadedModelId(): Promise<string | null> {
  const response = await fetch(`${currentEndpoint}/v1/models/status`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${currentApiKey}`,
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
