import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import Text from '@onepercentio/one-ui/components/Text';
import PixelatedScan from '@onepercentio/one-ui/components/PixelatedScan';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useAsyncMemo from '@onepercentio/one-ui/hooks/utility/useAsyncMemo';
import useLocalStorage from '@onepercentio/one-ui/hooks/persistence/useLocalStorage';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { ArrowLeft, Brain, Check, Copy, RotateCw, Search } from 'lucide-react';
import type { FullText } from '../../models/Article';
import { useWarmUp } from '../../context/AIContext';
import {
    definitionsOf,
    highlightTextLayer,
    occurrencesOf,
    useDefinitionsForPDF,
    useHighlightsForPDF,
    wordOfOccurrence,
} from '../../utils/highlight';
import { getLastOpening, recordReadingProgress, saveLastOpening } from '../../utils/readingProgress';
import FeaturesMenu, { type FeaturesMenuHandle } from './components/FeaturesMenu';
import AnnotationsToolbar, { type MarkerItem, type NoteItem } from './components/AnnotationsToolbar';
import DocumentActions from './components/DocumentActions';
import useToggleAction from '../../hooks/useToggleAction';
import TextLayerOffset, { type Offset } from './components/TextLayerOffset';
import ImageQuestion, { type ImageQuestionEntry } from './components/ImageQuestion';
import { cropImage, imageBoxesOf, rotateBox, unrotateBox, type ImageBox, type PageRotation } from '../../utils/pageImages';
import { dragZone } from '../../utils/dragZone';
import { unwrapMarkdownFence } from '../../utils/markdownFence';
import { getNormalizedText } from '../../utils/preprocessing';
import { createStreamedWords, uniqueExcerptsOfPage } from '../../utils/progressTracker';
import { scoped } from '../../utils/projects';
import { replaceInPieces, type TextReplacement } from '../../utils/textReplacements';
import useShortcut from '../../hooks/useShortcut';
import ResponseModal from './components/ResponseModal/ResponseModal';
import { askAboutImage, forgetWordDefinition, REFERENCE_NOT_FOUND } from '../../services/ai';
import { googleSearchUrl, referencesOf } from '../../utils/references';
import ResponseModalStyles from './components/ResponseModal/ResponseModal.module.scss';
import Button from '@onepercentio/one-ui/components/Button';
import DocumentPromptBar, { type DocumentPromptBarHandle } from './components/DocumentPromptBar';
import { TestIds } from '../../testids';
import type { PluginResult } from '../../plugins/types';
import Styles from './DocumentPreview.module.scss';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const SCAN_COLOR = '#7c9cff';

/** The most pixels a page is drawn with, so a big screen and a long document don't run out of memory */
const MAX_CANVAS_PIXELS = 4096 * 4096;

/** Whether a line ends between two pieces of the text layer: pdf.js puts a <br> where it does */
function endsLine(element: HTMLElement, next: HTMLElement | undefined) {
    if (!next) return true;
    const range = element.ownerDocument.createRange();
    range.setStartAfter(element);
    range.setEndBefore(next);
    return range.cloneContents().querySelector('br') !== null;
}

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
    const { addDefinition, removeDefinitions, definitionRules } = useDefinitionsForPDF(hash);
    // While Ctrl is held, a click on a defined excerpt removes its definition
    // The page of each occurrence of every highlighted text, found once they are drawn
    const [highlightPages, setHighlightPages] = useState<Record<string, number[]>>({});
    const [focusedMarker, setFocusedMarker] = useState<number>();
    const [reference, setReference] = useState<{ passage: string; answer: string }>();
    const [definition, setDefinition] = useState<{ word: string; definition: string }>();
    const [pluginResult, setPluginResult] = useState<PluginResult>();
    // The images of each page, recorded while drawing it, and the one a question is being written about
    const [imageBoxes, setImageBoxes] = useState<Record<number, ImageBox[]>>({});
    const [askingImage, setAskingImage] = useState<{ page: number; index: number }>();
    // The zone being drawn with Alt + drag, and once dropped, until it is defined as an image
    const [newZone, setNewZone] = useState<{ page: number; box: ImageBox; dragging: boolean }>();
    // The image just copied, by its page and its place on the page, shown as copied for a moment
    const [copiedImage, setCopiedImage] = useState<string>();
    const [imageAnswer, setImageAnswer] = useState<{ question: string; answer: string; image: string }>();
    // Where the document was left the last time: the scroll to go back to, and how far down the scroll bar it is
    const [goBack, setGoBack] = useState<{ top: number; barTop: number }>();
    const highlightCursor = useRef<Record<string, number>>({});
    const menuRef = useRef<FeaturesMenuHandle>(null);
    const promptBarRef = useRef<DocumentPromptBarHandle>(null);
    const previewBoxRef = useRef<HTMLDivElement>(null);
    // Ctrl held on the keyboard, or turned on with the toggle under the preview's window on the Vision Pro
    const removingDefinitions = useToggleAction('ctrl', previewBoxRef);
    const lastPointerTypeRef = useRef<string>();
    // The word selected by a double click, while it is dragged: null while waiting for it, undefined when not double clicking
    const doubleClickedWordRef = useRef<Range | null>();
    const scrollBarRef = useRef<HTMLDivElement>(null);
    const [pdf] = useAsyncMemo(async () => {
        const response = await fetch(fullText.url);
        const pdfBytes = new Uint8Array(await response.arrayBuffer());
        return pdfjsLib.getDocument({
            data: pdfBytes,
            // The fonts of the PDF are loaded into the document the pages are drawn in, which on AR is the window of the
            // dialog: drawn with fonts loaded into another document, the text would come out as squares
            ownerDocument: previewBoxRef.current?.ownerDocument ?? document,
        }).promise;
    }, [fullText.url]);
    const [lastClick, setLastClick] = useLocalStorage<ClickPosition | null>(scoped(`lastClick-${hash}`), null);
    const [pointsOfInterest, setPointsOfInterest] = useLocalStorage<Array<ClickPosition & { word?: string }>>(
        scoped(`poi-${hash}`),
        [],
    );
    const [notes, setNotes] = useLocalStorage<NoteItem[]>(scoped(`notes-${hash}`), []);
    // How far the text layer is moved over the pages, for the documents where it is a bit off from the drawn text
    const [textLayerOffset, setTextLayerOffset] = useLocalStorage<Offset>(scoped(`textLayerOffset-${hash}`), { x: 0, y: 0 });
    // The questions asked about each image, by its page and its place on the page
    const [imageHistory, setImageHistory] = useLocalStorage<Record<string, ImageQuestionEntry[]>>(
        scoped(`imageHistory-${hash}`),
        {},
    );
    // The zones defined as images by hand, by page, for the figures pdf.js doesn't record as images (as the ones drawn as vectors)
    const [imageZones, setImageZones] = useLocalStorage<Record<number, ImageBox[]>>(scoped(`imageZones-${hash}`), {});
    // The texts shown as other ones, for the documents whose text is not what is drawn (as a β read as an "A")
    const [textReplacements, setTextReplacements] = useLocalStorage<TextReplacement[]>(scoped(`textReplacements-${hash}`), []);
    // The pages shown turned a quarter clockwise, for the ones printed sideways (as wide tables)
    const [landscapePages, setLandscapePages] = useLocalStorage<number[]>(scoped(`landscapePages-${hash}`), []);
    const rotationOf = (pageId: number): PageRotation => (landscapePages.includes(pageId) ? 90 : 0);
    // Read by the drawing of every page, which is not started again when a page is turned
    const rotationOfRef = useRef(rotationOf);
    rotationOfRef.current = rotationOf;
    // The text layer of each page, so turning one page draws only that page again
    const textLayerOfPage = useRef<Record<number, pdfjsLib.TextLayer>>({});
    // How each page was turned the first time it was drawn: pdf.js keeps the images it recorded then, as they were drawn
    const imagesRecordedRotation = useRef<Record<number, PageRotation>>({});
    const clickCounterRef = useRef(0);

    // Alt + R replaces the selected text, wherever it is in the document
    useShortcut(() => {
        const selection = window.getSelection();
        const from = selection?.toString().trim();
        if (!from || !previewBoxRef.current?.contains(selection!.anchorNode)) return;
        const to = window.prompt(txt('documentPreview.replaceText', { word: from }));
        if (to === null || to === from) return;
        setTextReplacements(prev => [...prev.filter(replacement => replacement.from !== from), { from, to }]);
    }, 'alt', 'r');

    /** The window the document is in: on AR the dialog has its own, where its selection and events happen */
    const previewWindow = () => previewBoxRef.current?.ownerDocument.defaultView ?? window;

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
        // Alt is held while drawing a zone, whose drop is not a click on the text
        if (!previewBoxRef.current || e.altKey) return;
        clickCounterRef.current += 1;
        setLastClick({ ...toDocumentCoordinates(e.clientX, e.clientY), key: clickCounterRef.current });
    };

    /** The images of a page, where they are on the page as shown: the ones recorded while drawing it, then the zones defined by hand */
    const boxesOf = (pageId: number) =>
        [...(imageBoxes[pageId] ?? []), ...(imageZones[pageId] ?? [])].map(box => rotateBox(box, rotationOf(pageId)));

    /** Alt + drag on a page draws a zone, to be defined as an image once dropped */
    const startZone = (e: MouseEvent<HTMLDivElement>, pageId: number) => {
        const started = dragZone(e, {
            scroller: previewBoxRef.current,
            onChange: box => setNewZone({ page: pageId, box, dragging: true }),
            onDrop: box => setNewZone(box ? { page: pageId, box, dragging: false } : undefined),
        });
        if (!started) return;
        setAskingImage(undefined);
        setNewZone(undefined);
    };

    /** Copies the image, cut out of the drawn page, to the clipboard */
    const copyImage = (canvas: HTMLCanvasElement, box: ImageBox, key: string) => {
        // Given as a promise, so the clipboard is written in the click itself (as Safari requires)
        const png = fetch(cropImage(canvas, box)).then(response => response.blob());
        navigator.clipboard
            .write([new ClipboardItem({ 'image/png': png })])
            .then(() => {
                setCopiedImage(key);
                window.setTimeout(() => setCopiedImage(current => (current === key ? undefined : current)), 1200);
            })
            .catch(err => console.error('Could not copy the image:', err));
    };

    /** Puts back in the selection the word a double click selected, when Safari dropped it while dragging (see the workaround for Safari) */
    const keepDoubleClickedWord = () => {
        const word = doubleClickedWordRef.current;
        doubleClickedWordRef.current = undefined;
        const selection = previewWindow().getSelection();
        if (!word || !selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        const startsBeforeWord = range.compareBoundaryPoints(Range.START_TO_START, word) < 0;
        const endsAfterWord = range.compareBoundaryPoints(Range.END_TO_END, word) > 0;
        const holdsWord = range.compareBoundaryPoints(Range.START_TO_START, word) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, word) >= 0;
        // As on the other browsers, nothing is missing
        if (holdsWord) return;
        // Dragged back: from the end of the word to where the drag stopped
        if (startsBeforeWord) selection.setBaseAndExtent(word.endContainer, word.endOffset, range.startContainer, range.startOffset);
        // Dragged forward: from the start of the word to where the drag stopped
        else if (endsAfterWord) selection.setBaseAndExtent(word.startContainer, word.startOffset, range.endContainer, range.endOffset);
    };

    const getDocumentCoordinates = () => {
        const selection = previewWindow().getSelection();
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

    /** Removes the definitions of the defined excerpt under a Ctrl click. True when there was one */
    const removeDefinitionAt = (event: MouseEvent) => {
        if (!removingDefinitions) return false;
        const mark = (event.target as HTMLElement).closest<HTMLElement>('mark[data-defined]');
        if (!mark) return false;
        event.preventDefault();
        event.stopPropagation();
        const normalizedWords = definitionsOf(mark);
        // Only once the document is warmed up, as its text is what the definitions were cached with,
        // and getting it otherwise would normalize the document again
        if (warmUp.state === 'done') {
            const words = (definitionRules ?? []).filter(rule => normalizedWords.includes(rule.normalizedWord)).map(rule => rule.word);
            getNormalizedText(fullText)
                .then(context => Promise.all(words.map(word => forgetWordDefinition(word, context))))
                .catch(() => {});
        }
        removeDefinitions(normalizedWords);
        return true;
    };

    // A bar on the left, along what is seen of the document, as long as how far it was scrolled.
    // Set on the element itself, so scrolling does not render the whole preview again
    useEffect(() => {
        const box = previewBoxRef.current;
        const bar = scrollBarRef.current;
        if (!box || !bar) return;
        let frame = 0;
        const update = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const scrollable = box.scrollHeight - box.clientHeight;
                const scrolled = scrollable > 0 ? box.scrollTop / scrollable : 0;
                bar.style.top = `${box.offsetTop}px`;
                bar.style.height = `${box.clientHeight * scrolled}px`;
                bar.dataset.progress = String(Math.round(scrolled * 100));
            });
        };
        update();
        box.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        return () => {
            cancelAnimationFrame(frame);
            box.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
        };
    }, [textLayers]);

    // A document warmed up before does not need to be warmed up again, which is found without the AI
    useEffect(() => {
        warmUp.checkWarmedUpBefore();
    }, [fullText.hash]);

    useEffect(() => {
        const view = previewWindow();
        const listener = () => window.setTimeout(() => menuRef.current?.closeMenu(), 0);
        view.addEventListener('mouseup', listener);
        return () => view.removeEventListener('mouseup', listener);
    }, []);

    // WORKAROUND for Safari: https://bugs.webkit.org/show_bug.cgi?id=333120
    // After a double click, dragging back and stopping on a one character word (as the "2" of "2-hydroxyestrone")
    // drops the double clicked word from the selection, leaving only "2-". The word is the first selection after
    // the double click, so it is kept here and put back on the mouse up (see `keepDoubleClickedWord`)
    useEffect(() => {
        const view = previewWindow();
        const listener = () => {
            if (doubleClickedWordRef.current !== null) return;
            const selection = view.getSelection();
            if (selection && !selection.isCollapsed) doubleClickedWordRef.current = selection.getRangeAt(0).cloneRange();
        };
        view.document.addEventListener('selectionchange', listener);
        return () => view.document.removeEventListener('selectionchange', listener);
    }, []);

    // A touch selection has no mouse up, so the menu follows the selection once it stops changing
    useEffect(() => {
        const view = previewWindow();
        let timeout: number;
        const listener = () => {
            if (lastPointerTypeRef.current !== 'touch') return;
            window.clearTimeout(timeout);
            timeout = window.setTimeout(() => {
                // Tapping the menu clears the selection, which must not close it while an option is working
                const selection = view.getSelection();
                if (!selection || selection.isCollapsed || !previewBoxRef.current?.contains(selection.anchorNode)) return;
                menuRef.current?.openMenu(true);
            }, 300);
        };
        view.document.addEventListener('selectionchange', listener);
        return () => {
            window.clearTimeout(timeout);
            view.document.removeEventListener('selectionchange', listener);
        };
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
        textLayerOfPage.current = {};
        imagesRecordedRotation.current = {};
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

    const renderPage = async (
        pdfDoc: pdfjsLib.PDFDocumentProxy,
        pageNum: number,
        element: PageElement,
        rotation: PageRotation,
    ) => {
        try {
            const page = await pdfDoc.getPage(pageNum);
            // Turned by pdf.js, so the canvas is drawn wide and the page fills the width of the preview as a wide one
            const pageViewport = page.getViewport({ scale: 1, rotation });

            // Scales the page to fit the container width
            const containerWidth = previewBoxRef.current?.clientWidth || 800;
            const scale = containerWidth / pageViewport.width;
            const viewport = page.getViewport({ scale, rotation });
            // Not turned: the text layer is turned with the transform below, along with its scale
            const textLayerViewport = page.getViewport({ scale: 1 });

            const canvas = element.canvasRef.current;
            const textLayerContainer = element.textLayerRef.current;
            const context = canvas?.getContext('2d');
            if (!canvas || !textLayerContainer || !context) return;

            // Drawn with every pixel of the screen (2 for each CSS pixel on a Retina one), so the page is sharp.
            // Kept under a limit, as every page is drawn at once
            const pixelRatio = Math.min(
                window.devicePixelRatio || 1,
                Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)),
            );
            canvas.width = Math.floor(viewport.width * pixelRatio);
            canvas.height = Math.floor(viewport.height * pixelRatio);
            canvas.style.width = `${Math.floor(viewport.width)}px`;
            canvas.style.height = `${Math.floor(viewport.height)}px`;
            const drawing = page.render({
                canvas,
                canvasContext: context,
                viewport,
                transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : undefined,
                // Where each image is drawn, so a question can be asked about it
                recordImages: true,
            });
            await drawing.promise;
            // Kept by pdf.js on the page: the getter of the render task reads a field it never sets
            // Recorded only on the first drawing of the page, so they are turned as the page was then. Kept as on the page in the PDF
            const recordedRotation = (imagesRecordedRotation.current[pageNum] ??= rotation);
            setImageBoxes(current => ({
                ...current,
                [pageNum]: imageBoxesOf(page.imageCoordinates).map(box => unrotateBox(box, recordedRotation)),
            }));

            textLayerContainer.innerHTML = '';
            const textLayer = new pdfjsLib.TextLayer({
                container: textLayerContainer,
                textContentSource: page.streamTextContent(),
                viewport: textLayerViewport,
            });
            await textLayer.render();
            // Moved before scaling, so the offset is in pixels of the screen. Read from the preview, so changing it does not draw the pages again
            // A turned page has its text layer turned around its top left corner, then moved back down over the page
            const turn = rotation ? ` rotate(${rotation}deg)` : '';
            const backOver = rotation ? ' translateY(-100%)' : '';
            textLayerContainer.style.transform = `translate(var(--text-layer-x, 0px), var(--text-layer-y, 0px))${turn} scale(${scale})${backOver}`;
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
                const textLayer = await renderPage(pdf, i + 1, pages[i], rotationOfRef.current(i + 1));
                if (!textLayer) continue;
                textLayerOfPage.current[i + 1] = textLayer;
                rendered.push(textLayer);
            }
            if (!cancelled) setTextLayers(rendered);
        })();
        return () => {
            cancelled = true;
        };
    }, [pages, pdf]);

    /** Shows a page wide (turned a quarter clockwise) or back as it is in the PDF, drawing only that page again */
    const toggleLandscape = async (page: PageElement) => {
        // Only once every page is drawn, as a canvas can't be drawn twice at once
        if (!pdf || !textLayers) return;
        const rotation: PageRotation = rotationOf(page.id) ? 0 : 90;
        setLandscapePages(prev => (rotation ? [...prev, page.id] : prev.filter(id => id !== page.id)));
        // Not about the page before
        setAskingImage(current => (current?.page === page.id ? undefined : current));
        setNewZone(current => (current?.page === page.id ? undefined : current));
        const before = textLayerOfPage.current[page.id];
        const textLayer = await renderPage(pdf, page.id, page, rotation);
        if (!textLayer) return;
        textLayerOfPage.current[page.id] = textLayer;
        // A new text layer, so the highlights are put on it again
        setTextLayers(current => current?.map(other => (other === before ? textLayer : other)));
    };

    // Keeps how far the document was read, once every page is rendered and the height is known
    useEffect(() => {
        const box = previewBoxRef.current;
        if (!box || !textLayers) return;
        let frame = 0;
        // Kept on the side, as a closed document can't be measured anymore
        let reached = (box.scrollTop + box.clientHeight) / box.scrollHeight;
        const follow = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                reached = (box.scrollTop + box.clientHeight) / box.scrollHeight;
            });
        };
        // Only where the reader stopped counts as read, when leaving the document or the page:
        // scrolling ahead to look at something (as a table) and coming back is not reading that far
        const saveWhereStopped = () => {
            saveLastOpening(hash, reached);
            recordReadingProgress(hash, reached);
        };
        box.addEventListener('scroll', follow, { passive: true });
        window.addEventListener('pagehide', saveWhereStopped);
        return () => {
            cancelAnimationFrame(frame);
            box.removeEventListener('scroll', follow);
            window.removeEventListener('pagehide', saveWhereStopped);
            // Only when the document was really left, not when this effect restarts with it still on the screen
            if (!box.isConnected) saveWhereStopped();
        };
    }, [textLayers, hash]);

    // Where the document was left the last time, offered until the first scroll, once every page is rendered
    useEffect(() => {
        const box = previewBoxRef.current;
        const lastOpening = getLastOpening(hash);
        if (!box || !textLayers || lastOpening === undefined) return;
        // Saved as the bottom of what was seen, scrolled to as its top
        const scrollable = box.scrollHeight - box.clientHeight;
        const top = Math.min(scrollable, lastOpening * box.scrollHeight - box.clientHeight);
        if (scrollable <= 0 || top <= 0) return;
        setGoBack({ top, barTop: box.offsetTop + box.clientHeight * (top / scrollable) });
        const dismiss = () => setGoBack(undefined);
        box.addEventListener('scroll', dismiss, { once: true, passive: true });
        return () => {
            box.removeEventListener('scroll', dismiss);
            setGoBack(undefined);
        };
    }, [textLayers, hash]);

    useEffect(() => {
        if (!textLayers || !highlightRules || !definitionRules) return;
        // Drawn even with no rules, so what was removed stops being highlighted
        textLayers.forEach((textLayer, layerIndex) => {
            // From the text as read, so a changed replacement doesn't build on the one before
            const texts = replaceInPieces(textLayer.textContentItemsStr, textReplacements);
            const pieces = textLayer.textDivs
                .map((element, index) => ({ element, text: texts[index], read: textLayer.textContentItemsStr[index] }))
                .filter(piece => piece.read)
                .map(({ element, text }, index, kept) => ({ element, text, endsLine: endsLine(element, kept[index + 1]?.element) }));
            highlightTextLayer(
                pieces,
                highlightRules,
                definitionRules,
                {
                    highlightClassName: Styles.wordHighlight,
                    definedClassName: Styles.definedTerm,
                    definedEndClassName: Styles.definedTermEnd,
                    highlightTestId: TestIds.preview.highlight,
                    definedTestId: TestIds.preview.definedTerm,
                },
                `${layerIndex}`,
            );
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
    }, [highlightRules, definitionRules, textLayers, textReplacements]);

    // While warming up, the pieces of each page light up as the AI writes them
    const streamedExcerpts = useRef<{
        textLayers: pdfjsLib.TextLayer[];
        words: ReturnType<typeof createStreamedWords>;
        /** Up to where of the streamed words the pieces were already looked for */
        searchedUpTo: number;
        waiting: { element: HTMLElement; key: string }[];
        lit: HTMLElement[];
    }>();
    useEffect(() => {
        const current = streamedExcerpts.current;
        // Started again for other text layers, as their pieces are other elements
        if (current && (warmUp.state !== 'running' || current.textLayers !== textLayers)) {
            current.lit.forEach(element => element.classList.remove(Styles.streamedExcerpt));
            streamedExcerpts.current = undefined;
        }
        if (warmUp.state !== 'running' || !textLayers || !warmUp.streamed) return;
        const tracking = (streamedExcerpts.current ??= {
            textLayers,
            words: createStreamedWords(),
            searchedUpTo: 0,
            waiting: textLayers.flatMap(textLayer =>
                uniqueExcerptsOfPage(textLayer.textContentItemsStr).map(({ index, key }) => ({
                    element: textLayer.textDivs[index],
                    key,
                })),
            ),
            lit: [],
        });
        const streamed = tracking.words.read(warmUp.streamed);
        tracking.waiting = tracking.waiting.filter(excerpt => {
            if (streamed.indexOf(excerpt.key, Math.max(0, tracking.searchedUpTo - excerpt.key.length)) === -1) return true;
            excerpt.element.classList.add(Styles.streamedExcerpt);
            tracking.lit.push(excerpt.element);
            return false;
        });
        tracking.searchedUpTo = streamed.length;
    }, [warmUp.state, warmUp.streamed, textLayers]);

    const scrollHeight = previewBoxRef.current?.scrollHeight ?? 0;

    return (
        <div className={Styles.container}>
            <div ref={scrollBarRef} className={Styles.scrollBar} data-testid={TestIds.preview.scrollBar} aria-hidden />
            {goBack && (
                <button
                    type="button"
                    className={Styles.goBack}
                    style={{ top: goBack.barTop }}
                    title={txt('documentPreview.goBack')}
                    aria-label={txt('documentPreview.goBack')}
                    data-testid={TestIds.preview.goBack}
                    onClick={() => previewBoxRef.current?.scrollTo({ top: goBack.top, behavior: 'smooth' })}
                >
                    <ArrowLeft size={14} strokeWidth={2} />
                </button>
            )}
            {loading && (
                <div className={Styles.loaderOverlay}>
                    <Dots />
                </div>
            )}
            <div
                ref={previewBoxRef}
                data-testid={TestIds.preview.box}
                className={`${Styles.previewBox} ${removingDefinitions ? Styles.removingDefinitions : ''}`}
                style={{ '--text-layer-x': `${textLayerOffset.x}px`, '--text-layer-y': `${textLayerOffset.y}px` } as CSSProperties}
                // Captured first, so the click does not move the last click marker too
                onClickCapture={removeDefinitionAt}
                // On macOS, Ctrl + click is the right click
                onContextMenu={removeDefinitionAt}
                onPointerDown={e => (lastPointerTypeRef.current = e.pointerType)}
                // Waits for the word a double click selects (see the workaround for Safari)
                onMouseDown={e => (doubleClickedWordRef.current = e.detail === 2 ? null : undefined)}
                onMouseUp={() => {
                    keepDoubleClickedWord();
                    window.setTimeout(() => menuRef.current?.openMenu(), 0);
                }}
            >
                {!pdf && (
                    <div className={Styles.loaderOverlay}>
                        <Dots />
                    </div>
                )}
                {pages.map(page => (
                    <div
                        key={page.id}
                        className={Styles.pageWrapper}
                        data-testid={TestIds.preview.page}
                        onMouseDown={e => startZone(e, page.id)}
                    >
                        <canvas ref={page.canvasRef} data-testid={TestIds.preview.canvas} />
                        <div
                            ref={page.textLayerRef}
                            data-testid={TestIds.preview.textLayer}
                            className={Styles.textLayer}
                            onClick={handleTextLayerClick}
                        />
                        {boxesOf(page.id).map((box, index) => (
                            <div
                                key={index}
                                className={Styles.imageBox}
                                data-testid={TestIds.preview.imageBox}
                                title={txt('imageQuestion.open')}
                                style={{
                                    left: `${box.left * 100}%`,
                                    top: `${box.top * 100}%`,
                                    width: `${box.width * 100}%`,
                                    height: `${box.height * 100}%`,
                                }}
                                onClick={e => {
                                    e.stopPropagation();
                                    // Alt is held while drawing a zone, whose drop is not a click on the image
                                    if (!e.altKey) setAskingImage({ page: page.id, index });
                                }}
                            >
                                <button
                                    type="button"
                                    className={Styles.imageBoxCopy}
                                    data-testid={TestIds.preview.imageBoxCopy}
                                    title={txt('imageQuestion.copy')}
                                    aria-label={txt('imageQuestion.copy')}
                                    onClick={e => {
                                        // Copies without opening the question
                                        e.stopPropagation();
                                        copyImage(page.canvasRef.current!, box, `${page.id}-${index}`);
                                    }}
                                >
                                    {copiedImage === `${page.id}-${index}` ? (
                                        <Check size={14} strokeWidth={1.75} />
                                    ) : (
                                        <Copy size={14} strokeWidth={1.75} />
                                    )}
                                </button>
                            </div>
                        ))}
                        {newZone?.page === page.id && (
                            <div
                                className={Styles.imageZone}
                                data-testid={TestIds.preview.imageZone}
                                style={{
                                    left: `${newZone.box.left * 100}%`,
                                    top: `${newZone.box.top * 100}%`,
                                    width: `${newZone.box.width * 100}%`,
                                    height: `${newZone.box.height * 100}%`,
                                }}
                            />
                        )}
                        {newZone?.page === page.id && !newZone.dragging && (
                            <ImageQuestion
                                style={{
                                    left: `${(newZone.box.left + newZone.box.width / 2) * 100}%`,
                                    top: `${(newZone.box.top + newZone.box.height) * 100}%`,
                                }}
                                onClose={() => setNewZone(undefined)}
                                onDefine={() => {
                                    // Kept as on the page in the PDF, so it stays on its image when the page is turned
                                    const zone = unrotateBox(newZone.box, rotationOf(page.id));
                                    setImageZones(prev => ({ ...prev, [page.id]: [...(prev[page.id] ?? []), zone] }));
                                    setNewZone(undefined);
                                }}
                            />
                        )}
                        {askingImage?.page === page.id && boxesOf(page.id)[askingImage.index] && (
                            <ImageQuestion
                                key={askingImage.index}
                                aiReady={warmUp.available}
                                style={{
                                    left: `${(boxesOf(page.id)[askingImage.index].left + boxesOf(page.id)[askingImage.index].width / 2) * 100}%`,
                                    // At the bottom of the image, inside it (and moved up into what is seen, when it is a tall one)
                                    top: `${(boxesOf(page.id)[askingImage.index].top + boxesOf(page.id)[askingImage.index].height) * 100}%`,
                                }}
                                history={imageHistory[`${page.id}-${askingImage.index}`] ?? []}
                                onClose={() => setAskingImage(undefined)}
                                onOpenEntry={entry => {
                                    const image = cropImage(page.canvasRef.current!, boxesOf(page.id)[askingImage.index]);
                                    setImageAnswer({ question: entry.question, answer: entry.answer, image });
                                    setAskingImage(undefined);
                                }}
                                onSend={async question => {
                                    const box = boxesOf(page.id)[askingImage.index];
                                    const image = cropImage(page.canvasRef.current!, box);
                                    const answer = unwrapMarkdownFence(
                                        await askAboutImage(question, image, await warmUp.prepare()),
                                    );
                                    const key = `${page.id}-${askingImage.index}`;
                                    setImageHistory({
                                        ...imageHistory,
                                        [key]: [
                                            { question, answer, timestamp: new Date().toISOString() },
                                            ...(imageHistory[key] ?? []).filter(other => other.question !== question),
                                        ],
                                    });
                                    setImageAnswer({ question, answer, image });
                                    setAskingImage(undefined);
                                }}
                            />
                        )}
                        {/* Seen only with the mouse near the top right corner of the page */}
                        <div className={Styles.pageLandscapeZone} onMouseDown={e => e.stopPropagation()}>
                            <button
                                type="button"
                                className={Styles.pageLandscape}
                                data-testid={TestIds.preview.pageLandscape}
                                data-landscape={rotationOf(page.id) ? '' : undefined}
                                disabled={!textLayers}
                                title={txt(rotationOf(page.id) ? 'documentPreview.showPortrait' : 'documentPreview.showLandscape')}
                                aria-label={txt(rotationOf(page.id) ? 'documentPreview.showPortrait' : 'documentPreview.showLandscape')}
                                onClick={e => {
                                    e.stopPropagation();
                                    toggleLandscape(page);
                                }}
                            >
                                <RotateCw size={14} strokeWidth={1.75} />
                            </button>
                        </div>
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
                {/* Only while Ctrl is held, as it is seldom needed */}
                {removingDefinitions && <TextLayerOffset offset={textLayerOffset} onChange={setTextLayerOffset} />}
            </div>
            <DocumentActions fullText={fullText} aiReady={warmUp.available} />
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
                notes={notes}
                onAddNote={text => setNotes(prev => [...prev, { id: Date.now(), text, createdAt: Date.now() }])}
                onRemoveNote={id => setNotes(prev => prev.filter(note => note.id !== id))}
            />
            <FeaturesMenu
                ref={menuRef}
                addHighlight={addHighlight}
                fullText={fullText}
                aiReady={warmUp.available}
                getDocumentCoordinates={getDocumentCoordinates}
                getWindow={previewWindow}
                onMarkLocation={addPointOfInterest}
                onReferenceFound={(passage, answer) => setReference({ passage, answer })}
                onDefined={(word, text) => {
                    addDefinition(word, text);
                    setDefinition({ word, definition: text });
                }}
                onAskAbout={statement => promptBarRef.current?.askAbout(statement)}
                onPluginResult={setPluginResult}
            />
            {pluginResult && (
                <ResponseModal
                    prompt={pluginResult.prompt}
                    answer={pluginResult.answer}
                    answerView={pluginResult.view}
                    background={pluginResult.background}
                    onClose={() => setPluginResult(undefined)}
                    labels={{ title: pluginResult.title, prompt: pluginResult.promptLabel, answer: pluginResult.answerLabel }}
                    testIds={{ modal: TestIds.preview.pluginModal, answer: TestIds.preview.pluginAnswer }}
                />
            )}
            {imageAnswer && (
                <ResponseModal
                    prompt={imageAnswer.question}
                    answer={imageAnswer.answer}
                    onClose={() => setImageAnswer(undefined)}
                    media={<img src={imageAnswer.image} alt={txt('imageQuestion.image')} />}
                    labels={{
                        title: txt('imageQuestion.title'),
                        prompt: txt('documentPreview.responseModal.prompt'),
                        answer: txt('documentPreview.responseModal.answer'),
                    }}
                    testIds={{ modal: TestIds.preview.imageAnswerModal, answer: TestIds.preview.imageAnswer }}
                />
            )}
            {definition && (
                <ResponseModal
                    prompt={definition.word}
                    answer={definition.definition}
                    onClose={() => setDefinition(undefined)}
                    labels={{
                        title: txt('documentPreview.definitionModal.title'),
                        prompt: txt('documentPreview.definitionModal.term'),
                        answer: txt('documentPreview.definitionModal.definition'),
                    }}
                    testIds={{ modal: TestIds.ai.definitionModal, answer: TestIds.ai.definitionModalAnswer }}
                />
            )}
            {reference && (
                <ResponseModal
                    prompt={reference.passage}
                    answer={
                        reference.answer.includes(REFERENCE_NOT_FOUND)
                            ? txt('documentPreview.referenceModal.notFound')
                            : reference.answer
                    }
                    onClose={() => setReference(undefined)}
                    labels={{
                        title: txt('documentPreview.referenceModal.title'),
                        prompt: txt('documentPreview.referenceModal.passage'),
                        answer: txt('documentPreview.referenceModal.found'),
                    }}
                    testIds={{ modal: TestIds.ai.referenceModal, answer: TestIds.ai.referenceModalAnswer }}
                    actions={
                        reference.answer.includes(REFERENCE_NOT_FOUND)
                            ? undefined
                            : referencesOf(reference.answer).map(found => (
                                  <Button
                                      key={found}
                                      variant="outline"
                                      className={ResponseModalStyles.search}
                                      data-testid={TestIds.ai.referenceSearch}
                                      data-query={found}
                                      title={found}
                                      onClick={() => window.open(googleSearchUrl(found), '_blank', 'noopener,noreferrer')}
                                  >
                                      <Search size={14} strokeWidth={2} aria-hidden />
                                      <span className={ResponseModalStyles.searchText}>
                                          {txt('documentPreview.referenceModal.searchOnGoogle')}
                                          {referencesOf(reference.answer).length > 1 && `: ${found}`}
                                      </span>
                                  </Button>
                              ))
                    }
                />
            )}
            <DocumentPromptBar ref={promptBarRef} fullText={fullText} />
        </div>
    );
}
