import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import AdaptiveDialog from '@onepercentio/one-ui/components/AdaptiveDialog';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PluginStores } from '../../../types';
import { openBook, useBooks } from '../library';
import type { PdfDocument } from '../pdf';
import PageCanvas from './PageCanvas';
import Styles from '../LiteratureReferential.module.css';

export type BookDialogHandle = {
    /** A page of the PDF. Works while the book is closed too, so it opens there */
    goToPage: (page: number) => void;
};

/** The book read page by page. Always mounted, so the page read is kept when it is closed */
const BookDialog = forwardRef<BookDialogHandle, { storage: PluginStores; bookId?: string; open: boolean; onClose: () => void }>(
    function BookDialog({ storage, bookId, open, onClose }, ref) {
        const book = useBooks().find(book => book.id === bookId);
        const [page, setPage] = useState(1);
        const [pdf, setPdf] = useState<PdfDocument>();
        const [error, setError] = useState<string>();

        useImperativeHandle(ref, () => ({ goToPage: setPage }), []);

        useEffect(() => {
            setPdf(undefined);
            setError(undefined);
            if (!bookId) return;
            let current = true;
            openBook(storage, bookId).then(
                opened => current && setPdf(opened),
                e => current && setError(e instanceof Error ? e.message : String(e)),
            );
            return () => {
                current = false;
            };
        }, [storage, bookId]);

        const pageCount = book?.pageCount ?? 0;
        const shown = Math.min(Math.max(page, 1), Math.max(pageCount, 1));

        return (
            <AdaptiveDialog open={open && !!book} onClose={onClose} onClickOut={onClose} className={Styles.bookDialog}>
                {book && (
                    <div className={Styles.bookReader} data-testid="literature-book-dialog">
                        <div className={Styles.bookReaderHeader}>
                            <strong>{book.title}</strong>
                            <button
                                type="button"
                                className="btn btn-transparent"
                                aria-label="Página anterior"
                                disabled={shown <= 1}
                                onClick={() => setPage(shown - 1)}
                            >
                                <ChevronLeft size={18} />
                            </button>
                            <span className="text-caption" data-testid="literature-book-page">
                                {shown} / {pageCount}
                            </span>
                            <button
                                type="button"
                                className="btn btn-transparent"
                                aria-label="Próxima página"
                                disabled={shown >= pageCount}
                                onClick={() => setPage(shown + 1)}
                            >
                                <ChevronRight size={18} />
                            </button>
                        </div>
                        {error ? <p className="text-caption">{error}</p> : <BookPage pdf={pdf} page={shown} />}
                    </div>
                )}
            </AdaptiveDialog>
        );
    },
);

/** The page as tall as the room under the header */
function BookPage({ pdf, page }: { pdf?: PdfDocument; page: number }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);

    useLayoutEffect(() => {
        const box = boxRef.current!;
        const observer = new ResizeObserver(() => setHeight(box.clientHeight));
        observer.observe(box);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={boxRef} className={Styles.bookReaderPage}>
            {pdf && height > 0 && <PageCanvas pdf={pdf} pageNo={page} height={height} />}
        </div>
    );
}

export default BookDialog;
