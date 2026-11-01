import { useEffect, useRef, useState } from 'react';
import Collapsable from '@onepercentio/one-ui/components/Collapsable';
import { ChevronDown } from 'lucide-react';
import type { PluginStorage } from '../../../types';
import { fileUrlOf, openBook, pdfPageOf, saveOffset, useBooks } from '../library';
import type { Match } from '../query';
import type { PdfDocument } from '../pdf';
import PageCanvas from './PageCanvas';
import Styles from '../LiteratureReferential.module.css';

function PagePreview({ storage, match, onBack }: { storage: PluginStorage; match: Match; onBack: () => void }) {
    // As it is now, as the offset changes when the position is adjusted
    const book = useBooks().find(book => book.id === match.book.id) ?? match.book;
    const pdfPage = pdfPageOf(book, match.page);
    const [pdf, setPdf] = useState<PdfDocument>();
    const [fileUrl, setFileUrl] = useState<string>();
    const [error, setError] = useState<string>();
    const [width, setWidth] = useState(0);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        openBook(storage, match.book.id).then(setPdf, e => setError(e instanceof Error ? e.message : String(e)));
    }, [storage, match.book.id]);
    // Ready before the click, as a tab opened after waiting for the storage is taken for a popup and blocked
    useEffect(() => {
        fileUrlOf(storage, match.book.id).then(setFileUrl, () => {});
    }, [storage, match.book.id]);
    useEffect(() => setWidth(boxRef.current!.clientWidth), []);

    return (
        <div className={Styles.preview} data-testid="literature-page-preview">
            <div className={Styles.previewHeader}>
                <button type="button" className="btn btn-outline" onClick={onBack}>
                    Voltar
                </button>
                <span>
                    <strong>{book.title}</strong>, página {match.page}
                </span>
                <button
                    type="button"
                    className="btn btn-outline"
                    data-testid="literature-open-book"
                    disabled={!fileUrl}
                    // The viewer of the browser opens on the page of the fragment
                    onClick={() => window.open(`${fileUrl}#page=${pdfPage}`, '_blank')}
                >
                    Abrir o livro
                </button>
                <button
                    type="button"
                    className="btn btn-outline"
                    data-testid="literature-adjust-position"
                    onClick={() => {
                        const answer = window.prompt(`Esta deveria ser a página ${match.page}. Qual número de página aparece nela?`);
                        const hit = Number(answer);
                        if (!answer?.trim() || !Number.isInteger(hit)) return;
                        // Showing 262 when 282 was wanted: the page wanted is 20 pages further on the PDF
                        saveOffset(storage, book.id, (book.offset ?? 0) + match.page - hit);
                    }}
                >
                    Ajustar posição
                </button>
            </div>
            <div ref={boxRef} className={Styles.previewPage}>
                {error ? (
                    <p className="text-caption">{error}</p>
                ) : pdfPage < 1 || pdfPage > book.pageCount ? (
                    <p className="text-caption">A página {pdfPage} do PDF não existe. Ajuste o offset do livro.</p>
                ) : (
                    pdf && width > 0 && <PageCanvas pdf={pdf} pageNo={pdfPage} width={width} />
                )}
            </div>
        </div>
    );
}

/** Where the concept is discussed on the preloaded references, each opening a preview of its page */
export default function QueryResult({ storage, matches, searched }: { storage: PluginStorage; matches: Match[]; searched: number }) {
    const [opened, setOpened] = useState<Match>();
    // Every book starts open
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const books = useBooks();

    if (opened) return <PagePreview storage={storage} match={opened} onBack={() => setOpened(undefined)} />;
    if (matches.length === 0)
        return (
            <p className="text-description" data-testid="literature-no-match">
                Nenhuma das {searched} referências pré-carregadas discute este conceito.
            </p>
        );

    // In the order the books were asked, each with its places
    const byBook = [...new Map(matches.map(match => [match.book.id, match.book])).values()].map(book => ({
        book,
        matches: matches.filter(match => match.book.id === book.id),
    }));

    return (
        <div className={Styles.bookResults} data-testid="literature-matches">
            {byBook.map(({ book, matches }) => (
                <Collapsable
                    key={book.id}
                    data-testid="literature-book-results"
                    contentClassName={Styles.bookResultContent}
                    open={!collapsed.has(book.id)}
                    onToggleOpen={open =>
                        setCollapsed(current => {
                            const next = new Set(current);
                            if (open) next.delete(book.id);
                            else next.add(book.id);
                            return next;
                        })
                    }
                    title={open => (
                        <div className={Styles.bookResultTitle}>
                            <ChevronDown size={16} className={open ? Styles.chevronOpen : Styles.chevron} />
                            <strong>{book.title}</strong>
                            <span className="text-caption">
                                {matches.length} {matches.length === 1 ? 'página' : 'páginas'}
                            </span>
                        </div>
                    )}
                >
                    <ul className={Styles.matches}>
                        {matches.map(match => (
                            <li key={`${match.book.id}-${match.page}`} className={Styles.match} data-testid="literature-match">
                                <div>
                                    <div>
                                        Este conceito é discutido em <strong>{match.book.title}</strong>, página {match.page}
                                    </div>
                                    {match.term && <div className="text-caption">{match.term}</div>}
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    data-testid="literature-match-open"
                                    // Out of the PDF, as with an offset not set yet
                                    disabled={(page => page < 1 || page > match.book.pageCount)(
                                        pdfPageOf(books.find(book => book.id === match.book.id) ?? match.book, match.page),
                                    )}
                                    onClick={() => setOpened(match)}
                                >
                                    Abrir
                                </button>
                            </li>
                        ))}
                    </ul>
                </Collapsable>
            ))}
        </div>
    );
}
