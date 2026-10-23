import { useRef } from 'react';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Download, Upload } from 'lucide-react';
import { downloadExport, importData, parseExport } from '../../utils/dataTransfer';
import { TestIds } from '../../testids';
import Styles from './DataTransfer.module.css';

/** Exports all the data of the app to a JSON file, and imports it back, as to move it to another machine */
export default function DataTransfer() {
    const { txt } = useShortIntl();
    const fileInput = useRef<HTMLInputElement>(null);

    const importFile = async (file: File) => {
        const data = parseExport(await file.text());
        if (!data) {
            alert(txt('dataTransfer.invalid'));
            return;
        }
        if (!window.confirm(txt('dataTransfer.confirmImport', { date: new Date(data.exportedAt).toLocaleString('pt-BR') }))) return;
        importData(data);
        // Everything reads the storage when it starts, so the app starts again with what was imported
        window.location.reload();
    };

    return (
        <div className={Styles.buttons}>
            <button
                type="button"
                className={Styles.button}
                data-testid={TestIds.dataTransfer.export}
                title={txt('dataTransfer.export')}
                aria-label={txt('dataTransfer.export')}
                onClick={downloadExport}
            >
                <Download size={18} strokeWidth={1.75} />
            </button>
            <button
                type="button"
                className={Styles.button}
                data-testid={TestIds.dataTransfer.import}
                title={txt('dataTransfer.import')}
                aria-label={txt('dataTransfer.import')}
                onClick={() => fileInput.current?.click()}
            >
                <Upload size={18} strokeWidth={1.75} />
            </button>
            <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                hidden
                data-testid={TestIds.dataTransfer.importInput}
                onChange={e => {
                    const file = e.target.files?.item(0);
                    if (file) importFile(file);
                    e.target.value = '';
                }}
            />
        </div>
    );
}
