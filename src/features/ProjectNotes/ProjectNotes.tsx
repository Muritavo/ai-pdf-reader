import { useRef, useState } from 'react';
import Text from '@onepercentio/one-ui/components/Text';
import Button from '@onepercentio/one-ui/components/Button';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import useLocalStorage from '@onepercentio/one-ui/hooks/persistence/useLocalStorage';
import { NotebookPen, Pencil, Trash2 } from 'lucide-react';
import { scoped } from '../../utils/projects';
import { TestIds } from '../../testids';
import Styles from './ProjectNotes.module.scss';

type ProjectNote = { id: number; text: string; createdAt: number };

/** The notes of the project as a whole, not of any article */
export default function ProjectNotes() {
    const { txt } = useShortIntl();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    // The note whose text is on the input to be changed
    const [editing, setEditing] = useState<number>();
    const [notes, setNotes] = useLocalStorage<ProjectNote[]>(scoped('projectNotes'), []);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const submit = () => {
        const text = draft.trim();
        if (!text) return;
        if (editing === undefined) setNotes(prev => [...prev, { id: Date.now(), text, createdAt: Date.now() }]);
        else setNotes(prev => prev.map(n => (n.id === editing ? { ...n, text } : n)));
        setEditing(undefined);
        setDraft('');
    };

    const startEdit = (note: ProjectNote) => {
        setEditing(note.id);
        setDraft(note.text);
        inputRef.current?.focus();
    };

    const cancelEdit = () => {
        setEditing(undefined);
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
                                ref={inputRef}
                                className={Styles.input}
                                rows={3}
                                placeholder={txt('projectNotes.placeholder')}
                                data-testid={TestIds.projectNotes.input}
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
                                    if (e.key === 'Escape' && editing !== undefined) {
                                        e.stopPropagation();
                                        cancelEdit();
                                    }
                                }}
                            />
                            <div className={Styles.actions}>
                                <Button variant="primary" data-testid={TestIds.projectNotes.add} disabled={!draft.trim()} onClick={submit}>
                                    {editing === undefined ? txt('projectNotes.add') : txt('projectNotes.save')}
                                </Button>
                                {editing !== undefined && (
                                    <Button variant="transparent" data-testid={TestIds.projectNotes.cancel} onClick={cancelEdit}>
                                        {txt('projectNotes.cancel')}
                                    </Button>
                                )}
                            </div>
                            {notes.length === 0 ? (
                                <Text type="caption">{txt('projectNotes.empty')}</Text>
                            ) : (
                                <ul className={Styles.list} data-testid={TestIds.projectNotes.list}>
                                    {notes.map(note => (
                                        <li
                                            key={note.id}
                                            className={`${Styles.item} ${editing === note.id ? Styles.editing : ''}`}
                                            data-testid={TestIds.projectNotes.item}
                                            data-editing={editing === note.id || undefined}
                                        >
                                            <span className={Styles.text}>{note.text}</span>
                                            <Button
                                                variant="transparent"
                                                // Hidden on the note being edited, but still taking its place so the note doesn't move
                                                className={editing === note.id ? Styles.hiddenAction : undefined}
                                                disabled={editing === note.id}
                                                title={txt('projectNotes.edit')}
                                                aria-label={txt('projectNotes.edit')}
                                                data-testid={TestIds.projectNotes.edit}
                                                onClick={() => startEdit(note)}
                                            >
                                                <Pencil size={16} aria-hidden />
                                            </Button>
                                            <Button
                                                variant="transparent"
                                                className={editing === note.id ? Styles.hiddenAction : undefined}
                                                disabled={editing === note.id}
                                                title={txt('projectNotes.remove')}
                                                aria-label={txt('projectNotes.remove')}
                                                data-testid={TestIds.projectNotes.remove}
                                                onClick={() => setNotes(prev => prev.filter(n => n.id !== note.id))}
                                            >
                                                <Trash2 size={16} strokeWidth={1.75} aria-hidden />
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
