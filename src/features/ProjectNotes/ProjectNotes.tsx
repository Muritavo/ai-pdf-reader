import { useState } from 'react';
import Text from '@onepercentio/one-ui/components/Text';
import Button from '@onepercentio/one-ui/components/Button';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import useLocalStorage from '@onepercentio/one-ui/hooks/persistence/useLocalStorage';
import { NotebookPen } from 'lucide-react';
import { scoped } from '../../utils/projects';
import { TestIds } from '../../testids';
import Styles from './ProjectNotes.module.scss';

type ProjectNote = { id: number; text: string; createdAt: number };

/** The notes of the project as a whole, not of any article */
export default function ProjectNotes() {
    const { txt } = useShortIntl();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const [notes, setNotes] = useLocalStorage<ProjectNote[]>(scoped('projectNotes'), []);

    const add = () => {
        const text = draft.trim();
        if (!text) return;
        setNotes(prev => [...prev, { id: Date.now(), text, createdAt: Date.now() }]);
        setDraft('');
    };

    return (
        <>
            <button
                type="button"
                className={Styles.trigger}
                title={txt('projectNotes.open')}
                aria-label={txt('projectNotes.open')}
                data-testid={TestIds.projectNotes.open}
                onClick={() => setOpen(true)}
            >
                <NotebookPen size={20} strokeWidth={1.8} aria-hidden />
            </button>
            {open && (
                <div className={Styles.overlay} onClick={() => setOpen(false)} data-testid={TestIds.projectNotes.modal}>
                    <div className={Styles.content} onClick={e => e.stopPropagation()}>
                        <div className={Styles.header}>
                            <Text type="subtitle" className={Styles.title}>
                                <NotebookPen size={20} strokeWidth={1.8} aria-hidden />
                                {txt('projectNotes.title')}
                            </Text>
                            <Button variant="transparent" onClick={() => setOpen(false)} aria-label={txt('projectNotes.close')}>
                                ✕
                            </Button>
                        </div>
                        <div className={Styles.body}>
                            <textarea
                                className={Styles.input}
                                rows={3}
                                placeholder={txt('projectNotes.placeholder')}
                                data-testid={TestIds.projectNotes.input}
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add();
                                }}
                            />
                            <div className={Styles.actions}>
                                <Button variant="primary" data-testid={TestIds.projectNotes.add} disabled={!draft.trim()} onClick={add}>
                                    {txt('projectNotes.add')}
                                </Button>
                            </div>
                            {notes.length === 0 ? (
                                <Text type="caption">{txt('projectNotes.empty')}</Text>
                            ) : (
                                <ul className={Styles.list} data-testid={TestIds.projectNotes.list}>
                                    {notes.map(note => (
                                        <li key={note.id} className={Styles.item} data-testid={TestIds.projectNotes.item}>
                                            <span className={Styles.text}>{note.text}</span>
                                            <Button
                                                variant="transparent"
                                                title={txt('projectNotes.remove')}
                                                aria-label={txt('projectNotes.remove')}
                                                data-testid={TestIds.projectNotes.remove}
                                                onClick={() => setNotes(prev => prev.filter(n => n.id !== note.id))}
                                            >
                                                ✕
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
