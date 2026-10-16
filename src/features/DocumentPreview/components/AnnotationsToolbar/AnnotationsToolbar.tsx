import { useState } from 'react';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Brain, Crosshair, Sparkles, Trash2 } from 'lucide-react';
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

type Panel = 'highlights' | 'markers';

type AnnotationsToolbarProps = {
    highlights: HighlightItem[];
    /** Called while rendering the list, as the pages are only known once they are on the screen */
    getMarkers: () => MarkerItem[];
    onGoToHighlight: (normalizedWord: string) => void;
    onRemoveHighlight: (normalizedWord: string) => void;
    onGoToMarker: (key: number) => void;
    onRemoveMarker: (key: number) => void;
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
}: AnnotationsToolbarProps) {
    const { txt, formatMessage } = useShortIntl();
    const [open, setOpen] = useState<Panel>();
    const markers = getMarkers();
    const toggle = (panel: Panel) => setOpen(current => (current === panel ? undefined : panel));

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
        </div>
    );
}
