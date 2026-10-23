import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { deleteProjectData, loadProjects, newProjectId, saveProjects, setCurrentProject, type Project } from '../utils/projects';

type ProjectsContextShape = {
    projects: Project[];
    /** The project open, undefined while choosing one */
    current?: Project;
    /** The project used the last time, to offer it first when choosing */
    last?: string;
    open: (id: string) => void;
    create: (name: string) => void;
    remove: (id: string) => Promise<void>;
    /** Closes the project, back to choosing one */
    switchProjects: () => void;
};

const ProjectsContext = createContext<ProjectsContextShape>(null as any);

export function ProjectsProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState(() => {
        const loaded = loadProjects();
        // The last project used opens straight away
        const current = loaded.projects.some(p => p.id === loaded.last) ? loaded.last : undefined;
        setCurrentProject(current);
        return { ...loaded, current };
    });

    const update = useCallback((projects: Project[], current: string | undefined, last = current) => {
        // Before rendering the project, so it reads its own data
        setCurrentProject(current);
        saveProjects({ projects, last });
        setState({ projects, last, current });
    }, []);

    const open = useCallback((id: string) => update(state.projects, id), [state.projects, update]);

    const create = useCallback(
        (name: string) => {
            const project: Project = { id: newProjectId(), name: name.trim(), createdAt: new Date().toISOString() };
            update([...state.projects, project], project.id);
        },
        [state.projects, update],
    );

    const remove = useCallback(
        async (id: string) => {
            await deleteProjectData(id);
            update(
                state.projects.filter(p => p.id !== id),
                undefined,
                state.last === id ? undefined : state.last,
            );
        },
        [state.projects, state.last, update],
    );

    const switchProjects = useCallback(() => update(state.projects, undefined, state.last), [state, update]);

    const value = useMemo(
        () => ({
            projects: state.projects,
            current: state.projects.find(p => p.id === state.current),
            last: state.last,
            open,
            create,
            remove,
            switchProjects,
        }),
        [state, open, create, remove, switchProjects],
    );

    return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects() {
    return useContext(ProjectsContext);
}
