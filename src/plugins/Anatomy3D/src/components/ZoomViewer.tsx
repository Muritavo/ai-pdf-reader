import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import AdaptiveDialog from '@onepercentio/one-ui/components/AdaptiveDialog';
import { Minus, Plus } from 'lucide-react';
import { imageUrl, MAX_DOWNSAMPLE, MICRONS_PER_PIXEL, type StructureOnSection } from '../allen';
import OutlineOverlay, { OutlinePaths } from './OutlineOverlay';
import Styles from '../Anatomy3D.module.css';

/** Where the view is centered, on the pixels of the whole section, and how much it is reduced (as a power of 2) */
export type View = { x: number; y: number; level: number };
type Area = { left: number; top: number; width: number; height: number };
type Tile = { src: string; area: Area };

/** Only asked for once the view stops changing, as dragging would ask for an image on every move */
const REQUEST_DELAY = 200;
const MINIMAP_SIZE = 180;
const LEVELS = Array.from({ length: MAX_DOWNSAMPLE + 1 }, (_, level) => level);

/** "1 µm/px", "124 µm/px" */
const resolutionOf = (level: number) => `${Math.round(MICRONS_PER_PIXEL * 2 ** level)} µm/px`;

function visibleArea(view: View, size: { width: number; height: number }): Area {
    const scale = 2 ** view.level;
    return { left: view.x - (size.width * scale) / 2, top: view.y - (size.height * scale) / 2, width: size.width * scale, height: size.height * scale };
}

/** The part of the view that is on the section, as Allen answers with an error for a part out of it */
function tileOf(section: StructureOnSection, view: View, size: { width: number; height: number }): Tile | undefined {
    const visible = visibleArea(view, size);
    const left = Math.max(0, visible.left);
    const top = Math.max(0, visible.top);
    const right = Math.min(section.width, visible.left + visible.width);
    const bottom = Math.min(section.height, visible.top + visible.height);
    if (right <= left || bottom <= top) return undefined;
    const area = { left, top, width: right - left, height: bottom - top };
    return { src: imageUrl(section.image, view.level, area), area };
}

/** The whole section, with where the view is. A click centers the view there */
function Minimap({ section, visible, onCenter }: { section: StructureOnSection; visible: Area; onCenter: (x: number, y: number) => void }) {
    const ratio = section.width / section.height;
    const style = ratio > 1 ? { width: MINIMAP_SIZE, height: MINIMAP_SIZE / ratio } : { width: MINIMAP_SIZE * ratio, height: MINIMAP_SIZE };
    const center = (e: MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onCenter(((e.clientX - rect.left) / rect.width) * section.width, ((e.clientY - rect.top) / rect.height) * section.height);
    };
    return (
        <svg className={Styles.minimap} style={style} viewBox={`0 0 ${section.width} ${section.height}`} onClick={center} data-testid="anatomy-minimap">
            <image href={imageUrl(section.image, MAX_DOWNSAMPLE)} width={section.width} height={section.height} />
            <OutlinePaths outlines={section.outlines} />
            <rect className={Styles.minimapView} {...{ x: visible.left, y: visible.top, width: visible.width, height: visible.height }} vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

/** The levels of zoom, from the cells (top) to the whole section (bottom) */
function ZoomScale({ level, onLevel }: { level: number; onLevel: (level: number) => void }) {
    return (
        <div className={Styles.zoomScale} data-testid="anatomy-zoom-scale">
            <button type="button" className={Styles.iconButton} onClick={() => onLevel(level - 1)} disabled={level === 0} aria-label="Aproximar">
                <Plus size={16} />
            </button>
            <ol>
                {LEVELS.map(l => (
                    <li key={l}>
                        <button type="button" className={l === level ? `${Styles.zoomLevel} ${Styles.current}` : Styles.zoomLevel} onClick={() => onLevel(l)}>
                            {resolutionOf(l)}
                        </button>
                    </li>
                ))}
            </ol>
            <button type="button" className={Styles.iconButton} onClick={() => onLevel(level + 1)} disabled={level === MAX_DOWNSAMPLE} aria-label="Afastar">
                <Minus size={16} />
            </button>
        </div>
    );
}

/** The section in full screen: dragged to move, zoomed only by the levels of the scale */
export default function ZoomViewer({ name, section, initial, onClose }: { name: string; section: StructureOnSection; initial: View; onClose: () => void }) {
    const [open, setOpen] = useState(true);
    const [view, setView] = useState(initial);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [shown, setShown] = useState<Tile>();
    const [loading, setLoading] = useState<Tile>();
    const viewportRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ x: number; y: number }>();

    useEffect(() => {
        const viewport = viewportRef.current!;
        const observer = new ResizeObserver(() => setSize({ width: viewport.clientWidth, height: viewport.clientHeight }));
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!size.width) return;
        const timer = setTimeout(() => {
            const tile = tileOf(section, view, size);
            if (tile && tile.src !== shown?.src) setLoading(tile);
        }, REQUEST_DELAY);
        return () => clearTimeout(timer);
        // The image being shown is only compared, not a reason to ask again
    }, [section, view, size]);

    const move = (x: number, y: number, level = view.level) =>
        setView({ x: Math.max(0, Math.min(section.width, x)), y: Math.max(0, Math.min(section.height, y)), level });
    const zoom = (level: number) => move(view.x, view.y, Math.max(0, Math.min(MAX_DOWNSAMPLE, level)));

    const scale = 2 ** view.level;
    const visible = visibleArea(view, size);
    /** Where a tile is on the view, as the view may have moved since it was asked for */
    const placementOf = ({ area }: Tile) => ({
        left: (area.left - visible.left) / scale,
        top: (area.top - visible.top) / scale,
        width: area.width / scale,
        height: area.height / scale,
    });

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        move(view.x - (e.clientX - drag.x) * scale, view.y - (e.clientY - drag.y) * scale);
        dragRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = () => {
        dragRef.current = undefined;
    };

    return (
        <AdaptiveDialog open={open} onClose={() => setOpen(false)} onClickOut={() => setOpen(false)} onClosed={onClose} className={Styles.fullscreen}>
            <div className={Styles.fullscreenContent} data-testid="anatomy-zoom-viewer">
                <div className={Styles.fullscreenHeader}>
                    <strong>{name}</strong>
                    <span className={Styles.id}>
                        Seção {section.number} · {resolutionOf(view.level)}
                    </span>
                </div>
                <div
                    ref={viewportRef}
                    className={Styles.viewport}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                >
                    {shown && <img src={shown.src} alt="" draggable={false} style={placementOf(shown)} />}
                    {loading && (
                        <img
                            key={loading.src}
                            src={loading.src}
                            alt=""
                            draggable={false}
                            className={Styles.pending}
                            style={placementOf(loading)}
                            onLoad={() => {
                                setShown(loading);
                                setLoading(undefined);
                            }}
                            onError={() => setLoading(undefined)}
                        />
                    )}
                    {/* The minimap keeps its outline while "h" is held, to show where the structure is */}
                    {size.width > 0 && <OutlineOverlay outlines={section.outlines} area={visible} />}
                    {loading && <span className={Styles.loadingBadge}>Carregando…</span>}
                    <div className={Styles.minimapBox} onPointerDown={e => e.stopPropagation()}>
                        <Minimap section={section} visible={visible} onCenter={(x, y) => move(x, y)} />
                    </div>
                    <div className={Styles.zoomScaleBox} onPointerDown={e => e.stopPropagation()}>
                        <ZoomScale level={view.level} onLevel={zoom} />
                    </div>
                </div>
            </div>
        </AdaptiveDialog>
    );
}
