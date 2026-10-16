import { withCache } from "../utils/hash";
import { callOpenAiApi } from "./ai";

/**
 * Specifically for organizing page text based on positions.
 */
export function organizeDocumentText(
  currentPageTextWithPositions: string,
  onProgress?: (receivedCharacters: number) => void,
): Promise<string> {
  const prompt = `Organize this into a contiguous organized text as markdown syntax.

${currentPageTextWithPositions}`;

  return withCache([currentPageTextWithPositions], () =>
    callOpenAiApi(
      [
        { role: "system", content: `Take the complete text from a document and return a markdown syntax for the complete text, without modyfing content.` },
        { role: "user", content: prompt },
      ],
      onProgress,
    ),
  );
}
