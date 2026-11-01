import { useEffect, useRef, useState } from 'react';
import { BookOpen, Bug, Ellipsis, Play, Trash2, Upload } from 'lucide-react';
import type { PluginEnv } from '../../../types';
import { addBook, isPreloaded, removeBook, saveOffset, useBooks, usePreloading, type Book } from '../library';
import { preloadBook } from '../preload';
import BookEditor from './BookEditor';
import ExtractedContent from './ExtractedContent';
import RangePills from './RangePills';
import Styles from '../LiteratureReferential.module.css';

function BookStatus({ book }: { book: Book }) {
    const progress = usePreloading()[book.id];
    if (progress?.error)
        return (
            <span className={Styles.error} data-testid="literature-status">
                {progress.error}
            </span>
        );
    if (progress)
        return (
            <span className="text-caption" data-testid="literature-status">
                Enviando as {progress.total} páginas para a IA…
            </span>
        );
    if (isPreloaded(book))
        return (
            <span className={Styles.done} data-testid="literature-status">
                Pré-carregado
            </span>
        );
    return (
        <span className="text-caption" data-testid="literature-status">
            {book.ranges.length ? 'Não pré-carregado' : 'Clique no livro para escolher as páginas do sumário e do índice'}
        </span>
    );
}

/** Saved as typed, once it is a whole number, so clearing it or typing a minus sign is not saved as 0 */
function OffsetInput({ book, onSave }: { book: Book; onSave: (offset: number) => void }) {
    const saved = book.offset ?? 0;
    const [draft, setDraft] = useState(String(saved));
    // Follows the saved one when it changes elsewhere, as by adjusting the position on the preview
    useEffect(() => setDraft(current => (Number(current) === saved && current.trim() ? current : String(saved))), [saved]);

    return (
        <label className={Styles.offset}>
            <span className="text-caption">Offset</span>
            <input
                type="number"
                step={1}
                data-testid="literature-offset"
                title="Somado às páginas do sumário e do índice para chegar à página do PDF"
                value={draft}
                onChange={e => {
                    setDraft(e.target.value);
                    const offset = Number(e.target.value);
                    if (e.target.value.trim() && Number.isInteger(offset)) onSave(offset);
                }}
                onBlur={() => setDraft(String(saved))}
            />
        </label>
    );
}

/** The references (full books), with the ranges of their summary and index, and the preload of them by the AI */
export default function Settings(env: PluginEnv) {
    const { storage } = env;
    const books = useBooks();
    const preloading = usePreloading();
    const [editing, setEditing] = useState<string>();
    const [adding, setAdding] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const [holdingCtrl, setHoldingCtrl] = useState(false);
    /** The book whose options (shown holding Ctrl) are open */
    const [menuOf, setMenuOf] = useState<string>();
    const [extractedOf, setExtractedOf] = useState<Book>();
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const follow = (e: KeyboardEvent) => setHoldingCtrl(e.ctrlKey);
        // Released out of the window, as by changing to another one, it would stay held
        const release = () => setHoldingCtrl(false);
        window.addEventListener('keydown', follow);
        window.addEventListener('keyup', follow);
        window.addEventListener('blur', release);
        return () => {
            window.removeEventListener('keydown', follow);
            window.removeEventListener('keyup', follow);
            window.removeEventListener('blur', release);
        };
    }, []);

    // Closed by a click anywhere else, or by Escape
    useEffect(() => {
        if (!menuOf) return;
        const closeOutside = (e: PointerEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) setMenuOf(undefined);
        };
        const closeOnEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenuOf(undefined);
        };
        window.addEventListener('pointerdown', closeOutside);
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            window.removeEventListener('pointerdown', closeOutside);
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [menuOf]);

    const edited = books.find(book => book.id === editing);
    if (edited) return <BookEditor storage={storage} book={edited} onBack={() => setEditing(undefined)} />;

    return (
        <div className={Styles.listing}>
            <div>
                <button type="button" className="btn btn-primary" disabled={adding} onClick={() => fileInput.current?.click()}>
                    <Upload size={16} className={Styles.icon} />
                    {adding ? 'Adicionando…' : 'Adicionar livro (PDF)'}
                </button>
                <input
                    ref={fileInput}
                    type="file"
                    accept="application/pdf,.pdf"
                    hidden
                    data-testid="literature-file-input"
                    onChange={async e => {
                        const file = e.target.files?.item(0);
                        e.target.value = '';
                        if (!file) return;
                        setAdding(true);
                        try {
                            await addBook(storage, file);
                        } catch (error) {
                            alert(`Não foi possível abrir o PDF: ${error instanceof Error ? error.message : String(error)}`);
                        } finally {
                            setAdding(false);
                        }
                    }}
                />
            </div>
            {books.length === 0 && <p className="text-description">Nenhum livro ainda.</p>}
            <ul className={Styles.books}>
                {books.map(book => {
                    const running = !!preloading[book.id] && !preloading[book.id].error;
                    // Holding Ctrl, a book with ranges shows its options, as the text that is sent to the AI
                    const showingOptions = holdingCtrl && book.ranges.length > 0;
                    return (
                        <li key={book.id} className={Styles.book} data-testid="literature-book">
                            <button type="button" className={Styles.bookTitle} onClick={() => setEditing(book.id)} data-testid="literature-book-open">
                                <BookOpen size={18} />
                                <span>{book.title}</span>
                                <span className="text-caption">{book.pageCount} páginas</span>
                            </button>
                            <RangePills ranges={book.ranges} />
                            <OffsetInput book={book} onSave={offset => saveOffset(storage, book.id, offset)} />
                            <BookStatus book={book} />
                            <div className={Styles.bookActions}>
                                <div ref={menuOf === book.id ? menuRef : undefined} className={Styles.actionMenuAnchor}>
                                    <button
                                        type="button"
                                        className={Styles.iconButton}
                                        title={showingOptions ? 'Opções do livro' : 'Enviar as páginas para a IA pré-carregar'}
                                        aria-label={showingOptions ? 'Opções do livro' : 'Pré-carregar'}
                                        aria-haspopup="menu"
                                        aria-expanded={menuOf === book.id}
                                        data-testid="literature-preload"
                                        disabled={!showingOptions && (running || book.ranges.length === 0)}
                                        onClick={() => (showingOptions ? setMenuOf(book.id) : preloadBook(env, book))}
                                        // On macOS a Ctrl click is a right click, so it comes as the context menu instead
                                        onContextMenu={e => {
                                            if (!showingOptions) return;
                                            e.preventDefault();
                                            setMenuOf(book.id);
                                        }}
                                    >
                                        {showingOptions ? <Ellipsis size={18} /> : <Play size={18} />}
                                    </button>
                                    {menuOf === book.id && (
                                        <div className={Styles.actionMenu} role="menu" data-testid="literature-book-menu">
                                            <button
                                                type="button"
                                                role="menuitem"
                                                className={Styles.actionMenuItem}
                                                data-testid="literature-show-extracted"
                                                onClick={() => {
                                                    setMenuOf(undefined);
                                                    setExtractedOf(book);
                                                }}
                                            >
                                                <Bug size={16} strokeWidth={1.75} aria-hidden />
                                                DEBUG - Show extracted content
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    className={Styles.iconButton}
                                    title="Remover livro"
                                    aria-label="Remover livro"
                                    disabled={running}
                                    onClick={() => window.confirm(`Remover ${book.title}?`) && removeBook(storage, book.id)}
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ul>
            {extractedOf && <ExtractedContent storage={storage} book={extractedOf} onClose={() => setExtractedOf(undefined)} />}
        </div>
    );
}
