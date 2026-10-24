import { useState, type ComponentProps } from 'react';
import Button from '@onepercentio/one-ui/components/Button';
import Text from '@onepercentio/one-ui/components/Text';
import AdaptiveDialog from '@onepercentio/one-ui/components/AdaptiveDialog';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Plus } from 'lucide-react';
import { useArticlesRepository } from '../../context/ArticlesRepository';
import type { Article } from '../../models/Article';
import { TestIds } from '../../testids';
import Styles from './ManualReference.module.css';

type Fields = Omit<Article, 'key'>;

const EMPTY: Fields = { title: '', authors: '', year: '', journal: '', doi: '', abstract: '' };

const MANUAL_PREFIX = 'manual-';

/** Told apart from the keys of the CSV exports, so they never collide */
const newManualKey = () => `${MANUAL_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const isManualReference = (article: Article) => article.key.startsWith(MANUAL_PREFIX);

/** A reference typed by hand, for the ones that are not on the CSV of the screening */
export default function ManualReference({ variant = 'outline' }: { variant?: ComponentProps<typeof Button>['variant'] }) {
    const { txt } = useShortIntl();
    const { articles, setArticles } = useArticlesRepository();
    const [open, setOpen] = useState(false);
    const [fields, setFields] = useState<Fields>(EMPTY);

    const field = (name: keyof Fields) => ({
        value: fields[name],
        onChange: (e: { target: { value: string } }) => setFields(current => ({ ...current, [name]: e.target.value })),
    });

    const close = () => {
        setOpen(false);
        setFields(EMPTY);
    };

    const add = () => {
        const trimmed = Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, value.trim()])) as Fields;
        setArticles([...articles, { key: newManualKey(), ...trimmed }]);
        close();
    };

    return (
        <>
            <Button variant={variant} onClick={() => setOpen(true)} data-testid={TestIds.references.manualOpen}>
                <span className={Styles.trigger}>
                    <Plus size={16} strokeWidth={2} />
                    {txt(articles.length ? 'manualReference.addAnother' : 'manualReference.add')}
                </span>
            </Button>
            <AdaptiveDialog open={open} onClose={close} onClickOut={close}>
                <form
                    className={Styles.dialog}
                    data-testid={TestIds.references.manualForm}
                    onSubmit={e => {
                        e.preventDefault();
                        if (fields.title.trim()) add();
                    }}
                >
                    <Text type="subtitle">{txt('manualReference.title')}</Text>
                    <label className={Styles.field}>
                        <Text type="caption">{txt('manualReference.fields.title')} *</Text>
                        <input className={Styles.input} data-testid={TestIds.references.manualTitle} required autoFocus {...field('title')} />
                    </label>
                    <label className={Styles.field}>
                        <Text type="caption">{txt('manualReference.fields.authors')}</Text>
                        <input className={Styles.input} placeholder="Silva, A and Souza, B" {...field('authors')} />
                    </label>
                    <div className={Styles.row}>
                        <label className={`${Styles.field} ${Styles.year}`}>
                            <Text type="caption">{txt('manualReference.fields.year')}</Text>
                            <input className={Styles.input} inputMode="numeric" maxLength={4} {...field('year')} />
                        </label>
                        <label className={Styles.field}>
                            <Text type="caption">{txt('manualReference.fields.journal')}</Text>
                            <input className={Styles.input} {...field('journal')} />
                        </label>
                    </div>
                    <label className={Styles.field}>
                        <Text type="caption">{txt('manualReference.fields.doi')}</Text>
                        <input className={Styles.input} placeholder="10.1000/xyz123" {...field('doi')} />
                    </label>
                    <label className={Styles.field}>
                        <Text type="caption">{txt('manualReference.fields.abstract')}</Text>
                        <textarea className={Styles.input} rows={4} {...field('abstract')} />
                    </label>
                    <div className={Styles.actions}>
                        <Button type="button" variant="transparent" onClick={close}>
                            {txt('manualReference.cancel')}
                        </Button>
                        <Button type="submit" variant="primary" disabled={!fields.title.trim()} data-testid={TestIds.references.manualSave}>
                            {txt('manualReference.save')}
                        </Button>
                    </div>
                </form>
            </AdaptiveDialog>
        </>
    );
}
