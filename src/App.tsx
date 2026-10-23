import { useState } from 'react';
import StepsHeader, { type Step } from './components/StepsHeader';
import AddReferences from './steps/AddReferences';
import AssociateFullText from './steps/AssociateFullText';
import UnderConstruction from './steps/UnderConstruction';
import { ArticlesRepositoryProvider, useArticlesRepository } from './context/ArticlesRepository';
import { AIProvider } from './context/AIContext';
import { useProjects } from './context/ProjectsContext';
import { ProjectChooser } from './features/Projects';

function Workspace() {
    const { articles } = useArticlesRepository();
    const hasArticles = articles.length > 0;
    // Articles are restored synchronously, so a returning user lands straight on step 2
    const [current, setCurrent] = useState(hasArticles ? 1 : 0);

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

export default function App() {
    const { current } = useProjects();
    if (!current) return <ProjectChooser />;
    // Keyed by the project, so everything starts again reading the data of the one opened
    return (
        <AIProvider key={current.id}>
            <ArticlesRepositoryProvider>
                <Workspace />
            </ArticlesRepositoryProvider>
        </AIProvider>
    );
}
