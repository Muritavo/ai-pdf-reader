import { get, set } from 'idb-keyval';
import type { FullText } from '../models/Article';
import { scoped } from './projects';

/** The folder the attachments of every document of the project are kept on, chosen once */
const FOLDER_KEY = 'attachments_folder';

/** Inside the folder of each document */
const ATTACHMENTS_FOLDER = 'attachments';

export type AttachmentEntry = {
    name: string;
    /** From the folder of the document, as `attachments/file.docx` */
    path: string;
} & ({ kind: 'file'; handle: FileSystemFileHandle } | { kind: 'directory'; children: AttachmentEntry[] });

/** Only Chromium based browsers let a page write to a folder of the computer */
export const canManageFolders = () => 'showDirectoryPicker' in window;

/** The fallback, as Safari and Firefox only have a storage of their own, that is not a folder of the computer */
export const canUseBrowserStorage = () => 'storage' in navigator && 'getDirectory' in navigator.storage;

/** The folder of the project inside the private storage of the browser, standing for the chosen one */
export async function getBrowserAttachmentsFolder() {
    let folder = await navigator.storage.getDirectory();
    for (const part of scoped(ATTACHMENTS_FOLDER).split('/')) folder = await folder.getDirectoryHandle(part, { create: true });
    return folder;
}

/** The handle is kept on IndexedDB, as it can't be serialized to localStorage */
export async function getAttachmentsFolder() {
    return (await get(scoped(FOLDER_KEY))) as FileSystemDirectoryHandle | undefined;
}

/** Opens the folder picker of the system. Undefined when the user gives up choosing */
export async function chooseAttachmentsFolder() {
    try {
        const folder = await window.showDirectoryPicker({ id: 'attachments', mode: 'readwrite' });
        await set(scoped(FOLDER_KEY), folder);
        return folder;
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return undefined;
        throw e;
    }
}

/**
 * The browser forgets the access to the folder between sessions, so it is asked again.
 * Asking needs a click of the user, so this is called from one.
 */
export async function hasAccess(folder: FileSystemDirectoryHandle, ask: boolean) {
    // Handles that don't need permissions (as the private storage of the browser) don't have these methods
    if (!folder.queryPermission) return true;
    if ((await folder.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return ask && (await folder.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Without the extension, and without what can't be on the name of a folder */
export function documentFolderName(fullText: FullText) {
    const name = fullText.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim();
    return name || fullText.hash.slice(0, 12);
}

async function readFolder(folder: FileSystemDirectoryHandle, path: string): Promise<AttachmentEntry[]> {
    const entries: AttachmentEntry[] = [];
    for await (const handle of folder.values()) {
        const entryPath = path ? `${path}/${handle.name}` : handle.name;
        // Files the system keeps, as .DS_Store
        if (handle.name.startsWith('.')) continue;
        entries.push(
            handle.kind === 'directory'
                ? { kind: 'directory', name: handle.name, path: entryPath, children: await readFolder(handle, entryPath) }
                : { kind: 'file', name: handle.name, path: entryPath, handle },
        );
    }
    // The folders first, then by name
    return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
}

/** Everything on the folder of the document, as it is on the disk. Empty when it was not created yet */
export async function listDocumentFolder(root: FileSystemDirectoryHandle, fullText: FullText) {
    try {
        return await readFolder(await root.getDirectoryHandle(documentFolderName(fullText)), '');
    } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') return [];
        throw e;
    }
}

/**
 * Safari before 26 only writes to its private storage from a worker, through a sync access handle.
 * The worker finds the folder by its path from the root of that storage.
 */
const SYNC_WRITER = `
onmessage = async ({ data: { path, file } }) => {
    try {
        let folder = await navigator.storage.getDirectory();
        for (const part of path) folder = await folder.getDirectoryHandle(part, { create: true });
        const access = await (await folder.getFileHandle(file.name, { create: true })).createSyncAccessHandle();
        access.truncate(0);
        access.write(new Uint8Array(await file.arrayBuffer()), { at: 0 });
        access.flush();
        access.close();
        postMessage({ ok: true });
    } catch (e) {
        postMessage({ ok: false, error: String(e) });
    }
};`;

async function writeFromWorker(folder: FileSystemDirectoryHandle, file: File) {
    const path = await (await navigator.storage.getDirectory()).resolve(folder);
    if (!path) throw new Error('The folder is not on the private storage of the browser');
    const url = URL.createObjectURL(new Blob([SYNC_WRITER], { type: 'text/javascript' }));
    const worker = new Worker(url);
    try {
        await new Promise<void>((resolve, reject) => {
            worker.onmessage = ({ data }) => (data.ok ? resolve() : reject(new Error(data.error)));
            worker.onerror = e => reject(new Error(e.message));
            worker.postMessage({ path, file });
        });
    } finally {
        worker.terminate();
        URL.revokeObjectURL(url);
    }
}

async function writeFile(folder: FileSystemDirectoryHandle, file: File) {
    const handle = await folder.getFileHandle(file.name, { create: true });
    if (!('createWritable' in handle)) return writeFromWorker(folder, file);
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
}

/** Every file on the tree, inside of the folders too */
export function countFiles(entries: AttachmentEntry[]): number {
    return entries.reduce((count, entry) => count + (entry.kind === 'file' ? 1 : countFiles(entry.children)), 0);
}

/**
 * How many attachments the document has, without asking for anything, as it is read when the document opens.
 * Undefined when that can't be known yet: no folder chosen, or its access not allowed again in this session.
 */
export async function countAttachments(fullText: FullText) {
    let folder: FileSystemDirectoryHandle | undefined;
    if (canManageFolders()) {
        folder = await getAttachmentsFolder();
        if (!folder || !(await hasAccess(folder, false))) return undefined;
    } else if (canUseBrowserStorage()) folder = await getBrowserAttachmentsFolder();
    return folder && countFiles(await listDocumentFolder(folder, fullText));
}

/** Saves the files on `<document>/attachments/`, replacing the ones with the same name */
export async function addAttachments(root: FileSystemDirectoryHandle, fullText: FullText, files: File[]) {
    const documentFolder = await root.getDirectoryHandle(documentFolderName(fullText), { create: true });
    const attachments = await documentFolder.getDirectoryHandle(ATTACHMENTS_FOLDER, { create: true });
    for (const file of files) await writeFile(attachments, file);
}

/** Removes the file from the disk, by its path from the folder of the document */
export async function removeAttachment(root: FileSystemDirectoryHandle, fullText: FullText, path: string) {
    const parts = path.split('/');
    const name = parts.pop()!;
    let folder = await root.getDirectoryHandle(documentFolderName(fullText));
    for (const part of parts) folder = await folder.getDirectoryHandle(part);
    await folder.removeEntry(name);
}

/** The PDFs are shown on the window, the other files downloaded */
export const isPdf = (name: string) => /\.pdf$/i.test(name);

/** Downloads the file, as it is opened by the app that handles it (a .docx has no preview here) */
export async function openAttachment(handle: FileSystemFileHandle) {
    const url = URL.createObjectURL(await handle.getFile());
    const link = document.createElement('a');
    link.href = url;
    link.download = handle.name;
    link.click();
    URL.revokeObjectURL(url);
}
