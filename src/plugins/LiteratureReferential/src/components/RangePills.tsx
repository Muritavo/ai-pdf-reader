import { Eye, X } from 'lucide-react';
import { rangesOf, type BookPage, type PageRange } from '../library';
import Styles from '../LiteratureReferential.module.css';

/** The pages, as runs of consecutive ones. A page with a boundary is on its own, with a dotted border */
export default function RangePills({
    pages,
    onRemove,
    onGoto,
}: {
    pages: BookPage[];
    onRemove?: (range: PageRange) => void;
    onGoto?: (range: PageRange) => void;
}) {
    return (
        <ul className={Styles.pills}>
            {rangesOf(pages).map(range => (
                <li
                    key={`${range.from}-${range.to}`}
                    className={`${Styles.pill} ${range.boundary ? Styles.pillOutline : ''}`}
                    title={range.boundary ? 'Lida só dentro do limite' : undefined}
                    data-testid={range.boundary ? 'literature-bounds' : 'literature-range'}
                >
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
