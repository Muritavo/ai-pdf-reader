import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { PluginStores } from '../../../types';
import { openBook, pagesOf, type Book } from '../library';
import { outlineText, pageText } from '../pdf';
import Styles from '../LiteratureReferential.module.css';

/** The text of each page of the book, as the preload sends it to the AI, to check it before preloading */
export default function ExtractedContent({ storage, book, onClose }: { storage: PluginStores; book: Book; onClose: () => void }) {
    const [pages, setPages] = useState<{ page: number; text: string }[]>();
    const [outline, setOutline] = useState<string>();
    const [error, setError] = useState<string>();

    useEffect(() => {
        openBook(storage, book.id)
            .then(async pdf => {
                const [read, built] = await Promise.all([
                    Promise.all(pagesOf(book).map(async ({ page, boundary }) => ({ page, text: await pageText(pdf, page, boundary) }))),
                    book.glossary ? outlineText(pdf, book.offset ?? 0) : undefined,
                ]);
                setOutline(built);
                setPages(read);
            })
            .catch(e => setError(e instanceof Error ? e.message : String(e)));
    }, [storage, book]);

    return createPortal(
        <div className={Styles.modalOverlay} onClick={onClose}>
            <div className={Styles.modal} onClick={e => e.stopPropagation()} data-testid="literature-extracted">
                <div className={Styles.modalHeader}>
                    <strong>DEBUG - Show extracted content · {book.title}</strong>
                    <button type="button" className={Styles.iconButton} aria-label="Fechar" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>
                <div className={Styles.modalBody}>
                    {error && <p className={Styles.error}>{error}</p>}
                    {!pages && !error && <p className="text-caption">Extraindo…</p>}
                    {pages && outline !== undefined && (
                        <section>
                            <div className="text-caption">Built-in glossary (outline do PDF)</div>
                            <div className={Styles.extracted} data-testid="literature-extracted-outline">
                                {outline}
                            </div>
                        </section>
                    )}
                    {pages?.map(({ page, text }) => (
                        <section key={page}>
                            <div className="text-caption">Página {page}</div>
                            <div className={Styles.extracted} data-testid="literature-extracted-page">
                                {text}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
}
