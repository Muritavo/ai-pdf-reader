import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { PluginStorage } from '../../../types';
import { openBook, pagesOf, type Book } from '../library';
import { pageText } from '../pdf';
import Styles from '../LiteratureReferential.module.css';

/** The text of each page of the ranges, as the preload sends it to the AI, to check it before preloading */
export default function ExtractedContent({ storage, book, onClose }: { storage: PluginStorage; book: Book; onClose: () => void }) {
    const [pages, setPages] = useState<{ page: number; text: string }[]>();
    const [error, setError] = useState<string>();

    useEffect(() => {
        openBook(storage, book.id)
            .then(pdf => Promise.all(pagesOf(book.ranges).map(async page => ({ page, text: await pageText(pdf, page) }))))
            .then(setPages, e => setError(e instanceof Error ? e.message : String(e)));
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
