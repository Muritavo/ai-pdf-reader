import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Text from '@onepercentio/one-ui/components/Text';
import Button from '@onepercentio/one-ui/components/Button';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { ArrowLeft, Eye, File as FileIcon, Folder, Paperclip, Trash2 } from 'lucide-react';
import type { FullText } from '../../../../models/Article';
import {
    addAttachments,
    canManageFolders,
    canUseBrowserStorage,
    chooseAttachmentsFolder,
    countAttachments,
    countFiles,
    documentFolderName,
    getAttachmentsFolder,
    getBrowserAttachmentsFolder,
    hasAccess,
    isPdf,
    listDocumentFolder,
    openAttachment,
    removeAttachment,
    type AttachmentEntry,
} from '../../../../utils/attachments';
import { TestIds } from '../../../../testids';
import Styles from './Attachments.module.scss';

/** What the window shows: why the attachments can't be listed yet, or the files */
type State =
    | { phase: 'unsupported' | 'choose' | 'loading' }
    | { phase: 'denied'; folder: FileSystemDirectoryHandle }
    | {
          phase: 'list';
          folder: FileSystemDirectoryHandle;
          entries: AttachmentEntry[];
          /** Kept on the private storage of the browser, when it can't use a folder of the computer */
          inBrowser?: boolean;
          /** A PDF shown on the window instead of the list */
          preview?: { name: string; url: string };
      };

type EntryTreeProps = {
    entries: AttachmentEntry[];
    onOpen: (entry: Extract<AttachmentEntry, { kind: 'file' }>) => void;
    onRemove: (entry: AttachmentEntry) => void;
};

function EntryTree({ entries, onOpen, onRemove }: EntryTreeProps) {
    const { txt } = useShortIntl();

    return (
        <ul className={Styles.tree}>
            {entries.map(entry => (
                <li key={entry.path}>
                    {entry.kind === 'directory' ? (
                        <>
                            <span className={Styles.folder}>
                                <Folder size={16} strokeWidth={1.75} />
                                {entry.name}
                            </span>
                            <EntryTree entries={entry.children} onOpen={onOpen} onRemove={onRemove} />
                        </>
                    ) : (
                        <div className={Styles.fileRow}>
                            <button
                                type="button"
                                className={Styles.file}
                                data-testid={TestIds.attachments.file}
                                title={txt(isPdf(entry.name) ? 'attachments.preview' : 'attachments.download')}
                                onClick={() => onOpen(entry)}
                            >
                                <FileIcon size={16} strokeWidth={1.75} />
                                {entry.name}
                            </button>
                            <button
                                type="button"
                                className={Styles.remove}
                                data-testid={TestIds.attachments.remove}
                                title={txt('attachments.remove')}
                                aria-label={txt('attachments.remove')}
                                onClick={() => onRemove(entry)}
                            >
                                <Trash2 size={15} strokeWidth={1.75} />
                            </button>
                        </div>
                    )}
                </li>
            ))}
        </ul>
    );
}

/** The files that go with the document (as the supplementary material), kept on a folder of the computer, or of the browser when it has no access to one */
export default function Attachments({ fullText }: { fullText: FullText }) {
    const { txt } = useShortIntl();
    const [state, setState] = useState<State>();
    const [error, setError] = useState(false);
    const [count, setCount] = useState<number>();
    /** While held, the window is hidden, for the document under it to be compared with the attachment */
    const [peeking, setPeeking] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let current = true;
        countAttachments(fullText)
            .then(found => current && setCount(found))
            .catch(e => console.error('Failed to count the attachments', e));
        return () => {
            current = false;
        };
    }, [fullText]);

    const list = async (folder: FileSystemDirectoryHandle, inBrowser = false) => {
        const entries = await listDocumentFolder(folder, fullText);
        setState({ phase: 'list', folder, inBrowser, entries });
        setCount(countFiles(entries));
    };

    // Called from the click, as asking for the access to the folder again needs one
    const show = async () => {
        setError(false);
        if (!canManageFolders() && !canUseBrowserStorage()) return setState({ phase: 'unsupported' });
        setState({ phase: 'loading' });
        try {
            if (!canManageFolders()) return await list(await getBrowserAttachmentsFolder(), true);
            const folder = await getAttachmentsFolder();
            if (!folder) return setState({ phase: 'choose' });
            if (!(await hasAccess(folder, true))) return setState({ phase: 'denied', folder });
            await list(folder);
        } catch (e) {
            console.error('Failed to open the attachments', e);
            setError(true);
            setState({ phase: 'choose' });
        }
    };

    const choose = async () => {
        setError(false);
        try {
            const folder = await chooseAttachmentsFolder();
            if (folder) await list(folder);
        } catch (e) {
            console.error('Failed to choose the attachments folder', e);
            setError(true);
        }
    };

    const allow = async (folder: FileSystemDirectoryHandle) => {
        if (await hasAccess(folder, true)) await list(folder);
    };

    const add = async (folder: FileSystemDirectoryHandle, inBrowser: boolean | undefined, files: File[]) => {
        setError(false);
        try {
            await addAttachments(folder, fullText, files);
            await list(folder, inBrowser);
        } catch (e) {
            console.error('Failed to save the attachments', e);
            setError(true);
        }
    };

    const remove = async (folder: FileSystemDirectoryHandle, inBrowser: boolean | undefined, entry: AttachmentEntry) => {
        if (!window.confirm(txt('attachments.confirmRemove', { name: entry.name }))) return;
        setError(false);
        try {
            await removeAttachment(folder, fullText, entry.path);
            await list(folder, inBrowser);
        } catch (e) {
            console.error('Failed to remove the attachment', e);
            setError(true);
        }
    };

    const open = async (state: Extract<State, { phase: 'list' }>, entry: Extract<AttachmentEntry, { kind: 'file' }>) => {
        if (!isPdf(entry.name)) return openAttachment(entry.handle);
        setState({
            ...state,
            preview: {
                name: entry.name,
                url: URL.createObjectURL(await entry.handle.getFile()),
            },
        });
    };

    const back = (state: Extract<State, { phase: 'list' }>) => {
        if (state.preview) URL.revokeObjectURL(state.preview.url);
        setState({ ...state, preview: undefined });
    };

    const close = () => {
        if (state?.phase === 'list' && state.preview) URL.revokeObjectURL(state.preview.url);
        setState(undefined);
    };

    return (
        <>
            <button
                type="button"
                className={Styles.trigger}
                data-testid={TestIds.attachments.open}
                title={txt('attachments.title')}
                aria-label={txt('attachments.title')}
                onClick={show}
            >
                <Paperclip size={18} strokeWidth={1.75} />
                {!!count && (
                    <span className={Styles.badge} data-testid={TestIds.attachments.count}>
                        {count > 99 ? '99+' : count}
                    </span>
                )}
            </button>
            {/* Rendered on the body, as the balloon the button is on keeps it under the other toolbars of the document */}
            {state &&
                createPortal(
                    <div
                        className={`${Styles.overlay} ${peeking ? Styles.peeking : ''}`}
                        onClick={close}
                        data-testid={TestIds.attachments.modal}
                    >
                        <div
                            className={`${Styles.content} ${state.phase === 'list' && state.preview ? Styles.previewing : ''}`}
                            onClick={e => e.stopPropagation()}
                        >
                            <div className={Styles.header}>
                                <Text type="subtitle">{txt('attachments.title')}</Text>
                                <Button variant="transparent" onClick={close} aria-label={txt('documentPreview.responseModal.close')}>
                                    ✕
                                </Button>
                            </div>
                            <div className={Styles.body}>
                                {state.phase === 'loading' && <Dots dotsCount={3} lockSize />}
                                {state.phase === 'unsupported' && <Text type="description">{txt('attachments.unsupported')}</Text>}
                                {state.phase === 'choose' && (
                                    <>
                                        <Text type="description">{txt('attachments.chooseFolder')}</Text>
                                        <Button variant="primary" onClick={choose} data-testid={TestIds.attachments.chooseFolder}>
                                            {txt('attachments.selectFolder')}
                                        </Button>
                                    </>
                                )}
                                {state.phase === 'denied' && (
                                    <>
                                        <Text type="description">{txt('attachments.denied', { folder: state.folder.name })}</Text>
                                        <div className={Styles.actions}>
                                            <Button variant="primary" onClick={() => allow(state.folder)}>
                                                {txt('attachments.allow')}
                                            </Button>
                                            <Button variant="transparent" onClick={choose}>
                                                {txt('attachments.changeFolder')}
                                            </Button>
                                        </div>
                                    </>
                                )}
                                {state.phase === 'list' && state.preview && (
                                    <>
                                        <div className={Styles.previewHeader}>
                                            <Button
                                                variant="transparent"
                                                onClick={() => back(state)}
                                                data-testid={TestIds.attachments.back}
                                            >
                                                <ArrowLeft size={16} strokeWidth={1.75} />
                                                {txt('attachments.back')}
                                            </Button>
                                            <span className={Styles.previewName}>{state.preview.name}</span>
                                            <button
                                                type="button"
                                                className={Styles.peek}
                                                data-testid={TestIds.attachments.peek}
                                                title={txt('attachments.peek')}
                                                aria-label={txt('attachments.peek')}
                                                onPointerDown={() => setPeeking(true)}
                                                onPointerUp={() => setPeeking(false)}
                                                onPointerLeave={() => setPeeking(false)}
                                                onPointerCancel={() => setPeeking(false)}
                                            >
                                                <Eye size={16} strokeWidth={1.75} />
                                            </button>
                                        </div>
                                        <iframe
                                            className={Styles.previewFrame}
                                            src={state.preview.url}
                                            title={state.preview.name}
                                            data-testid={TestIds.attachments.preview}
                                        />
                                    </>
                                )}
                                {state.phase === 'list' && !state.preview && (
                                    <>
                                        <div className={Styles.location}>
                                            <Folder size={16} strokeWidth={1.75} />
                                            <span>
                                                {state.inBrowser ? txt('attachments.browserFolder') : state.folder.name}/
                                                {documentFolderName(fullText)}
                                            </span>
                                        </div>
                                        {state.inBrowser && (
                                            <Text type="caption" data-testid={TestIds.attachments.browserNote}>
                                                {txt('attachments.inBrowser')}
                                            </Text>
                                        )}
                                        <div className={Styles.listing} data-testid={TestIds.attachments.list}>
                                            {state.entries.length > 0 ? (
                                                <EntryTree
                                                    entries={state.entries}
                                                    onOpen={entry => open(state, entry)}
                                                    onRemove={entry => remove(state.folder, state.inBrowser, entry)}
                                                />
                                            ) : (
                                                <Text type="caption">{txt('attachments.empty')}</Text>
                                            )}
                                        </div>
                                        <div className={Styles.actions}>
                                            <Button variant="primary" onClick={() => inputRef.current?.click()}>
                                                {txt('attachments.add')}
                                            </Button>
                                            {!state.inBrowser && (
                                                <Button variant="transparent" onClick={choose}>
                                                    {txt('attachments.changeFolder')}
                                                </Button>
                                            )}
                                        </div>
                                        <input
                                            ref={inputRef}
                                            type="file"
                                            multiple
                                            hidden
                                            data-testid={TestIds.attachments.fileInput}
                                            onChange={e => {
                                                const files = [...(e.target.files ?? [])];
                                                e.target.value = '';
                                                if (files.length) add(state.folder, state.inBrowser, files);
                                            }}
                                        />
                                    </>
                                )}
                                {error && (
                                    <Text type="caption" className={Styles.error}>
                                        {txt('attachments.error')}
                                    </Text>
                                )}
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}
