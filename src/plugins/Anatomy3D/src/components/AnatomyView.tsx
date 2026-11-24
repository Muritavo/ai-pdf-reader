import { useEffect, useState } from 'react';
import { sectionsOf, type StructureOnSection } from '../allen';
import { childrenOf, lineageOf, termOf, urlOf, type Term } from '../uberon';
import SectionViewer from './SectionViewer';
import Styles from '../Anatomy3D.module.css';

function TreeItem({ term, depth, current, onSelect }: { term: Term; depth: number; current: boolean; onSelect: (id: string) => void }) {
    return (
        <li>
            <button
                type="button"
                className={current ? `${Styles.treeItem} ${Styles.current}` : Styles.treeItem}
                style={{ paddingLeft: 8 + depth * 10 }}
                title={term.id}
                onClick={() => onSelect(term.id)}
            >
                {term.name}
            </button>
        </li>
    );
}

/** From the most general term down to this one, and its parts, as on the hierarchy of Uberon */
function Hierarchy({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
    const lineage = lineageOf(id);
    return (
        <ul className={Styles.tree} data-testid="anatomy-hierarchy">
            {lineage.map((term, depth) => (
                <TreeItem key={term.id} term={term} depth={depth} current={term.id === id} onSelect={onSelect} />
            ))}
            {childrenOf(id).map(term => (
                <TreeItem key={term.id} term={term} depth={lineage.length} current={false} onSelect={onSelect} />
            ))}
        </ul>
    );
}

/** The sections of the Allen atlas where the term is outlined */
function Sections({ term }: { term: Term }) {
    const [sections, setSections] = useState<StructureOnSection[]>();
    const [error, setError] = useState<string>();

    useEffect(() => {
        setSections(undefined);
        setError(undefined);
        if (term.dhba) sectionsOf(term.dhba).then(setSections, e => setError(e instanceof Error ? e.message : String(e)));
    }, [term]);

    if (!term.dhba) return <p className={Styles.notice}>Sem estrutura correspondente no atlas Allen do cérebro humano.</p>;
    if (error) return <p className={Styles.notice}>Não foi possível consultar o atlas Allen: {error}</p>;
    if (!sections) return <p className={Styles.notice}>Procurando as seções do atlas Allen…</p>;
    if (!sections.length) return <p className={Styles.notice}>A estrutura não está delineada nas seções do atlas Allen.</p>;
    return <SectionViewer name={term.name} sections={sections} />;
}

/** The hierarchy on the left, and the term with the sections of the brain where it is */
export default function AnatomyView({ initial }: { initial: string }) {
    const [id, setId] = useState(initial);
    const term = termOf(id)!;

    return (
        <div className={Styles.view} data-testid="anatomy-view">
            <Hierarchy id={id} onSelect={setId} />
            <div className={Styles.detail}>
                <div className={Styles.title}>
                    <strong>{term.name}</strong>
                    <a className={Styles.id} href={urlOf(term.id)} target="_blank" rel="noreferrer">
                        {term.id}
                    </a>
                </div>
                {term.definition && <p className={Styles.definition}>{term.definition}</p>}
                <Sections term={term} />
            </div>
        </div>
    );
}
