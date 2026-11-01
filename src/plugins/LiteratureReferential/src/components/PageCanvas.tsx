import { useEffect, useRef } from 'react';
import type { PdfDocument } from '../pdf';

/** A page of the PDF drawn to fit the height or the width given, sharp on every screen */
export default function PageCanvas({ pdf, pageNo, height, width }: { pdf: PdfDocument; pageNo: number; height?: number; width?: number }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        let cancelled = false;
        let task: ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']> | undefined;
        pdf.getPage(pageNo).then(page => {
            const canvas = canvasRef.current;
            if (cancelled || !canvas) return;
            const natural = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: height ? height / natural.height : (width ?? natural.width) / natural.width });
            const pixelRatio = window.devicePixelRatio || 1;
            canvas.width = Math.floor(viewport.width * pixelRatio);
            canvas.height = Math.floor(viewport.height * pixelRatio);
            canvas.style.width = `${Math.floor(viewport.width)}px`;
            canvas.style.height = `${Math.floor(viewport.height)}px`;
            task = page.render({
                canvas,
                canvasContext: canvas.getContext('2d')!,
                viewport,
                transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : undefined,
            });
            // Cancelled when the page leaves the screen before it is drawn
            task.promise.catch(() => {});
        });
        return () => {
            cancelled = true;
            task?.cancel();
        };
    }, [pdf, pageNo, height, width]);

    return <canvas ref={canvasRef} />;
}
