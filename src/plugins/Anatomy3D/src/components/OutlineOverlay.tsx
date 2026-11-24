import { useRef, useState, type PointerEvent } from 'react';
import { OUTLINE_SCALE, type Outline } from '../allen';
import useHeldKey from '../useHeldKey';
import Styles from '../Anatomy3D.module.css';

type Area = { left: number; top: number; width: number; height: number };

/** The paths of the outlines, on the pixels of the whole section */
export function OutlinePaths({ outlines }: { outlines: Outline[] }) {
    return (
        <g transform={`scale(${OUTLINE_SCALE})`}>
            {outlines.map((outline, i) => (
                <path key={i} d={outline.d} vectorEffect="non-scaling-stroke" />
            ))}
        </g>
    );
}

/**
 * The outlines over a part of the section (`area`). Hidden while "h" is held, to see the tissue under them,
 * and named while "alt" is held, for the one under the pointer. Placed on a parent that is positioned
 */
export default function OutlineOverlay({ outlines, area, stretch }: { outlines: Outline[]; area: Area; stretch?: boolean }) {
    const hidden = useHeldKey('h');
    const naming = useHeldKey('alt');
    const [hovered, setHovered] = useState<{ index: number; x: number; y: number }>();
    const svgRef = useRef<SVGSVGElement>(null);

    if (hidden) return null;

    const hover = (index: number) => (e: PointerEvent<SVGPathElement>) => {
        const rect = svgRef.current!.parentElement!.getBoundingClientRect();
        setHovered({ index, x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    const label = naming && hovered ? outlines[hovered.index] : undefined;

    return (
        <>
            <svg
                ref={svgRef}
                className={naming ? `${Styles.outline} ${Styles.naming}` : Styles.outline}
                viewBox={`${area.left} ${area.top} ${area.width} ${area.height}`}
                preserveAspectRatio={stretch ? 'none' : undefined}
                aria-hidden
            >
                <g transform={`scale(${OUTLINE_SCALE})`}>
                    {outlines.map((outline, i) => (
                        <path
                            key={i}
                            d={outline.d}
                            vectorEffect="non-scaling-stroke"
                            className={label && hovered?.index === i ? Styles.hovered : undefined}
                            onPointerEnter={hover(i)}
                            onPointerMove={hover(i)}
                            onPointerLeave={() => setHovered(current => (current?.index === i ? undefined : current))}
                        />
                    ))}
                </g>
            </svg>
            {label && (
                <span className={Styles.outlineLabel} style={{ left: hovered!.x + 14, top: hovered!.y + 14 }} data-testid="anatomy-outline-label">
                    {label.name} <span className={Styles.id}>{label.acronym}</span>
                </span>
            )}
        </>
    );
}
