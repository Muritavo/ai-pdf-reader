import { useState, type ComponentProps } from 'react';
import Button from '@onepercentio/one-ui/components/Button';
import Text from '@onepercentio/one-ui/components/Text';
import AdaptiveDialog from '@onepercentio/one-ui/components/AdaptiveDialog';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { ClipboardPaste, Plus } from 'lucide-react';
import { useArticlesRepository } from '../../context/ArticlesRepository';
import type { Article } from '../../models/Article';
import { parseNlmCitation, type CitationFields } from '../../utils/nlmCitation';
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
    // A citation found on the clipboard, or pasted on a field, waiting to be accepted
    const [citation, setCitation] = useState<CitationFields>();
    // Where the clipboard can't be read on its own, a banner offers to read it on a click (`missing`: nothing found there)
    const [pasteOffer, setPasteOffer] = useState<'ask' | 'missing'>();

    const field = (name: keyof Fields) => ({
        value: fields[name],
        onChange: (e: { target: { value: string } }) => setFields(current => ({ ...current, [name]: e.target.value })),
    });

    const offerCitationIn = (text: string) => {
        const found = parseNlmCitation(text);
        if (found) setCitation(found);
        return !!found;
    };

    const openForm = async () => {
        setOpen(true);
        // Only read right away when it is allowed already, as asking (or the "Paste" button of Safari and Firefox) gets in the way
        try {
            const permission = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
            if (permission.state === 'granted') {
                offerCitationIn(await navigator.clipboard.readText());
                return;
            }
        } catch {
            // Browsers that don't know this permission
        }
        setPasteOffer('ask');
    };

    const pasteFromClipboard = async () => {
        try {
            const found = offerCitationIn(await navigator.clipboard.readText());
            setPasteOffer(found ? undefined : 'missing');
        } catch {
            // Refused by the user, who can still paste on a field
            setPasteOffer(undefined);
        }
    };

    const close = () => {
        setOpen(false);
        setFields(EMPTY);
        setCitation(undefined);
        setPasteOffer(undefined);
    };

    const fillWithCitation = () => {
        setFields(current => ({ ...current, ...citation }));
        setCitation(undefined);
    };

    const add = () => {
        const trimmed = Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, value.trim()])) as Fields;
        setArticles([...articles, { key: newManualKey(), ...trimmed }]);
        close();
    };

    return (
        <>
            <Button variant={variant} onClick={openForm} data-testid={TestIds.references.manualOpen}>
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
                    // A whole citation pasted on a field is offered to fill the form instead
                    onPaste={e => {
                        if (!offerCitationIn(e.clipboardData.getData('text'))) return;
                        e.preventDefault();
                        setPasteOffer(undefined);
                    }}
                >
                    <Text type="subtitle">{txt('manualReference.title')}</Text>
                    {!citation && pasteOffer && (
                        <div className={Styles.citation} data-testid={TestIds.references.manualPasteOffer}>
                            <ClipboardPaste size={18} strokeWidth={1.75} className={Styles.citationIcon} aria-hidden />
                            <Text type="caption" className={Styles.citationText} role="status">
                                {txt(pasteOffer === 'ask' ? 'manualReference.citation.ask' : 'manualReference.citation.missing')}
                            </Text>
                            <Button type="button" variant="outline" onClick={pasteFromClipboard} data-testid={TestIds.references.manualPaste}>
                                {txt('manualReference.citation.paste')}
                            </Button>
                        </div>
                    )}
                    {citation && (
                        <div className={Styles.citation} data-testid={TestIds.references.manualCitation} role="status">
                            <ClipboardPaste size={18} strokeWidth={1.75} className={Styles.citationIcon} aria-hidden />
                            <div className={Styles.citationText}>
                                <Text type="caption">{txt('manualReference.citation.found')}</Text>
                                <span className={Styles.citationTitle}>{citation.title}</span>
                            </div>
                            <Button type="button" variant="transparent" onClick={() => setCitation(undefined)}>
                                {txt('manualReference.citation.dismiss')}
                            </Button>
                            <Button type="button" variant="outline" onClick={fillWithCitation} data-testid={TestIds.references.manualCitationFill}>
                                {txt('manualReference.citation.fill')}
                            </Button>
                        </div>
                    )}
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
