import { wrapFunction } from "../utils/hash";
import { callOpenAiApi } from "./ai";

/**
 * Specifically for organizing page text based on positions.
 */
async function _organizeDocumentText(currentPageTextWithPositions: string): Promise<string> {
  const prompt = `Organize this into a contiguous organized text as markdown syntax.

${currentPageTextWithPositions}`;

  return await callOpenAiApi([
    { role: "system", content: `Take the complete text from a document and return a markdown syntax for the complete text, without modyfing content.` },
    { role: "user", content: prompt },
  ]);
}

export const organizeDocumentText = wrapFunction(_organizeDocumentText);
