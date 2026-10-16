import { useState } from 'react';
import StepsHeader, { type Step } from './components/StepsHeader';
import AddReferences from './steps/AddReferences';
import AssociateFullText from './steps/AssociateFullText';
import UnderConstruction from './steps/UnderConstruction';
import { useArticlesRepository } from './context/ArticlesRepository';

export default function App() {
    const { articles } = useArticlesRepository();
    const [current, setCurrent] = useState(0);
    const hasArticles = articles.length > 0;

    const steps: Step[] = [
        { title: 'Adicionar referências', enabled: true },
        { title: 'Associar texto completo', enabled: hasArticles },
        { title: 'Em construção', enabled: hasArticles },
    ];
    // Falls back to the first step when references are cleared
    const active = steps[current]?.enabled ? current : 0;

    return (
        <>
            <StepsHeader steps={steps} current={active} onSelect={setCurrent} />
            <main>
                {active === 0 && <AddReferences onNext={() => setCurrent(1)} />}
                {active === 1 && <AssociateFullText />}
                {active === 2 && <UnderConstruction />}
            </main>
        </>
    );
}
