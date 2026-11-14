import { Check, ListTree } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PluginStores } from '../../../types';
import { dragZone } from '../../../../utils/dragZone';
import type { ImageBox } from '../../../../utils/pageImages';
import { openBook, pagesOf, savePages, type Book, type BookPage, type PageRange } from '../library';
import { hasOutline, type PdfDocument } from '../pdf';
import PageCanvas from './PageCanvas';
import RangePills from './RangePills';
import Styles from '../LiteratureReferential.module.css';

/** Room for the number under each page */
const LABEL_HEIGHT = 28;
/** Pages this far from the screen are already drawn, so they are ready when scrolled to */
const ROOT_MARGIN = '600px';

/** "12+340" becomes "352", so the offset of the printed page numbers can be added; anything else is left as typed */
function sumPages(value: string) {
    const parts = value.split('+').map(part => part.trim());
    if (parts.length < 2 || parts.some(part => !/^\d+$/.test(part))) return value;
    return String(parts.reduce((total, part) => total + Number(part), 0));
}

/** The pages of the book side by side, as tall as the room there is, to choose the pages of the summary and of the index */
export default function BookEditor({ storage, book, onBack }: { storage: PluginStores; book: Book; onBack: () => void }) {
    const [pdf, setPdf] = useState<PdfDocument>();
    const [error, setError] = useState<string>();
    const [aspect, setAspect] = useState(1 / Math.SQRT2);
    // Where the text of a page is read from is drawn on it with Alt + drag, adding the page. Drawing again on it replaces it
    const [pages, setPages] = useState(() => pagesOf(book));
    // Offered when the PDF has an outline (its bookmarks), as a glossary built in it
    const [glossary, setGlossary] = useState(!!book.glossary);
    const [hasGlossary, setHasGlossary] = useState(false);
    const [drawing, setDrawing] = useState<{ page: number; box: ImageBox }>();
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [saving, setSaving] = useState(false);
    const [height, setHeight] = useState(0);
    const [visible, setVisible] = useState<Set<number>>(new Set());
    const pagesRef = useRef<HTMLDivElement>(null);
    const observer = useRef<IntersectionObserver>();

    useEffect(() => {
        openBook(storage, book.id)
            .then(async opened => {
                const viewport = (await opened.getPage(1)).getViewport({ scale: 1 });
                setAspect(viewport.width / viewport.height);
                setPdf(opened);
                setHasGlossary(await hasOutline(opened));
            })
            .catch(e => setError(e instanceof Error ? e.message : String(e)));
    }, [storage, book.id]);

    // Every page as tall as the room on the screen
    useLayoutEffect(() => {
        const pages = pagesRef.current!;
        const measure = () => {
            const style = getComputedStyle(pages);
            setHeight(pages.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - LABEL_HEIGHT);
        };
        measure();
        const resize = new ResizeObserver(measure);
        resize.observe(pages);
        return () => resize.disconnect();
    }, []);

    // Only the pages close to the screen are drawn, as a book can have hundreds of them
    useEffect(() => {
        observer.current = new IntersectionObserver(
            entries =>
                setVisible(current => {
                    const next = new Set(current);
                    for (const entry of entries) {
                        const pageNo = Number((entry.target as HTMLElement).dataset.page);
                        if (entry.isIntersecting) next.add(pageNo);
                        else next.delete(pageNo);
                    }
                    return next;
                }),
            { root: pagesRef.current, rootMargin: ROOT_MARGIN },
        );
        pagesRef.current!.querySelectorAll<HTMLElement>('[data-page]').forEach(page => observer.current!.observe(page));
        return () => observer.current!.disconnect();
    }, [pdf]);

    const fromPage = Number(sumPages(from));
    const toPage = Number(sumPages(to || from));
    const validRange = Number.isInteger(fromPage) && Number.isInteger(toPage) && fromPage >= 1 && fromPage <= toPage && toPage <= book.pageCount;
    const pageOf = (pageNo: number) => pages.find(({ page }) => page === pageNo);
    /** Adds the pages, or replaces them when already there, kept in order */
    const putPages = (added: BookPage[]) =>
        setPages(current => [...current.filter(({ page }) => !added.some(other => other.page === page)), ...added].sort((a, b) => a.page - b.page));

    const addRange = () => {
        if (!validRange) return;
        // A page already there keeps its boundary
        putPages(Array.from({ length: toPage - fromPage + 1 }, (_, i) => pageOf(fromPage + i) ?? { page: fromPage + i }));
        setFrom('');
        setTo('');
    };
    const removeRange = (removed: PageRange) => setPages(current => current.filter(({ page }) => page < removed.from || page > removed.to));
    // Jumps straight there: a smooth scroll would draw every page on the way
    const gotoPage = (pageNo: number) =>
        pagesRef.current?.querySelector<HTMLElement>(`[data-page="${pageNo}"]`)?.scrollIntoView({ block: 'nearest', inline: 'start' });

    return (
        <div className={Styles.editor} data-testid="literature-editor">
            <div className={Styles.editorBar}>
                <button type="button" className="btn btn-transparent" onClick={onBack}>
                    Voltar
                </button>
                <strong className={Styles.editorTitle} title={book.title}>
                    {book.title}
                </strong>
                <form
                    className={Styles.rangeForm}
                    onSubmit={e => {
                        e.preventDefault();
                        addRange();
                    }}
                >
                    <input
                        type="text"
                        inputMode="numeric"
                        placeholder="De"
                        aria-label="Da página"
                        data-testid="literature-range-from"
                        value={from}
                        onChange={e => setFrom(e.target.value)}
                        onBlur={e => setFrom(sumPages(e.target.value))}
                    />
                    <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Até"
                        aria-label="Até a página"
                        data-testid="literature-range-to"
                        value={to}
                        onChange={e => setTo(e.target.value)}
                        onBlur={e => setTo(sumPages(e.target.value))}
                    />
                    <button type="submit" className="btn btn-outline" disabled={!validRange} data-testid="literature-range-add">
                        Adicionar
                    </button>
                </form>
                {hasGlossary && (
                    <button
                        type="button"
                        className={`${Styles.iconButton} ${glossary ? Styles.glossaryOn : ''}`}
                        title={glossary ? 'Glossário do PDF enviado à IA. Clique para desativar' : 'O PDF tem um glossário. Clique para enviá-lo à IA'}
                        aria-label={glossary ? 'Desativar o glossário do PDF' : 'Ativar o glossário do PDF'}
                        aria-pressed={glossary}
                        data-testid="literature-glossary"
                        onClick={() => setGlossary(on => !on)}
                    >
                        <ListTree size={18} />
                        {glossary && <Check size={10} strokeWidth={3} className={Styles.glossaryCheck} aria-hidden />}
                    </button>
                )}
                <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="literature-save"
                    disabled={saving}
                    onClick={async () => {
                        setSaving(true);
                        await savePages(storage, book.id, pages, glossary);
                        onBack();
                    }}
                >
                    Salvar
                </button>
                {/* The tags on a row of their own, below the actions */}
                <div className={Styles.editorTags}>
                    <RangePills pages={pages} onRemove={removeRange} onGoto={range => gotoPage(range.from)} />
                </div>
            </div>
            <div ref={pagesRef} className={Styles.pages} data-testid="literature-pages">
                {error && <p className="text-caption">{error}</p>}
                {height > 0 &&
                    Array.from({ length: book.pageCount }, (_, i) => i + 1).map(pageNo => (
                        <figure key={pageNo} data-page={pageNo} className={`${Styles.page} ${pageOf(pageNo) ? Styles.selected : ''}`}>
                            <div
                                className={Styles.pageSheet}
                                style={{ height, width: height * aspect }}
                                onMouseDown={e =>
                                    dragZone(e, {
                                        onChange: box => setDrawing({ page: pageNo, box }),
                                        onDrop: box => {
                                            setDrawing(undefined);
                                            if (box) putPages([{ page: pageNo, boundary: box }]);
                                        },
                                    })
                                }
                            >
                                {pdf && visible.has(pageNo) && <PageCanvas pdf={pdf} pageNo={pageNo} height={height} />}
                                {(box =>
                                    box && (
                                        <div
                                            className={Styles.bounds}
                                            style={{
                                                left: `${box.left * 100}%`,
                                                top: `${box.top * 100}%`,
                                                width: `${box.width * 100}%`,
                                                height: `${box.height * 100}%`,
                                            }}
                                        />
                                    ))(drawing?.page === pageNo ? drawing.box : pageOf(pageNo)?.boundary)}
                            </div>
                            <figcaption>{pageNo}</figcaption>
                        </figure>
                    ))}
            </div>
        </div>
    );
}
