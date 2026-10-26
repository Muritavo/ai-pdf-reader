import { useLayoutEffect, useRef, useState } from 'react';
import { TestIds } from '../testids';
import AIStatus from '../features/AIStatus';
import DataTransfer from '../features/DataTransfer';
import { SwitchProjects } from '../features/Projects';
import Styles from './StepsHeader.module.css';

export type Step = {
    title: string;
    /** When false the step can't be navigated to yet */
    enabled: boolean;
};

export default function StepsHeader({
    steps,
    current,
    onSelect,
}: {
    steps: Step[];
    current: number;
    onSelect: (index: number) => void;
}) {
    const headerRef = useRef<HTMLElement>(null);
    const [height, setHeight] = useState(0);
    // Sticky at minus its own height, so it scrolls away and leaves the top to what sticks under it
    useLayoutEffect(() => {
        const header = headerRef.current!;
        setHeight(header.clientHeight);
        const observer = new ResizeObserver(() => setHeight(header.clientHeight));
        observer.observe(header);
        return () => observer.disconnect();
    }, []);

    return (
        <header ref={headerRef} className={Styles.header} style={{ top: -height }}>
            <div className={Styles.start}>
                <SwitchProjects />
            </div>
            <nav>
                <ol className={Styles.steps}>
                    {steps.map((step, i) => (
                        <li key={step.title}>
                            <button
                                type="button"
                                data-testid={TestIds.steps.step}
                                className={`${Styles.step} ${i === current ? Styles.active : ''} ${i < current ? Styles.done : ''}`}
                                disabled={!step.enabled}
                                aria-current={i === current ? 'step' : undefined}
                                onClick={() => onSelect(i)}
                            >
                                <span className={Styles.index}>{i + 1}</span>
                                <span>{step.title}</span>
                            </button>
                        </li>
                    ))}
                </ol>
            </nav>
            <div className={Styles.aside}>
                <DataTransfer />
                <AIStatus />
            </div>
        </header>
    );
}
