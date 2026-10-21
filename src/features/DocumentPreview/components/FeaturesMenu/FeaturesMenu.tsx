import { forwardRef, useImperativeHandle, useState, type ForwardedRef } from 'react';
import { createPortal } from 'react-dom';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import Styles from './FeaturesMenu.module.scss';
import type { FullText } from '../../../../models/Article';
import { defineWordInContext, findReferenceInContext } from '../../../../services/ai';
import { getNormalizedText } from '../../../../utils/preprocessing';
import { TestIds } from '../../../../testids';
import AsyncInteractionButton from '../../../../components/AsyncInteractionButton';

export type FeaturesMenuHandle = { openMenu(): void; closeMenu(): void };

type FeaturesMenuProps = {
    addHighlight: (word: string) => void;
    fullText: FullText;
    /** The AI backed actions are locked until the AI is online and the document warmed up */
    aiReady: boolean;
    getDocumentCoordinates: () => { x: number; y: number };
    onMarkLocation: (x: number, y: number, word: string) => void;
    /** Shows the reference found for the selected passage */
    onReferenceFound: (passage: string, answer: string) => void;
};

function extractSelectedWord(selectionText: string) {
    const collapsedText = selectionText.replace(/\s+/g, ' ').trim();
    return collapsedText.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || undefined;
}

export default forwardRef(function FeaturesMenu(
    { addHighlight, fullText, aiReady, getDocumentCoordinates, onMarkLocation, onReferenceFound }: FeaturesMenuProps,
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
            testId: TestIds.menu.searchOnGoogle,
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
            testId: TestIds.menu.highlight,
            label: txt('documentPreview.menu.highlightInstances'),
            onClick: async () => {
                addHighlight(word);
                dismiss();
            },
        },
        {
            id: 'define-word',
            testId: TestIds.menu.define,
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
            id: 'find-reference',
            testId: TestIds.menu.reference,
            label: txt('documentPreview.menu.reference'),
            disabled: !aiReady,
            hint: txt('aiWarmUp.locked'),
            // A failure is left to the button, that offers to try again with the passage still selected
            onClick: async () => {
                const normalizedText = await getNormalizedText(fullText);
                onReferenceFound(word, await findReferenceInContext(word, normalizedText));
                dismiss();
            },
        },
        {
            id: 'mark-this-location',
            testId: TestIds.menu.markLocation,
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
        <div data-testid={TestIds.menu.root} className={Styles.menu} onMouseUp={e => e.stopPropagation()} style={{ left: x, top: y }}>
            <div className={Styles.selectedWord}>{displayWord}</div>
            {menuItems.map(item => (
                <AsyncInteractionButton
                    key={item.id}
                    data-testid={item.testId}
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
