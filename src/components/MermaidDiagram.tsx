import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Mermaid } from 'mermaid';
import { ExternalLink } from 'lucide-react';
import { TestIds } from '../testids';
import { blend, pageBackgroundOf, parseColor, readableTextOn, type Rgba } from '../utils/contrast';
import Styles from './MermaidDiagram.module.css';

let loading: Promise<Mermaid> | undefined;

/** Mermaid is big, so it is only loaded when the first diagram shows up */
function loadMermaid() {
    loading ??= import('mermaid').then(({ default: mermaid }) => {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            // The diagrams come from the AI: no scripts, no click handlers, sanitized labels
            securityLevel: 'strict',
            fontFamily: 'inherit',
            // Black by default, instead of the gray of the dark theme. Each label is then made black or white by what is behind it
            themeVariables: {
                textColor: '#000000',
                primaryTextColor: '#000000',
                secondaryTextColor: '#000000',
                tertiaryTextColor: '#000000',
                nodeTextColor: '#000000',
            },
        });
        return mermaid;
    });
    return loading;
}

const SHAPES = 'rect, polygon, circle, ellipse, path';

/** The color painted right behind a label: the last shape drawn before it that covers its center, or the page */
function backgroundBehind(label: Element, root: SVGSVGElement, page: Rgba): Rgba {
    const box = label.getBoundingClientRect();
    const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
    let behind: Rgba = page;
    for (const shape of root.querySelectorAll(SHAPES)) {
        // Only what is drawn before the label is under it
        if (!(shape.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING) || shape.contains(label)) continue;
        const { left, right, top, bottom } = shape.getBoundingClientRect();
        if (x < left || x > right || y < top || y > bottom) continue;
        const style = getComputedStyle(shape);
        const fill = parseColor(style.fill);
        if (!fill || fill.a === 0) continue;
        const opacity = Number(style.fillOpacity || 1) * Number(style.opacity || 1);
        behind = blend({ ...fill, a: fill.a * opacity }, behind);
    }
    return behind;
}

/**
 * Makes every label of the diagram black or white, whichever reads better over what is behind it,
 * as the colors of the nodes are chosen by the AI (or by the theme) and the default text can be lost on them
 */
function fitLabelColors(root: SVGSVGElement) {
    const page = pageBackgroundOf(root);
    for (const label of root.querySelectorAll('text, foreignObject')) {
        const color = readableTextOn(backgroundBehind(label, root, page));
        if (label instanceof SVGTextElement) {
            for (const text of [label, ...label.querySelectorAll('tspan')]) (text as SVGElement).style.setProperty('fill', color, 'important');
        } else {
            for (const html of label.querySelectorAll<HTMLElement>('*')) html.style.setProperty('color', color, 'important');
        }
    }
}

/** Opens the diagram alone on a new tab, where the browser zooms it as needed */
function openInNewTab(svg: string) {
    const page = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Diagrama</title>
<style>
    body { margin: 0; min-height: 100vh; display: flex; justify-content: center; align-items: center; background: #0f1115; }
    body > svg { width: min(96vw, 1600px); height: auto; max-width: none !important; margin: 2vw; }
</style>
</head>
<body>${svg}</body>
</html>`;
    const url = URL.createObjectURL(new Blob([page], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    // Long enough for the tab to load it
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

let diagramCount = 0;

/** The diagrams already drawn, by their source, so showing one again (as on another window) is instant */
const drawn = new Map<string, string>();

/** Draws a mermaid diagram. When it can't be read, its source is shown instead, without breaking the rest */
export default function MermaidDiagram({ source }: { source: string }) {
    const [svg, setSvg] = useState<string | undefined>(() => drawn.get(source));
    const [failed, setFailed] = useState(false);
    const container = useRef<HTMLDivElement>(null);

    // Once it is on the page, as the colors behind the labels are only known then
    useLayoutEffect(() => {
        const root = container.current?.querySelector('svg');
        if (root) fitLabelColors(root);
    }, [svg]);

    useEffect(() => {
        const known = drawn.get(source);
        if (known) {
            setSvg(known);
            setFailed(false);
            return;
        }
        let cancelled = false;
        const id = `mermaid-diagram-${++diagramCount}`;
        setSvg(undefined);
        setFailed(false);
        (async () => {
            try {
                const mermaid = await loadMermaid();
                // Checked first, as a failed render leaves its error drawing on the page
                await mermaid.parse(source);
                const { svg: diagram } = await mermaid.render(id, source);
                drawn.set(source, diagram);
                if (!cancelled) setSvg(diagram);
            } catch {
                document.getElementById(`d${id}`)?.remove();
                if (!cancelled) setFailed(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [source]);

    if (failed) {
        return (
            <div className={Styles.failed} data-testid={TestIds.markdown.mermaidError}>
                <pre>
                    <code>{source}</code>
                </pre>
                <p>Não foi possível desenhar o diagrama.</p>
            </div>
        );
    }
    if (!svg) return <div className={Styles.loading} data-testid={TestIds.markdown.mermaidLoading} aria-busy />;
    return (
        <div className={Styles.frame}>
            <div ref={container} className={Styles.diagram} data-testid={TestIds.markdown.mermaid} dangerouslySetInnerHTML={{ __html: svg }} />
            <button
                type="button"
                className={Styles.open}
                data-testid={TestIds.markdown.mermaidOpen}
                title="Abrir em uma nova aba"
                aria-label="Abrir em uma nova aba"
                // As it is on the page, with the colors of its labels already fit
                onClick={() => openInNewTab(container.current?.innerHTML ?? svg)}
            >
                <ExternalLink size={13} strokeWidth={1.5} />
            </button>
        </div>
    );
}
