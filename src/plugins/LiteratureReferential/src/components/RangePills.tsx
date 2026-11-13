import { Eye, X } from 'lucide-react';
import type { PageRange } from '../library';
import Styles from '../LiteratureReferential.module.css';

export default function RangePills({
    ranges,
    onRemove,
    onGoto,
}: {
    ranges: PageRange[];
    onRemove?: (range: PageRange) => void;
    onGoto?: (range: PageRange) => void;
}) {
    return (
        <ul className={Styles.pills}>
            {ranges.map(range => (
                <li key={`${range.from}-${range.to}`} className={Styles.pill} data-testid="literature-range">
                    {range.from === range.to ? range.from : `${range.from}–${range.to}`}
                    {onGoto && (
                        <button type="button" aria-label="Ir para o intervalo" title="Ir para o intervalo" onClick={() => onGoto(range)}>
                            <Eye size={12} />
                        </button>
                    )}
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
