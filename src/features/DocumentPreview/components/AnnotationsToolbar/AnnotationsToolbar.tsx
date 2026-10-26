import { useState } from 'react';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Brain, Crosshair, Plus, Sparkles, StickyNote, Trash2 } from 'lucide-react';
import { TestIds } from '../../../../testids';
import Styles from './AnnotationsToolbar.module.scss';

export type HighlightItem = {
    normalizedWord: string;
    word: string;
    color: string;
    /** The page of each occurrence of the text, in the order of the document */
    pages: number[];
};

export type MarkerItem = {
    key: number;
    word?: string;
    page: number;
};

export type NoteItem = {
    id: number;
    text: string;
    createdAt: number;
};

type Panel = 'highlights' | 'markers' | 'notes';

type AnnotationsToolbarProps = {
    highlights: HighlightItem[];
    /** Called while rendering the list, as the pages are only known once they are on the screen */
    getMarkers: () => MarkerItem[];
    onGoToHighlight: (normalizedWord: string) => void;
    onRemoveHighlight: (normalizedWord: string) => void;
    onGoToMarker: (key: number) => void;
    onRemoveMarker: (key: number) => void;
    notes: NoteItem[];
    onAddNote: (text: string) => void;
    onRemoveNote: (id: number) => void;
};

const uniquePages = (pages: number[]) => [...new Set(pages)].sort((a, b) => a - b);

/** The buttons that list what was highlighted and marked on the document, placed by the close button of the dialog */
export default function AnnotationsToolbar({
    highlights,
    getMarkers,
    onGoToHighlight,
    onRemoveHighlight,
    onGoToMarker,
    onRemoveMarker,
    notes,
    onAddNote,
    onRemoveNote,
}: AnnotationsToolbarProps) {
    const { txt, formatMessage } = useShortIntl();
    const [open, setOpen] = useState<Panel>();
    const [draft, setDraft] = useState('');
    const markers = getMarkers();
    const toggle = (panel: Panel) => setOpen(current => (current === panel ? undefined : panel));

    const addNote = (e?: { preventDefault: () => void }) => {
        e?.preventDefault();
        if (!draft.trim()) return;
        onAddNote(draft.trim());
        setDraft('');
    };

    return (
        <div className={Styles.toolbar}>
            <div className={Styles.buttons}>
                <button
                    type="button"
                    className={`${Styles.button} ${open === 'highlights' ? Styles.active : ''}`}
                    data-testid={TestIds.annotations.highlightsButton}
                    data-count={highlights.length}
                    aria-expanded={open === 'highlights'}
                    title={txt('annotations.highlights')}
                    aria-label={txt('annotations.highlights')}
                    onClick={() => toggle('highlights')}
                >
                    <Sparkles size={18} strokeWidth={1.75} />
                    {highlights.length > 0 && <span className={Styles.badge}>{highlights.length}</span>}
                </button>
                <button
                    type="button"
                    className={`${Styles.button} ${open === 'markers' ? Styles.active : ''}`}
                    data-testid={TestIds.annotations.markersButton}
                    data-count={markers.length}
                    aria-expanded={open === 'markers'}
                    title={txt('annotations.markers')}
                    aria-label={txt('annotations.markers')}
                    onClick={() => toggle('markers')}
                >
                    <Brain size={18} strokeWidth={1.75} />
                    {markers.length > 0 && <span className={Styles.badge}>{markers.length}</span>}
                </button>
                <button
                    type="button"
                    className={`${Styles.button} ${open === 'notes' ? Styles.active : ''}`}
                    data-testid={TestIds.annotations.notesButton}
                    data-count={notes.length}
                    aria-expanded={open === 'notes'}
                    title={txt('annotations.notes')}
                    aria-label={txt('annotations.notes')}
                    onClick={() => toggle('notes')}
                >
                    <StickyNote size={18} strokeWidth={1.75} />
                    {notes.length > 0 && <span className={Styles.badge}>{notes.length}</span>}
                </button>
            </div>

            {open === 'highlights' && (
                <div className={Styles.panel} data-testid={TestIds.annotations.highlightsPanel}>
                    {highlights.length === 0 && <p className={Styles.empty}>{txt('annotations.noHighlights')}</p>}
                    {highlights.map(item => (
                        <div
                            key={item.normalizedWord}
                            className={Styles.item}
                            data-testid={TestIds.annotations.highlightItem}
                            data-word={item.normalizedWord}
                            data-count={item.pages.length}
                            data-pages={uniquePages(item.pages).join(',')}
                        >
                            <span className={Styles.swatch} style={{ backgroundColor: item.color }} aria-hidden />
                            <div className={Styles.itemText}>
                                <span className={Styles.itemTitle}>{item.word}</span>
                                <span className={Styles.itemDetails}>
                                    {item.pages.length > 0
                                        ? `${formatMessage({ id: 'annotations.pages' }, { pages: uniquePages(item.pages).join(', ') })} · ${formatMessage({ id: 'annotations.occurrences' }, { count: item.pages.length })}`
                                        : txt('annotations.notFound')}
                                </span>
                            </div>
                            <button
                                type="button"
                                className={Styles.action}
                                data-testid={TestIds.annotations.highlightGoTo}
                                disabled={item.pages.length === 0}
                                title={txt('annotations.goTo')}
                                aria-label={txt('annotations.goTo')}
                                onClick={() => onGoToHighlight(item.normalizedWord)}
                            >
                                <Crosshair size={15} strokeWidth={1.75} />
                            </button>
                            <button
                                type="button"
                                className={`${Styles.action} ${Styles.remove}`}
                                data-testid={TestIds.annotations.highlightRemove}
                                title={txt('annotations.remove')}
                                aria-label={txt('annotations.remove')}
                                onClick={() => onRemoveHighlight(item.normalizedWord)}
                            >
                                <Trash2 size={15} strokeWidth={1.75} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {open === 'markers' && (
                <div className={Styles.panel} data-testid={TestIds.annotations.markersPanel}>
                    {markers.length === 0 && <p className={Styles.empty}>{txt('annotations.noMarkers')}</p>}
                    {markers.map(item => (
                        <div
                            key={item.key}
                            className={Styles.item}
                            data-testid={TestIds.annotations.markerItem}
                            data-page={item.page}
                        >
                            <Brain className={Styles.markerIcon} size={16} color="#ffa8f1" aria-hidden />
                            <div className={Styles.itemText}>
                                <span className={Styles.itemTitle}>{item.word ?? txt('annotations.markerWithoutText')}</span>
                                <span className={Styles.itemDetails}>
                                    {formatMessage({ id: 'annotations.pages' }, { pages: item.page })}
                                </span>
                            </div>
                            <button
                                type="button"
                                className={Styles.action}
                                data-testid={TestIds.annotations.markerGoTo}
                                title={txt('annotations.goTo')}
                                aria-label={txt('annotations.goTo')}
                                onClick={() => onGoToMarker(item.key)}
                            >
                                <Crosshair size={15} strokeWidth={1.75} />
                            </button>
                            <button
                                type="button"
                                className={`${Styles.action} ${Styles.remove}`}
                                data-testid={TestIds.annotations.markerRemove}
                                title={txt('annotations.remove')}
                                aria-label={txt('annotations.remove')}
                                onClick={() => onRemoveMarker(item.key)}
                            >
                                <Trash2 size={15} strokeWidth={1.75} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {open === 'notes' && (
                <div className={Styles.panel} data-testid={TestIds.annotations.notesPanel}>
                    <form className={Styles.noteForm} onSubmit={addNote}>
                        <textarea
                            className={Styles.noteInput}
                            data-testid={TestIds.annotations.noteInput}
                            value={draft}
                            rows={3}
                            autoFocus
                            placeholder={txt('annotations.notePlaceholder')}
                            aria-label={txt('annotations.notePlaceholder')}
                            onChange={e => setDraft(e.target.value)}
                            // Enter saves, Shift+Enter breaks the line
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) addNote(e);
                            }}
                        />
                        <button
                            type="submit"
                            className={Styles.action}
                            data-testid={TestIds.annotations.noteAdd}
                            disabled={!draft.trim()}
                            title={txt('annotations.addNote')}
                            aria-label={txt('annotations.addNote')}
                        >
                            <Plus size={15} strokeWidth={1.75} />
                        </button>
                    </form>
                    {notes.length === 0 && <p className={Styles.empty}>{txt('annotations.noNotes')}</p>}
                    {[...notes].reverse().map(note => (
                        <div key={note.id} className={Styles.item} data-testid={TestIds.annotations.noteItem}>
                            <div className={Styles.itemText}>
                                <span className={Styles.noteText}>{note.text}</span>
                                <span className={Styles.itemDetails}>
                                    {new Date(note.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                                </span>
                            </div>
                            <button
                                type="button"
                                className={`${Styles.action} ${Styles.remove}`}
                                data-testid={TestIds.annotations.noteRemove}
                                title={txt('annotations.remove')}
                                aria-label={txt('annotations.remove')}
                                onClick={() => onRemoveNote(note.id)}
                            >
                                <Trash2 size={15} strokeWidth={1.75} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
