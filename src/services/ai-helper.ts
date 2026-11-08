import { clearCached, isCached, withCache } from "../utils/hash";
import { callOpenAiApi } from "./ai";

/**
 * Specifically for organizing page text based on positions.
 */
export function organizeDocumentText(
  currentPageTextWithPositions: string,
  onProgress?: (chunk: string) => void,
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
      // The document is normalized only once, so the server has no reason to keep it.
      // A warm up runs behind what is asked meanwhile
      { cache: false, priority: "background" },
    ),
  );
}

/** Whether the organization of this text was done before, so it is available without the AI */
export function isDocumentTextOrganized(currentPageTextWithPositions: string) {
  return isCached([currentPageTextWithPositions]);
}

/** Forgets the organization of this text, so it is done again by the AI */
export function forgetDocumentTextOrganization(currentPageTextWithPositions: string) {
  return clearCached([currentPageTextWithPositions]);
}
