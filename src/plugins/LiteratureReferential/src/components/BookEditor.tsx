import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PluginStorage } from '../../../types';
import { openBook, saveRanges, type Book, type PageRange } from '../library';
import type { PdfDocument } from '../pdf';
import PageCanvas from './PageCanvas';
import RangePills from './RangePills';
import Styles from '../LiteratureReferential.module.css';

/** Room for the number under each page */
const LABEL_HEIGHT = 28;
/** Pages this far from the screen are already drawn, so they are ready when scrolled to */
const ROOT_MARGIN = '600px';

/** The pages of the book side by side, as tall as the room there is, to choose the ranges of the summary and of the index */
export default function BookEditor({ storage, book, onBack }: { storage: PluginStorage; book: Book; onBack: () => void }) {
    const [pdf, setPdf] = useState<PdfDocument>();
    const [error, setError] = useState<string>();
    const [aspect, setAspect] = useState(1 / Math.SQRT2);
    const [ranges, setRanges] = useState(book.ranges);
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

    const fromPage = Number(from);
    const toPage = Number(to || from);
    const validRange = Number.isInteger(fromPage) && Number.isInteger(toPage) && fromPage >= 1 && fromPage <= toPage && toPage <= book.pageCount;
    const inRanges = (pageNo: number) => ranges.some(range => pageNo >= range.from && pageNo <= range.to);

    const addRange = () => {
        if (!validRange) return;
        setRanges(current => [...current, { from: fromPage, to: toPage }].sort((a, b) => a.from - b.from));
        setFrom('');
        setTo('');
    };
    const removeRange = (removed: PageRange) => setRanges(current => current.filter(range => range !== removed));

    return (
        <div className={Styles.editor} data-testid="literature-editor">
            <div className={Styles.editorBar}>
                <button type="button" className="btn btn-transparent" onClick={onBack}>
                    Voltar
                </button>
                <strong className={Styles.editorTitle}>{book.title}</strong>
                <form
                    className={Styles.rangeForm}
                    onSubmit={e => {
                        e.preventDefault();
                        addRange();
                    }}
                >
                    <input
                        type="number"
                        min={1}
                        max={book.pageCount}
                        placeholder="De"
                        aria-label="Da página"
                        data-testid="literature-range-from"
                        value={from}
                        onChange={e => setFrom(e.target.value)}
                    />
                    <input
                        type="number"
                        min={1}
                        max={book.pageCount}
                        placeholder="Até"
                        aria-label="Até a página"
                        data-testid="literature-range-to"
                        value={to}
                        onChange={e => setTo(e.target.value)}
                    />
                    <button type="submit" className="btn btn-outline" disabled={!validRange} data-testid="literature-range-add">
                        Adicionar
                    </button>
                </form>
                <RangePills ranges={ranges} onRemove={removeRange} />
                <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="literature-save"
                    disabled={saving}
                    onClick={async () => {
                        setSaving(true);
                        await saveRanges(storage, book.id, ranges);
                        onBack();
                    }}
                >
                    Salvar
                </button>
            </div>
            <div ref={pagesRef} className={Styles.pages} data-testid="literature-pages">
                {error && <p className="text-caption">{error}</p>}
                {height > 0 &&
                    Array.from({ length: book.pageCount }, (_, i) => i + 1).map(pageNo => (
                        <figure key={pageNo} data-page={pageNo} className={`${Styles.page} ${inRanges(pageNo) ? Styles.selected : ''}`}>
                            <div className={Styles.pageSheet} style={{ height, width: height * aspect }}>
                                {pdf && visible.has(pageNo) && <PageCanvas pdf={pdf} pageNo={pageNo} height={height} />}
                            </div>
                            <figcaption>{pageNo}</figcaption>
                        </figure>
                    ))}
            </div>
        </div>
    );
}
