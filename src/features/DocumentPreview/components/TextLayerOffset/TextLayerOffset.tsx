import type { MouseEvent } from 'react';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { TestIds } from '../../../../testids';
import Styles from './TextLayerOffset.module.scss';

export type Offset = { x: number; y: number };

/** How many pixels each press moves the text layer */
const STEP = 1;

/** Moves the text layer over the page, for the documents where it is a bit off from the drawn text */
export default function TextLayerOffset({ offset, onChange }: { offset: Offset; onChange: (change: (offset: Offset) => Offset) => void }) {
    const { txt } = useShortIntl();
    // On mouse down, as it is pressed with Ctrl held, and on macOS a Ctrl click is a right click, with no click event
    const move = (x: number, y: number) => (e: MouseEvent) => {
        e.preventDefault();
        onChange(current => ({ x: current.x + x * STEP, y: current.y + y * STEP }));
    };
    const button = (x: number, y: number, label: string, icon: JSX.Element, area: string) => (
        <button
            type="button"
            className={Styles.button}
            style={{ gridArea: area }}
            title={label}
            aria-label={label}
            data-testid={TestIds.preview.textLayerOffsetMove}
            onMouseDown={move(x, y)}
        >
            {icon}
        </button>
    );

    return (
        <div className={Styles.anchor}>
            <div
                className={Styles.pad}
                data-testid={TestIds.preview.textLayerOffset}
                onContextMenu={e => e.preventDefault()}
                // Kept from the preview, so it does not open the menu of the selection
                onMouseUp={e => e.stopPropagation()}
            >
                {button(0, -1, txt('documentPreview.textLayerOffset.up'), <ChevronUp size={16} />, 'up')}
                {button(-1, 0, txt('documentPreview.textLayerOffset.left'), <ChevronLeft size={16} />, 'left')}
                <span className={Styles.value} style={{ gridArea: 'value' }} title={txt('documentPreview.textLayerOffset.title')}>
                    {offset.x},{offset.y}
                </span>
                {button(1, 0, txt('documentPreview.textLayerOffset.right'), <ChevronRight size={16} />, 'right')}
                {button(0, 1, txt('documentPreview.textLayerOffset.down'), <ChevronDown size={16} />, 'down')}
            </div>
        </div>
    );
}
