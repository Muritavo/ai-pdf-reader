import { forwardRef, useImperativeHandle, useState, type ForwardedRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import ScrollendIndicator from '@onepercentio/one-ui/components/ScrollendIndicator';
import ARDiv from '@onepercentio/one-ui/components/ARDiv';
import Styles from './FeaturesMenu.module.scss';
import type { FullText } from '../../../../models/Article';
import { defineWordInContext, findReferenceInContext } from '../../../../services/ai';
import { useWarmUp } from '../../../../context/AIContext';
import { TestIds } from '../../../../testids';
import AsyncInteractionButton from '../../../../components/AsyncInteractionButton';
import { usePlugins } from '../../../../context/PluginsContext';
import type { PluginResult } from '../../../../plugins/types';

/** Reopening follows the selection while it changes, as on touch it is adjusted by its handles after it opens */
export type FeaturesMenuHandle = { openMenu(reopen?: boolean): void; closeMenu(): void };

type MenuItem = {
    id: string;
    testId: string;
    label: ReactNode;
    onClick: () => Promise<void>;
    disabled?: boolean;
    hint?: string;
    /** The action is only recommended for a selection with at least this many words, as a statement and not a term */
    minWords?: number;
    /** The action is only recommended for a selection with at most this many words, as a term and not a statement */
    maxWords?: number;
    /** The action is only offered for a selection in this format (as a DOI), and never set apart as not recommended */
    textFormat?: RegExp;
};

/** More than 5 words: a passage, about which it makes sense to ask or look for a reference */
const PASSAGE_MIN_WORDS = 6;

/** A DOI, as is or with its `doi:` or `https://doi.org/` prefix */
const DOI_FORMAT = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i;

const MAX_MENU_HEIGHT = 340;
/** Enough for the selected text and a couple of actions, even close to the bottom of the screen */
const MIN_MENU_HEIGHT = 180;

type FeaturesMenuProps = {
    addHighlight: (word: string) => void;
    fullText: FullText;
    /** The AI backed actions are locked until the AI is online and the document warmed up */
    aiReady: boolean;
    getDocumentCoordinates: () => { x: number; y: number };
    /** The window the document is in, whose selection it reads and where it shows (on AR, the dialog's own) */
    getWindow: () => Window;
    onMarkLocation: (x: number, y: number, word: string) => void;
    /** Starts a question about the selected statement on the prompt */
    onAskAbout: (statement: string) => void;
    /** Keeps the definition of an excerpt, so every place it is on is marked */
    onDefined: (word: string, definition: string) => void;
    /** Shows the reference found for the selected passage */
    onReferenceFound: (passage: string, answer: string) => void;
    /** Shows what the action of a plugin found */
    onPluginResult: (result: PluginResult) => void;
};

function extractSelectedWord(selectionText: string) {
    const collapsedText = selectionText.replace(/\s+/g, ' ').trim();
    return collapsedText.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || undefined;
}

export default forwardRef(function FeaturesMenu(
    {
        addHighlight,
        fullText,
        aiReady,
        getDocumentCoordinates,
        getWindow,
        onMarkLocation,
        onReferenceFound,
        onDefined,
        onAskAbout,
        onPluginResult,
    }: FeaturesMenuProps,
    ref: ForwardedRef<FeaturesMenuHandle>,
) {
    const { txt } = useShortIntl();
    const { prepare } = useWarmUp(fullText);
    const { menuOptions: pluginOptions } = usePlugins();
    const [word, setWord] = useState<string>();
    const [{ x, y }, setPosition] = useState({ x: 0, y: 0 });

    useImperativeHandle(
        ref,
        () => ({
            openMenu(reopen) {
                if (word && !reopen) return;
                const selection = getWindow().getSelection();
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
        getWindow().getSelection()?.removeAllRanges();
        setWord(undefined);
    }

    const menuItems: MenuItem[] = [
        {
            id: 'open-doi',
            testId: TestIds.menu.openDoi,
            textFormat: DOI_FORMAT,
            label: txt('documentPreview.menu.openDoi'),
            onClick: async () => {
                const doi = DOI_FORMAT.exec(word)![1];
                window.open(`https://doi.org/${doi}`, '_blank', 'noopener,noreferrer');
                dismiss();
            },
        },
        {
            id: 'search-on-google',
            testId: TestIds.menu.searchOnGoogle,
            // Less than 5 words: a term, that a search finds
            maxWords: 4,
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
                    const normalizedText = await prepare();
                    const definition = await defineWordInContext(word, normalizedText);
                    onDefined(word, definition);
                    alert(definition);
                } catch (error) {
                    alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
                } finally {
                    dismiss();
                }
            },
        },
        {
            id: 'ask-about',
            testId: TestIds.menu.askAbout,
            label: txt('documentPreview.menu.askAbout'),
            minWords: PASSAGE_MIN_WORDS,
            disabled: !aiReady,
            hint: txt('aiWarmUp.locked'),
            onClick: async () => {
                onAskAbout(word);
                dismiss();
            },
        },
        {
            id: 'find-reference',
            testId: TestIds.menu.reference,
            label: txt('documentPreview.menu.reference'),
            minWords: PASSAGE_MIN_WORDS,
            disabled: !aiReady,
            hint: txt('aiWarmUp.locked'),
            // A failure is left to the button, that offers to try again with the passage still selected
            onClick: async () => {
                const normalizedText = await prepare();
                onReferenceFound(word, await findReferenceInContext(word, normalizedText));
                dismiss();
            },
        },
        {
            id: 'mark-this-location',
            testId: TestIds.menu.markLocation,
            // A single word, as the place is where the selection starts
            minWords: 1,
            maxWords: 1,
            label: txt('documentPreview.menu.markLocation'),
            onClick: async () => {
                const coords = getDocumentCoordinates();
                onMarkLocation(coords.x, coords.y, word);
                dismiss();
            },
        },
    ];

    // The plugins only offer their actions for the selections they know about (as a protein, for UniProt)
    for (const option of pluginOptions) {
        if (option.matches && !option.matches(word)) continue;
        menuItems.push({
            id: `plugin-${option.id}`,
            testId: option.testId ?? `menu-plugin-${option.id}`,
            label: typeof option.label === 'function' ? option.label() : option.label,
            minWords: option.minWords,
            maxWords: option.maxWords,
            onClick: async () => {
                await option.onClick({ selection: word, showResult: onPluginResult });
                dismiss();
            },
        });
    }

    const selectedWords = word.split(/\s+/).filter(Boolean).length;
    const displayWord = word.length > 120 ? `${word.slice(0, 25)}...${word.slice(-25)}` : word;

    const fitsSelection = (item: MenuItem) =>
        (item.minWords === undefined || selectedWords >= item.minWords) &&
        (item.maxWords === undefined || selectedWords <= item.maxWords);
    // The actions bound to a text format are only offered for a selection in that format
    const offeredItems = menuItems.filter(item => !item.textFormat || item.textFormat.test(word));
    // The actions not meant for a selection of this size are still offered, set apart after the recommended ones
    const recommendedItems = offeredItems.filter(fitsSelection);
    const notRecommendedItems = offeredItems.filter(item => !fitsSelection(item));

    function renderItem(item: MenuItem) {
        return (
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
        );
    }

    // Rendered on the body (of the document's window) so it stays above the dialog and positioned by viewport coordinates
    const view = getWindow();
    return createPortal(
        // On AR, lifted into a window of its own beside the document
        <ARDiv
            data-testid={TestIds.menu.root}
            className={Styles.menu}
            onMouseUp={e => e.stopPropagation()}
            onARExit={dismiss}
            // Beside the document, which keeps the focus so reading goes on
            snapToWindow="right"
            focus={false}
            // Limited, and never past the bottom of the screen, as it opens under the selection
            style={{ left: x, top: y, maxHeight: Math.max(MIN_MENU_HEIGHT, Math.min(MAX_MENU_HEIGHT, view.innerHeight - y - 16)) }}
        >
            <div className={Styles.selectedWord}>{displayWord}</div>
            <div className={Styles.actions} data-testid={TestIds.menu.actions}>
                {recommendedItems.map(renderItem)}
                {notRecommendedItems.length > 0 && (
                    <div className={Styles.notRecommended}>
                        <div className={Styles.sectionTitle}>{txt('documentPreview.menu.notRecommended')}</div>
                        {notRecommendedItems.map(renderItem)}
                    </div>
                )}
                {/* Shows there are more actions above or below. The menu, not this list, is what it is placed on, so it stays still while the list scrolls */}
                <ScrollendIndicator indicatorSize={28} maxGradientScroll={80} />
            </div>
        </ARDiv>,
        view.document.body,
    );
});
