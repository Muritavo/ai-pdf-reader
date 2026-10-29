import { useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import AdaptiveContainer from '@onepercentio/one-ui/components/AdaptiveContainer';
import { Plus, Trash2 } from 'lucide-react';
import { removeTag, tagColor, useArticleTags } from '../../utils/tags';
import { TestIds } from '../../testids';
import TagPickerModal from './components/TagPickerModal';
import Styles from './ArticleTags.module.scss';

/** The tags of the article, followed by the pill that adds more */
export default function ArticleTags({ articleKey }: { articleKey: string }) {
    const tags = useArticleTags(articleKey);
    const [picking, setPicking] = useState(false);

    return (
        <ul
            className={Styles.tags}
            data-testid={TestIds.tags.list}
            // Clicks on the pills, and on the picker (whose clicks bubble here through the portal), do not open
            // the document of the card. The rest of the line does, as the rest of the card
            onClick={e => {
                const target = e.target as HTMLElement;
                if (!e.currentTarget.contains(target) || target.closest('button')) e.stopPropagation();
            }}
        >
            {/* Keyed by the position, so the slot of the add pill animates into the tag that was added */}
            {tags.map((tag, i) => (
                <AdaptiveContainer key={i} containerElement="li" direction="h">
                    <span
                        key={tag}
                        className={Styles.tag}
                        data-testid={TestIds.tags.tag}
                        style={{ '--tag-color': tagColor(tag) } as CSSProperties}
                    >
                        {tag}
                        <button
                            type="button"
                            className={Styles.remove}
                            data-testid={TestIds.tags.remove}
                            title={`Remover "${tag}"`}
                            aria-label={`Remover "${tag}"`}
                            onClick={() => removeTag(articleKey, tag)}
                        >
                            <Trash2 size={12} strokeWidth={2} />
                        </button>
                    </span>
                </AdaptiveContainer>
            ))}
            <AdaptiveContainer key={tags.length} containerElement="li" direction="h">
                <button
                    key="add"
                    type="button"
                    className={Styles.add}
                    data-testid={TestIds.tags.add}
                    title="Adicionar tag"
                    aria-label="Adicionar tag"
                    onClick={() => setPicking(true)}
                >
                    <Plus size={12} strokeWidth={2.5} />
                </button>
            </AdaptiveContainer>
            {picking &&
                createPortal(<TagPickerModal articleKey={articleKey} onClose={() => setPicking(false)} />, document.body)}
        </ul>
    );
}
