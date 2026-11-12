import { useEffect, useState, type MouseEvent } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { atlasUrl, imageUrl, MAX_DOWNSAMPLE, type StructureOnSection } from '../allen';
import ZoomViewer, { type View } from './ZoomViewer';
import OutlineOverlay from './OutlineOverlay';
import Styles from '../Anatomy3D.module.css';

type Area = { left: number; top: number; width: number; height: number };

/** About the width of the window, so the image is not reduced again by the browser */
const VIEW_WIDTH = 1600;
/** Room around the structure, so where it is can be seen */
const MARGIN = 0.3;
/** How much closer the full screen opens than the region, as a power of 2 */
const ZOOM_IN = 2;

/** Inside the section, as Allen answers with an error for a part out of it */
function clamp(area: Area, section: StructureOnSection): Area {
    const width = Math.min(area.width, section.width);
    const height = Math.min(area.height, section.height);
    return {
        left: Math.max(0, Math.min(area.left, section.width - width)),
        top: Math.max(0, Math.min(area.top, section.height - height)),
        width,
        height,
    };
}

function regionOf(section: StructureOnSection): Area {
    const { left, top, right, bottom } = section.box;
    const width = (right - left) * (1 + 2 * MARGIN);
    const height = (bottom - top) * (1 + 2 * MARGIN);
    return clamp({ left: left - (right - left) * MARGIN, top: top - (bottom - top) * MARGIN, width, height }, section);
}

/** The reduction (as a power of 2) that brings the part to about the width of the window */
const downsampleOf = (area: Area) =>
    Math.max(0, Math.min(MAX_DOWNSAMPLE, Math.ceil(Math.log2(Math.max(area.width, area.height) / VIEW_WIDTH))));

/** The region of the structure, with its outline over it. A click opens the section in full screen, centered there */
function RegionImage({ section, loading, onLoaded, onOpen }: {
    section: StructureOnSection;
    loading: boolean;
    onLoaded: () => void;
    onOpen: (view: View) => void;
}) {
    const area = regionOf(section);
    const level = downsampleOf(area);
    const src = imageUrl(section.image, level, area);

    const open = (e: MouseEvent<HTMLDivElement>) => {
        if (loading) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onOpen({
            x: area.left + ((e.clientX - rect.left) / rect.width) * area.width,
            y: area.top + ((e.clientY - rect.top) / rect.height) * area.height,
            level: Math.max(0, level - ZOOM_IN),
        });
    };

    return (
        <div className={`${Styles.image} ${Styles.pickable}`} onClick={open} data-testid="anatomy-section-image">
            <img src={src} alt="" onLoad={onLoaded} onError={onLoaded} />
            <OutlineOverlay outlines={section.outlines} area={area} stretch />
            {loading && (
                <span className={Styles.loading} data-testid="anatomy-section-loading">
                    <LoaderCircle size={24} className={Styles.spinner} />
                </span>
            )}
        </div>
    );
}

/** The sections where the structure is outlined, one at a time, from the one where it is largest */
export default function SectionViewer({ name, sections }: { name: string; sections: StructureOnSection[] }) {
    const [index, setIndex] = useState(0);
    // Until the image of the section is loaded, the arrows wait for it, so the sections are seen one by one
    const [loading, setLoading] = useState(true);
    const [zoom, setZoom] = useState<View>();
    const section = sections[index];

    useEffect(() => {
        setIndex(0);
        setLoading(true);
    }, [sections]);

    const canGo = (step: number) => !loading && index + step >= 0 && index + step < sections.length;
    const go = (step: number) => {
        if (!canGo(step)) return;
        setIndex(index + step);
        setLoading(true);
    };

    // Not while the full screen is open, as it shows a single section
    useEffect(() => {
        if (zoom) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable="true"]')) return;
            e.preventDefault();
            go(e.key === 'ArrowLeft' ? -1 : 1);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    });

    return (
        <div className={Styles.viewer}>
            <div className={Styles.toolbar}>
                <button type="button" className={Styles.iconButton} onClick={() => go(-1)} disabled={!canGo(-1)} aria-label="Seção anterior">
                    <ChevronLeft size={16} />
                </button>
                <span>
                    Seção {section.number} ({index + 1} de {sections.length})
                </span>
                <button type="button" className={Styles.iconButton} onClick={() => go(1)} disabled={!canGo(1)} aria-label="Próxima seção">
                    <ChevronRight size={16} />
                </button>
                <a href={atlasUrl(section.image)} target="_blank" rel="noreferrer" className={Styles.atlasLink}>
                    Abrir no Allen Brain Atlas
                </a>
            </div>
            <RegionImage section={section} loading={loading} onLoaded={() => setLoading(false)} onOpen={setZoom} />
            <p className={Styles.caption}>Clique na imagem para ampliar. Segure H para esconder o contorno e Alt para ver o nome de cada parte. Nissl, cérebro adulto (34 anos), Allen Human Reference Atlas.</p>
            {zoom && <ZoomViewer name={name} section={section} initial={zoom} onClose={() => setZoom(undefined)} />}
        </div>
    );
}
