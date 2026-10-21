import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { protectMoneyAmounts } from '../utils/math';
import MermaidDiagram from './MermaidDiagram';
import Styles from './Markdown.module.css';

// Kept out of the component, so they are the same on every render. Made again, React would take
// each renderer as a new component, and remount it (redrawing the diagrams) whenever the page re-renders
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: Parameters<typeof ReactMarkdown>[0]['rehypePlugins'] = [[rehypeKatex, { throwOnError: false, strict: false }]];
const COMPONENTS: Components = {
    // A ```mermaid block is drawn as a diagram, any other code block stays as code
    pre: ({ node, children: code }) => {
        const block = node?.children[0];
        const isMermaid =
            block?.type === 'element' &&
            block.tagName === 'code' &&
            String(block.properties.className ?? '').includes('language-mermaid');
        if (!isMermaid) return <pre>{code}</pre>;
        const source = block.children.map(child => ('value' in child ? child.value : '')).join('');
        return <MermaidDiagram source={source.trim()} />;
    },
    a: ({ href, children: label }) => (
        <a href={href} target="_blank" rel="noreferrer noopener">
            {label}
        </a>
    ),
};

/**
 * Renders markdown text, like the answers of the AI, with the formulas between $ (inline) and $$ (block) in LaTeX,
 * and the ```mermaid blocks as diagrams.
 * Raw HTML in the text is not rendered, and a formula that can't be read is shown as it is, in red, instead of breaking the rest.
 * It only renders again when its text changes, not on every render of what is around it (as when typing a question).
 */
export default memo(function Markdown({
    children,
    className,
    'data-testid': testId,
}: {
    children: string;
    className?: string;
    'data-testid'?: string;
}) {
    return (
        <div className={`${Styles.markdown} ${className ?? ''}`} data-testid={testId}>
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
                {protectMoneyAmounts(children)}
            </ReactMarkdown>
        </div>
    );
});
