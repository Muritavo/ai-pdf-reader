import { useRef, useState } from 'react';
import FileInput from '@onepercentio/one-ui/components/FileInput';
import Button from '@onepercentio/one-ui/components/Button';
import Text from '@onepercentio/one-ui/components/Text';
import { useArticlesRepository } from '../context/ArticlesRepository';
import { parseArticlesCsv } from '../utils/parseArticlesCsv';
import ManualReference, { isManualReference } from '../features/ManualReference';
import { TestIds } from '../testids';
import Styles from './Steps.module.css';

export default function AddReferences({ onNext }: { onNext: () => void }) {
    const { articles, setArticles, clear } = useArticlesRepository();
    const [file, setFile] = useState<File>();
    const [error, setError] = useState<string>();
    // FileInput keeps the first onFile it gets, so the current references are read from here
    const articlesRef = useRef(articles);
    articlesRef.current = articles;

    const onFile = async (f: File | undefined) => {
        setError(undefined);
        setFile(f);
        if (!f) return;
        try {
            const parsed = await parseArticlesCsv(f);
            if (!parsed.length) throw new Error('Nenhuma referência encontrada no arquivo.');
            // The CSV replaces the references of another CSV, keeping the ones typed by hand
            setArticles([...parsed, ...articlesRef.current.filter(article => isManualReference(article))]);
        } catch (e) {
            setFile(undefined);
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <section className={Styles.step}>
            <Text type="subtitle">Adicionar referências</Text>
            <Text type="description">
                Envie o CSV exportado da sua triagem (ex.: Rayyan) com as colunas <code>key</code> e{' '}
                <code>title</code>. Ano, periódico, autores e DOI são lidos quando presentes.
            </Text>

            <FileInput
                accept=".csv,text/csv"
                data-testid={TestIds.references.fileInput}
                file={file}
                onFile={onFile}
                footer="Formato aceito: .csv"
                states={{
                    waitingFile: {
                        title: 'Selecione o arquivo CSV de referências',
                        button: 'Escolher arquivo',
                    },
                    fileProvided: {
                        title: file ? `${file.name} — ${articles.length} referências` : '',
                        button: 'Remover arquivo',
                    },
                }}
            />

            <div className={Styles.manualEntry}>
                <Text type="caption">ou</Text>
                <ManualReference />
            </div>

            {error && (
                <Text type="caption" className={Styles.error} role="alert" data-testid={TestIds.references.error}>
                    {error}
                </Text>
            )}

            {articles.length > 0 && (
                <div className={Styles.actions}>
                    <Text type="caption" data-testid={TestIds.references.loadedCount}>
                        {articles.length} referências carregadas.
                    </Text>
                    <Button
                        variant="outline"
                        data-testid={TestIds.references.clear}
                        onClick={() => {
                            setFile(undefined);
                            clear();
                        }}
                    >
                        Limpar
                    </Button>
                    <Button variant="primary" onClick={onNext} data-testid={TestIds.references.next}>
                        Associar texto completo →
                    </Button>
                </div>
            )}
        </section>
    );
}
