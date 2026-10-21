import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { protectMoneyAmounts } from '../utils/math';
import Styles from './Markdown.module.css';

/**
 * Renders markdown text, like the answers of the AI, with the formulas between $ (inline) and $$ (block) in LaTeX.
 * Raw HTML in the text is not rendered, and a formula that can't be read is shown as it is, in red, instead of breaking the rest.
 */
export default function Markdown({
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
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
                components={{
                    a: ({ href, children: label }) => (
                        <a href={href} target="_blank" rel="noreferrer noopener">
                            {label}
                        </a>
                    ),
                }}
            >
                {protectMoneyAmounts(children)}
            </ReactMarkdown>
        </div>
    );
}
