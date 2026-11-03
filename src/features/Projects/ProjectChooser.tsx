import { useState } from 'react';
import Button from '@onepercentio/one-ui/components/Button';
import Text from '@onepercentio/one-ui/components/Text';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { FolderOpen, Trash2 } from 'lucide-react';
import { useProjects } from '../../context/ProjectsContext';
import type { Project } from '../../utils/projects';
import { TestIds } from '../../testids';
import Styles from './Projects.module.css';

/** Projects opened before the date was kept count from their creation */
const openedAt = (project: Project) => project.lastOpenedAt ?? project.createdAt;

/** Shown when no project is open: the first time, or after switching projects */
export default function ProjectChooser() {
    const { txt } = useShortIntl();
    const { projects, last, open, create, remove } = useProjects();
    const [name, setName] = useState('');
    // The most recently opened first, the last one used on top of all
    const sorted = [...projects].sort((a, b) =>
        a.id === last ? -1 : b.id === last ? 1 : openedAt(b).localeCompare(openedAt(a)),
    );

    return (
        <main className={Styles.chooser} data-testid={TestIds.projects.chooser}>
            <Text type="subtitle">{txt('projects.title')}</Text>
            <Text type="description">{txt('projects.description')}</Text>
            <form
                className={Styles.create}
                onSubmit={e => {
                    e.preventDefault();
                    if (name.trim()) create(name);
                }}
            >
                <input
                    className={Styles.input}
                    placeholder={txt('projects.namePlaceholder')}
                    aria-label={txt('projects.namePlaceholder')}
                    data-testid={TestIds.projects.nameInput}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    autoFocus
                />
                <Button variant="primary" type="submit" disabled={!name.trim()} data-testid={TestIds.projects.create}>
                    {txt('projects.create')}
                </Button>
            </form>
            {sorted.length === 0 ? (
                <Text type="caption">{txt('projects.empty')}</Text>
            ) : (
                <ul className={Styles.list}>
                    {sorted.map(project => (
                        <li key={project.id} className={Styles.item} data-testid={TestIds.projects.item}>
                            <button type="button" className={Styles.open} onClick={() => open(project.id)}>
                                <FolderOpen size={18} strokeWidth={1.75} />
                                <span className={Styles.name}>{project.name}</span>
                                <Text type="caption">
                                    {project.id === last
                                        ? txt('projects.last')
                                        : project.lastOpenedAt
                                          ? txt('projects.lastOpenedAt', {
                                                date: new Date(project.lastOpenedAt).toLocaleDateString('pt-BR'),
                                            })
                                          : txt('projects.createdAt', {
                                                date: new Date(project.createdAt).toLocaleDateString('pt-BR'),
                                            })}
                                </Text>
                            </button>
                            <button
                                type="button"
                                className={Styles.remove}
                                title={txt('projects.remove')}
                                aria-label={txt('projects.remove')}
                                data-testid={TestIds.projects.remove}
                                onClick={() => {
                                    if (window.confirm(txt('projects.confirmRemove', { name: project.name }))) remove(project.id);
                                }}
                            >
                                <Trash2 size={16} strokeWidth={1.75} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
