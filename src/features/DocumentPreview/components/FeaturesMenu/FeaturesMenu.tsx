import { forwardRef, useImperativeHandle, useState, type ForwardedRef } from 'react';
import { createPortal } from 'react-dom';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import Styles from './FeaturesMenu.module.scss';
import type { FullText } from '../../../../models/Article';
import { defineWordInContext } from '../../../../services/ai';
import { getNormalizedText } from '../../../../utils/preprocessing';
import AsyncInteractionButton from '../../../../components/AsyncInteractionButton';

export type FeaturesMenuHandle = { openMenu(): void; closeMenu(): void };

type FeaturesMenuProps = {
    addHighlight: (word: string) => void;
    fullText: FullText;
    /** The AI backed actions are locked until the AI is online and the document warmed up */
    aiReady: boolean;
    getDocumentCoordinates: () => { x: number; y: number };
    onMarkLocation: (x: number, y: number, word: string) => void;
};

function extractSelectedWord(selectionText: string) {
    const collapsedText = selectionText.replace(/\s+/g, ' ').trim();
    return collapsedText.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || undefined;
}

export default forwardRef(function FeaturesMenu(
    { addHighlight, fullText, aiReady, getDocumentCoordinates, onMarkLocation }: FeaturesMenuProps,
    ref: ForwardedRef<FeaturesMenuHandle>,
) {
    const { txt } = useShortIntl();
    const [word, setWord] = useState<string>();
    const [{ x, y }, setPosition] = useState({ x: 0, y: 0 });

    useImperativeHandle(
        ref,
        () => ({
            openMenu() {
                if (word) return;
                const selection = window.getSelection();
                if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                    setWord(undefined);
                    return;
                }

                const selectedWord = extractSelectedWord(selection.toString());
                if (!selectedWord) {
                    setWord(undefined);
                    return;
                }

                const bounds = selection.getRangeAt(0).getBoundingClientRect();
                setWord(selectedWord);
                setPosition({ x: bounds.left, y: bounds.bottom });
            },
            closeMenu() {
                if (word) setWord(undefined);
            },
        }),
        [word],
    );

    if (!word) return null;

    function dismiss() {
        window.getSelection()?.removeAllRanges();
        setWord(undefined);
    }

    const menuItems = [
        {
            id: 'search-on-google',
            label: txt('documentPreview.menu.searchOnGoogle'),
            onClick: async () => {
                window.open(
                    `https://www.google.com/search?q=${encodeURIComponent(txt('documentPreview.menu.googleQuery', { word }))}`,
                    '_blank',
                    'noopener,noreferrer',
                );
                dismiss();
            },
        },
        {
            id: 'highlight-word-instances',
            label: txt('documentPreview.menu.highlightInstances'),
            onClick: async () => {
                addHighlight(word);
                dismiss();
            },
        },
        {
            id: 'define-word',
            label: txt('documentPreview.menu.define'),
            disabled: !aiReady,
            hint: txt('aiWarmUp.locked'),
            onClick: async () => {
                try {
                    const normalizedText = await getNormalizedText(fullText);
                    alert(await defineWordInContext(word, normalizedText));
                } catch (error) {
                    alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
                } finally {
                    dismiss();
                }
            },
        },
        {
            id: 'mark-this-location',
            label: txt('documentPreview.menu.markLocation'),
            onClick: async () => {
                const coords = getDocumentCoordinates();
                onMarkLocation(coords.x, coords.y, word);
                dismiss();
            },
        },
    ];

    const displayWord = word.length > 120 ? `${word.slice(0, 25)}...${word.slice(-25)}` : word;

    // Rendered on the body so it stays above the dialog and positioned by viewport coordinates
    return createPortal(
        <div className={Styles.menu} onMouseUp={e => e.stopPropagation()} style={{ left: x, top: y }}>
            <div className={Styles.selectedWord}>{displayWord}</div>
            {menuItems.map(item => (
                <AsyncInteractionButton
                    key={item.id}
                    variant="transparent"
                    className={Styles.menuButton}
                    action={item.onClick}
                    disabled={item.disabled}
                    title={item.disabled ? item.hint : undefined}
                >
                    {item.label}
                </AsyncInteractionButton>
            ))}
        </div>,
        document.body,
    );
});
