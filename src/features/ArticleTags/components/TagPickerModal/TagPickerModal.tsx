import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Text from '@onepercentio/one-ui/components/Text';
import Button from '@onepercentio/one-ui/components/Button';
import { addTag, sameTag, tagColor, useAllTags, useArticleTags } from '../../../../utils/tags';
import { TestIds } from '../../../../testids';
import Styles from './TagPickerModal.module.scss';

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Picks one of the tags in use, the most used first, or creates a new one from what was typed */
export default function TagPickerModal({ articleKey, onClose }: { articleKey: string; onClose: () => void }) {
    const allTags = useAllTags();
    const articleTags = useArticleTags(articleKey);
    const [query, setQuery] = useState('');
    const filterField = useRef<HTMLInputElement>(null);

    useEffect(() => {
        filterField.current?.focus();
    }, []);

    const typed = query.trim();
    const options = useMemo(() => {
        const q = normalize(typed);
        return allTags.filter(t => !articleTags.includes(t) && normalize(t).includes(q));
    }, [allTags, articleTags, typed]);
    const alreadyTagged = articleTags.some(t => sameTag(t, typed));

    const pick = (tag: string) => {
        addTag(articleKey, tag);
        onClose();
    };

    return (
        <div className={Styles.modalOverlay} onClick={onClose} data-testid={TestIds.tags.modal}>
            <div className={Styles.modalContent} onClick={e => e.stopPropagation()}>
                <div className={Styles.modalHeader}>
                    <Text type="subtitle">Adicionar tag</Text>
                    <Button variant="transparent" onClick={onClose} aria-label="Fechar">
                        ✕
                    </Button>
                </div>
                <form
                    className={Styles.body}
                    onSubmit={e => {
                        e.preventDefault();
                        if (typed && !alreadyTagged) pick(typed);
                    }}
                >
                    <div className={Styles.inputRow}>
                        <input
                            ref={filterField}
                            className={Styles.filter}
                            data-testid={TestIds.tags.filter}
                            placeholder="Filtrar ou criar tag"
                            aria-label="Filtrar ou criar tag"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Escape' && onClose()}
                        />
                        <Button
                            type="submit"
                            variant="primary"
                            data-testid={TestIds.tags.create}
                            disabled={!typed || alreadyTagged}
                        >
                            Adicionar
                        </Button>
                    </div>
                    {options.length > 0 ? (
                        <div className={Styles.options}>
                            {options.map(tag => (
                                <button
                                    key={tag}
                                    type="button"
                                    className={Styles.option}
                                    data-testid={TestIds.tags.option}
                                    style={{ '--tag-color': tagColor(tag) } as CSSProperties}
                                    onClick={() => pick(tag)}
                                >
                                    {tag}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <Text type="caption">
                            {allTags.length === 0 ? 'Nenhuma tag criada ainda.' : 'Nenhuma tag encontrada.'}
                        </Text>
                    )}
                </form>
            </div>
        </div>
    );
}
