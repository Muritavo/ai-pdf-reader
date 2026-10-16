import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Styles from './Markdown.module.css';

/** Renders markdown text, like the answers of the AI. Raw HTML in the text is not rendered */
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
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ href, children: label }) => (
                        <a href={href} target="_blank" rel="noreferrer noopener">
                            {label}
                        </a>
                    ),
                }}
            >
                {children}
            </ReactMarkdown>
        </div>
    );
}
