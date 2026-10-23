import { delMany, keys } from 'idb-keyval';

/** Each project keeps its own references, PDFs, annotations, questions and AI cache */
export type Project = { id: string; name: string; createdAt: string };

type ProjectsState = { projects: Project[]; last?: string };

/** The only key kept outside of the projects */
const PROJECTS_KEY = 'research-workflow/projects';

const prefixOf = (id: string) => `project/${id}/`;

let currentProject: string | undefined;

/** The key of the data inside the open project. Everything stored goes through here */
export function scoped(key: string) {
    if (!currentProject) throw new Error(`No project open to store ${key}`);
    return `${prefixOf(currentProject)}${key}`;
}

/** Before rendering anything of the project, so it reads its own data */
export function setCurrentProject(id: string | undefined) {
    currentProject = id;
}

export function loadProjects(): ProjectsState {
    try {
        const stored = localStorage.getItem(PROJECTS_KEY);
        return stored ? (JSON.parse(stored) as ProjectsState) : { projects: [] };
    } catch (e) {
        console.error('Failed to load the projects', e);
        return { projects: [] };
    }
}

export function saveProjects(state: ProjectsState) {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(state));
}

/** crypto.randomUUID is missing outside of secure contexts, as when opened through http://<ip> */
export const newProjectId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The keys of the open project, without the project prefix */
export function projectEntries() {
    const prefix = scoped('');
    const entries: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith(prefix)) entries[key.slice(prefix.length)] = localStorage.getItem(key)!;
    }
    return entries;
}

function removeStoredWithPrefix(prefix: string) {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith(prefix)) toRemove.push(key);
    }
    toRemove.forEach(key => localStorage.removeItem(key));
}

/** Removes what the open project keeps on localStorage, leaving its PDFs */
export function clearProjectEntries() {
    removeStoredWithPrefix(scoped(''));
}

/** Everything the project kept, PDFs included */
export async function deleteProjectData(id: string) {
    const prefix = prefixOf(id);
    removeStoredWithPrefix(prefix);
    const files = (await keys()).filter(key => typeof key === 'string' && key.startsWith(prefix));
    await delMany(files);
}
