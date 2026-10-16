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
    return (
        <header className={Styles.header}>
            <nav>
                <ol className={Styles.steps}>
                    {steps.map((step, i) => (
                        <li key={step.title}>
                            <button
                                type="button"
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
        </header>
    );
}
