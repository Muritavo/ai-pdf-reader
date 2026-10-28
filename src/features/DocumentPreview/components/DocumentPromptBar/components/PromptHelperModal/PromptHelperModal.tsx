import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Text from '@onepercentio/one-ui/components/Text';
import Button from '@onepercentio/one-ui/components/Button';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import type { FullText } from '../../../../../../models/Article';
import { suggestPrompts } from '../../../../../../services/ai';
import { getNormalizedText } from '../../../../../../utils/preprocessing';
import { TestIds } from '../../../../../../testids';
import Styles from './PromptHelperModal.module.scss';

type PromptHelperModalProps = {
    fullText: FullText;
    /** Receives the suggestion the user picked, to be asked */
    onPick: (prompt: string) => void;
    onClose: () => void;
};

/** Turns what the user is researching into structured prompts about the document */
export default function PromptHelperModal({ fullText, onPick, onClose }: PromptHelperModalProps) {
    const { txt } = useShortIntl();
    const [query, setQuery] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>();
    const [isLoading, setIsLoading] = useState(false);
    const [isError, setIsError] = useState(false);
    const queryField = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        queryField.current?.focus();
    }, []);

    const handleSuggest = async () => {
        const researchQuery = query.trim();
        if (!researchQuery || isLoading) return;
        setIsLoading(true);
        setIsError(false);
        try {
            setSuggestions(await suggestPrompts(researchQuery, await getNormalizedText(fullText)));
        } catch {
            setIsError(true);
        } finally {
            setIsLoading(false);
        }
    };

    // As on the prompt bar, Enter asks for the suggestions while Shift+Enter breaks the line
    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
        e.preventDefault();
        handleSuggest();
    };

    return (
        <div className={Styles.modalOverlay} onClick={onClose} data-testid={TestIds.ai.promptHelperModal}>
            <div className={Styles.modalContent} onClick={e => e.stopPropagation()}>
                <div className={Styles.modalHeader}>
                    <Text type="subtitle">{txt('documentPreview.promptHelper.title')}</Text>
                    <Button variant="transparent" onClick={onClose} aria-label={txt('documentPreview.responseModal.close')}>
                        ✕
                    </Button>
                </div>

                <div className={Styles.body}>
                    <Text type="caption" className={Styles.sectionLabel}>
                        {txt('documentPreview.promptHelper.queryLabel')}
                    </Text>
                    <textarea
                        ref={queryField}
                        rows={3}
                        data-testid={TestIds.ai.promptHelperQuery}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className={Styles.queryInput}
                        placeholder={txt('documentPreview.promptHelper.queryPlaceholder')}
                    />
                    <div className={Styles.actions}>
                        <Button
                            variant="primary"
                            data-testid={TestIds.ai.promptHelperSuggest}
                            onClick={handleSuggest}
                            disabled={!query.trim() || isLoading}
                        >
                            {isLoading ? <Dots dotsCount={5} lockSize /> : txt('documentPreview.promptHelper.suggest')}
                        </Button>
                    </div>

                    {isError && (
                        <Text type="caption" className={Styles.errorText}>
                            {txt('documentPreview.promptHelper.error')}
                        </Text>
                    )}

                    {suggestions && (
                        <div className={Styles.suggestions}>
                            <Text type="caption" className={Styles.sectionLabel}>
                                {txt('documentPreview.promptHelper.suggestions')}
                            </Text>
                            {suggestions.map(suggestion => (
                                <button
                                    key={suggestion}
                                    type="button"
                                    data-testid={TestIds.ai.promptHelperSuggestion}
                                    className={Styles.suggestion}
                                    onClick={() => onPick(suggestion)}
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
