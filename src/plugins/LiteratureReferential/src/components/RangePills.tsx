import { X } from 'lucide-react';
import type { PageRange } from '../library';
import Styles from '../LiteratureReferential.module.css';

export default function RangePills({ ranges, onRemove }: { ranges: PageRange[]; onRemove?: (range: PageRange) => void }) {
    return (
        <ul className={Styles.pills}>
            {ranges.map(range => (
                <li key={`${range.from}-${range.to}`} className={Styles.pill} data-testid="literature-range">
                    {range.from === range.to ? range.from : `${range.from}–${range.to}`}
                    {onRemove && (
                        <button type="button" aria-label="Remover intervalo" onClick={() => onRemove(range)}>
                            <X size={12} />
                        </button>
                    )}
                </li>
            ))}
        </ul>
    );
}
