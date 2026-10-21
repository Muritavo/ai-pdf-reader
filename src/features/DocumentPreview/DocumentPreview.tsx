import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import Text from '@onepercentio/one-ui/components/Text';
import PixelatedScan from '@onepercentio/one-ui/components/PixelatedScan';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useAsyncMemo from '@onepercentio/one-ui/hooks/utility/useAsyncMemo';
import useLocalStorage from '@onepercentio/one-ui/hooks/persistence/useLocalStorage';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Brain } from 'lucide-react';
import type { FullText } from '../../models/Article';
import { useWarmUp } from '../../context/AIContext';
import { highlightTextLayer, occurrencesOf, useHighlightsForPDF, wordOfOccurrence } from '../../utils/highlight';
import { recordReadingProgress, saveLastOpening } from '../../utils/readingProgress';
import FeaturesMenu, { type FeaturesMenuHandle } from './components/FeaturesMenu';
import AnnotationsToolbar, { type MarkerItem } from './components/AnnotationsToolbar';
import DocumentPromptBar from './components/DocumentPromptBar';
import { TestIds } from '../../testids';
import Styles from './DocumentPreview.module.scss';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const SCAN_COLOR = '#7c9cff';

type PageElement = {
    id: number;
    canvasRef: RefObject<HTMLCanvasElement>;
    textLayerRef: RefObject<HTMLDivElement>;
};

type ClickPosition = {
    x: number;
    y: number;
    key: number;
};

export default function DocumentPreview({ fullText }: { fullText: FullText }) {
    const { txt } = useShortIntl();
    const { hash } = fullText;
    const warmUp = useWarmUp(fullText);
    const [pages, setPages] = useState<PageElement[]>([]);
    const [loading, setLoading] = useState(false);
    const [textLayers, setTextLayers] = useState<pdfjsLib.TextLayer[]>();
    const { addHighlight, removeHighlight, highlightRules } = useHighlightsForPDF(hash);
    // The page of each occurrence of every highlighted text, found once they are drawn
    const [highlightPages, setHighlightPages] = useState<Record<string, number[]>>({});
    const [focusedMarker, setFocusedMarker] = useState<number>();
    const highlightCursor = useRef<Record<string, number>>({});
    const menuRef = useRef<FeaturesMenuHandle>(null);
    const previewBoxRef = useRef<HTMLDivElement>(null);
    const [pdf] = useAsyncMemo(async () => {
        const response = await fetch(fullText.url);
        const pdfBytes = new Uint8Array(await response.arrayBuffer());
        return pdfjsLib.getDocument({ data: pdfBytes }).promise;
    }, [fullText.url]);
    const [lastClick, setLastClick] = useLocalStorage<ClickPosition | null>(`lastClick-${hash}`, null);
    const [pointsOfInterest, setPointsOfInterest] = useLocalStorage<Array<ClickPosition & { word?: string }>>(
        `poi-${hash}`,
        [],
    );
    const clickCounterRef = useRef(0);

    /** Converts viewport coordinates into percentages of the scrollable document */
    function toDocumentCoordinates(clientX: number, clientY: number) {
        const box = previewBoxRef.current!;
        const rect = box.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * 100;
        const scrolledPercent = box.scrollTop / box.scrollHeight;
        const clickedRelativePercent = (clientY - rect.top) / rect.height;
        const movedInPixels = scrolledPercent * box.scrollHeight + clickedRelativePercent * box.clientHeight;
        return { x, y: (movedInPixels / box.scrollHeight) * 100 };
    }

    const handleTextLayerClick = (e: MouseEvent) => {
        if (!previewBoxRef.current) return;
        clickCounterRef.current += 1;
        setLastClick({ ...toDocumentCoordinates(e.clientX, e.clientY), key: clickCounterRef.current });
    };

    const getDocumentCoordinates = () => {
        const selection = window.getSelection();
        if (!previewBoxRef.current || !selection || selection.rangeCount === 0) return { x: 0, y: 0 };
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        return toDocumentCoordinates(rect.left, rect.top);
    };

    const addPointOfInterest = (x: number, y: number, word?: string) => {
        // Continues after the ones that were saved, as the key is how a marker is told apart
        clickCounterRef.current = Math.max(clickCounterRef.current, lastClick?.key ?? 0, ...pointsOfInterest.map(poi => poi.key)) + 1;
        const key = clickCounterRef.current;
        setPointsOfInterest(prev => [...prev, { x, y, key, word }]);
    };

    /** The 1 based page that holds a position of the document, given as a percentage of its height */
    function pageAt(yPercent: number) {
        const box = previewBoxRef.current;
        if (!box) return 1;
        const position = (box.scrollHeight * yPercent) / 100;
        const wrappers = [...box.querySelectorAll<HTMLElement>(`[data-testid="${TestIds.preview.page}"]`)];
        const index = wrappers.findIndex(wrapper => position < wrapper.offsetTop + wrapper.offsetHeight);
        return (index === -1 ? wrappers.length : index + 1) || 1;
    }

    const getMarkers = (): MarkerItem[] =>
        [...pointsOfInterest]
            .sort((a, b) => a.y - b.y)
            .map(poi => ({ key: poi.key, word: poi.word, page: pageAt(poi.y) }));

    /** Scrolls the document so something that is at `top` pixels of it stays in the middle of the screen */
    function scrollToMiddle(top: number) {
        const box = previewBoxRef.current!;
        box.scrollTo({ top: top - box.clientHeight / 2, behavior: 'smooth' });
    }

    const goToMarker = (key: number) => {
        const poi = pointsOfInterest.find(other => other.key === key);
        if (!poi) return;
        scrollToMiddle((previewBoxRef.current!.scrollHeight * poi.y) / 100);
        setFocusedMarker(key);
        window.setTimeout(() => setFocusedMarker(current => (current === key ? undefined : current)), 1800);
    };

    /** Goes to the next occurrence of the highlighted text each time, coming back to the first after the last */
    const goToHighlight = (normalizedWord: string) => {
        const box = previewBoxRef.current!;
        const boxTop = box.getBoundingClientRect().top;
        // An occurrence can be in more than one piece, when other highlights cut it
        const occurrences = new Map<string, { marks: HTMLElement[]; top: number }>();
        for (const mark of box.querySelectorAll<HTMLElement>('mark')) {
            for (const token of occurrencesOf(mark)) {
                if (wordOfOccurrence(token) !== normalizedWord) continue;
                const top = mark.getBoundingClientRect().top - boxTop + box.scrollTop;
                const found = occurrences.get(token);
                if (found) found.marks.push(mark);
                else occurrences.set(token, { marks: [mark], top });
            }
        }
        const ordered = [...occurrences.values()].sort((a, b) => a.top - b.top);
        if (!ordered.length) return;
        const next = ((highlightCursor.current[normalizedWord] ?? -1) + 1) % ordered.length;
        highlightCursor.current[normalizedWord] = next;
        scrollToMiddle(ordered[next].top);
        for (const mark of ordered[next].marks) {
            mark.classList.add(Styles.wordPulse);
            window.setTimeout(() => mark.classList.remove(Styles.wordPulse), 1800);
        }
    };

    const highlightClickIndicator = () => {
        const indicator = previewBoxRef.current?.querySelector<HTMLElement>(`.${Styles.clickIndicator}`);
        if (!indicator) return;
        indicator.classList.add(Styles.highlight);
        setTimeout(() => indicator.classList.remove(Styles.highlight), 2000);
    };

    // A document warmed up before does not need to be warmed up again, which is found without the AI
    useEffect(() => {
        warmUp.checkWarmedUpBefore();
    }, [fullText.hash]);

    useEffect(() => {
        const listener = () => window.setTimeout(() => menuRef.current?.closeMenu(), 0);
        window.addEventListener('mouseup', listener);
        return () => window.removeEventListener('mouseup', listener);
    }, []);

    // Brings the attention back to where the user stopped when returning to this tab
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') highlightClickIndicator();
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'w') highlightClickIndicator();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    useEffect(() => {
        if (!pdf) return;
        setLoading(true);
        setTextLayers(undefined);
        setPages(
            Array.from({ length: pdf.numPages }, (_, i) => ({
                id: i + 1,
                canvasRef: { current: null },
                textLayerRef: { current: null },
            })),
        );
        setLoading(false);
    }, [pdf]);

    const renderPage = async (pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number, element: PageElement) => {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const pageViewport = page.getViewport({ scale: 1 });

            // Scales the page to fit the container width
            const containerWidth = previewBoxRef.current?.clientWidth || 800;
            const scale = containerWidth / pageViewport.width;
            const viewport = page.getViewport({ scale });
            const textLayerViewport = page.getViewport({ scale: 1 });

            const canvas = element.canvasRef.current;
            const textLayerContainer = element.textLayerRef.current;
            const context = canvas?.getContext('2d');
            if (!canvas || !textLayerContainer || !context) return;

            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvas, canvasContext: context, viewport }).promise;

            textLayerContainer.innerHTML = '';
            const textLayer = new pdfjsLib.TextLayer({
                container: textLayerContainer,
                textContentSource: page.streamTextContent(),
                viewport: textLayerViewport,
            });
            await textLayer.render();
            textLayerContainer.style.transform = `scale(${scale})`;
            textLayerContainer.style.width = `${textLayerViewport.width}px`;
            textLayerContainer.style.height = `${textLayerViewport.height}px`;

            return textLayer;
        } catch (err) {
            console.error(`Error rendering page ${pageNum}:`, err);
        }
    };

    useEffect(() => {
        if (!pdf || !pages.length) return;
        let cancelled = false;
        (async () => {
            const rendered: pdfjsLib.TextLayer[] = [];
            for (let i = 0; i < pages.length; i++) {
                const textLayer = await renderPage(pdf, i + 1, pages[i]);
                if (textLayer) rendered.push(textLayer);
            }
            if (!cancelled) setTextLayers(rendered);
        })();
        return () => {
            cancelled = true;
        };
    }, [pages, pdf]);

    // Keeps how far the document was read, once every page is rendered and the height is known
    useEffect(() => {
        const box = previewBoxRef.current;
        if (!box || !textLayers) return;
        let frame = 0;
        // Kept on the side, as a closed document can't be measured anymore
        let reached = (box.scrollTop + box.clientHeight) / box.scrollHeight;
        const record = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                reached = (box.scrollTop + box.clientHeight) / box.scrollHeight;
                recordReadingProgress(hash, reached);
            });
        };
        // Where the reader stopped, saved when leaving the document, or the page
        const saveWhereStopped = () => saveLastOpening(hash, reached);
        record();
        box.addEventListener('scroll', record, { passive: true });
        window.addEventListener('pagehide', saveWhereStopped);
        return () => {
            cancelAnimationFrame(frame);
            box.removeEventListener('scroll', record);
            window.removeEventListener('pagehide', saveWhereStopped);
            // Only when the document was really left, not when this effect restarts with it still on the screen
            if (!box.isConnected) saveWhereStopped();
        };
    }, [textLayers, hash]);

    useEffect(() => {
        if (!textLayers || !highlightRules) return;
        // Drawn even with no rules, so what was removed stops being highlighted
        textLayers.forEach((textLayer, layerIndex) => {
            const pieces = textLayer.textDivs
                .map((element, index) => ({ element, text: textLayer.textContentItemsStr[index] }))
                .filter(piece => piece.text);
            highlightTextLayer(pieces, highlightRules, Styles.wordHighlight, TestIds.preview.highlight, `${layerIndex}`);
        });
        highlightCursor.current = {};
        // The page of every occurrence, counted once even when it is in more than one piece
        const found: Record<string, number[]> = {};
        const counted = new Set<string>();
        for (const page of pages) {
            page.textLayerRef.current?.querySelectorAll<HTMLElement>('mark').forEach(mark => {
                for (const token of occurrencesOf(mark)) {
                    if (counted.has(token)) continue;
                    counted.add(token);
                    (found[wordOfOccurrence(token)] ??= []).push(page.id);
                }
            });
        }
        setHighlightPages(found);
    }, [highlightRules, textLayers]);

    const scrollHeight = previewBoxRef.current?.scrollHeight ?? 0;

    return (
        <div className={Styles.container}>
            {loading && (
                <div className={Styles.loaderOverlay}>
                    <Dots />
                </div>
            )}
            <div
                ref={previewBoxRef}
                data-testid={TestIds.preview.box}
                className={Styles.previewBox}
                onMouseUp={() => window.setTimeout(() => menuRef.current?.openMenu(), 0)}
            >
                {!pdf && (
                    <div className={Styles.loaderOverlay}>
                        <Dots />
                    </div>
                )}
                {pages.map(page => (
                    <div key={page.id} className={Styles.pageWrapper} data-testid={TestIds.preview.page}>
                        <canvas ref={page.canvasRef} data-testid={TestIds.preview.canvas} />
                        <div
                            ref={page.textLayerRef}
                            data-testid={TestIds.preview.textLayer}
                            className={Styles.textLayer}
                            onClick={handleTextLayerClick}
                        />
                        {warmUp.state === 'running' && warmUp.page === page.id && (
                            <div className={Styles.readingPage}>
                                <PixelatedScan
                                    key={textLayers ? 'rendered' : 'rendering'}
                                    squaresByLine={24}
                                    color={SCAN_COLOR}
                                />
                            </div>
                        )}
                    </div>
                ))}
                {lastClick && (
                    <div
                        key={lastClick.key}
                        data-testid={TestIds.preview.lastClickMarker}
                        className={Styles.clickIndicator}
                        style={{ left: `${lastClick.x}%`, top: `${scrollHeight * (lastClick.y / 100)}px` }}
                    />
                )}
                {pointsOfInterest.map(poi => (
                    <div
                        key={poi.key}
                        data-testid={TestIds.preview.pointOfInterest}
                        className={`${Styles.poiIndicator} ${focusedMarker === poi.key ? Styles.poiFocus : ''}`}
                        title={poi.word}
                        style={{ left: `${poi.x}%`, top: `${scrollHeight * (poi.y / 100)}px` }}
                    >
                        <Brain size={18} color="#ffa8f1" />
                    </div>
                ))}
            </div>
            <AnnotationsToolbar
                highlights={(highlightRules ?? []).map(rule => ({
                    normalizedWord: rule.normalizedWord,
                    word: rule.word,
                    color: rule.color,
                    pages: highlightPages[rule.normalizedWord] ?? [],
                }))}
                getMarkers={getMarkers}
                onGoToHighlight={goToHighlight}
                onRemoveHighlight={removeHighlight}
                onGoToMarker={goToMarker}
                onRemoveMarker={key => setPointsOfInterest(prev => prev.filter(poi => poi.key !== key))}
            />
            <FeaturesMenu
                ref={menuRef}
                addHighlight={addHighlight}
                fullText={fullText}
                aiReady={warmUp.ready}
                getDocumentCoordinates={getDocumentCoordinates}
                onMarkLocation={addPointOfInterest}
            />
            <DocumentPromptBar fullText={fullText} />
        </div>
    );
}
