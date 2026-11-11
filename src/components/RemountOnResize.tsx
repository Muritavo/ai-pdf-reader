import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';

/** How long the width must hold still before remounting, as remounting is expensive */
const SETTLE_MS = 300;

/**
 * Remounts its children when the width of the window they are in changes (as the page being zoomed, or an AR window
 * resized), for content laid out once at the width it had, as the pages of a PDF
 */
export default function RemountOnResize({ children }: { children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const [generation, setGeneration] = useState(0);

    useEffect(() => {
        // The window it is in, which on AR is the dialog's own rather than the page's
        const view = ref.current?.ownerDocument.defaultView;
        if (!view) return;
        let width = view.innerWidth;
        let timer: number | undefined;
        const onResize = () => {
            view.clearTimeout(timer);
            timer = view.setTimeout(() => {
                if (view.innerWidth === width) return;
                width = view.innerWidth;
                setGeneration(current => current + 1);
            }, SETTLE_MS);
        };
        view.addEventListener('resize', onResize);
        return () => {
            view.removeEventListener('resize', onResize);
            view.clearTimeout(timer);
        };
    }, []);

    return (
        // Without a box of its own, so it doesn't change the layout
        <div ref={ref} style={{ display: 'contents' }}>
            <Fragment key={generation}>{children}</Fragment>
        </div>
    );
}
