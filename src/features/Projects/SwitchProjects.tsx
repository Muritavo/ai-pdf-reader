import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { ArrowLeftRight } from 'lucide-react';
import { useProjects } from '../../context/ProjectsContext';
import { TestIds } from '../../testids';
import Styles from './Projects.module.css';

/** The open project, and the way back to choosing another */
export default function SwitchProjects() {
    const { txt } = useShortIntl();
    const { current, switchProjects } = useProjects();

    return (
        <button
            type="button"
            className={Styles.switch}
            data-testid={TestIds.projects.switch}
            title={txt('projects.switch')}
            onClick={switchProjects}
        >
            <ArrowLeftRight size={16} strokeWidth={1.75} />
            <span className={Styles.switchText}>
                <span className={Styles.switchLabel}>{txt('projects.switch')}</span>
                <span className={Styles.switchName} data-testid={TestIds.projects.currentName}>
                    {current?.name}
                </span>
            </span>
        </button>
    );
}
