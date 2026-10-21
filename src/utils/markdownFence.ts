const OPENING = /^[ \t]*```(?:markdown|md)[ \t]*$/im;
const FENCE = /^[ \t]*```/gm;

/**
 * Some answers come wrapped in a ```markdown block (as "here it is:\n\n```markdown\n...```"),
 * which would show the markdown as code. The block is unwrapped, keeping the text before it.
 * Blocks inside it (as ```mermaid) are kept: only the fence that closes the wrapping one is removed.
 */
export function unwrapMarkdownFence(answer: string) {
    const opening = OPENING.exec(answer);
    if (!opening) return answer;
    const before = answer.slice(0, opening.index);
    let content = answer.slice(opening.index + opening[0].length).replace(/^\r?\n/, '');
    // The inner blocks open and close in pairs, so an odd count means the last fence closes the wrapping block
    const fences = content.match(FENCE)?.length ?? 0;
    if (fences % 2 === 1) content = content.replace(/^[ \t]*```[ \t]*\s*$(?![\s\S]*^[ \t]*```)/m, '');
    return `${before}${content}`.trimEnd();
}
