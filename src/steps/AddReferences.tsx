import { useState } from 'react';
import FileInput from '@onepercentio/one-ui/components/FileInput';
import Button from '@onepercentio/one-ui/components/Button';
import Text from '@onepercentio/one-ui/components/Text';
import { useArticlesRepository } from '../context/ArticlesRepository';
import { parseArticlesCsv } from '../utils/parseArticlesCsv';
import Styles from './Steps.module.css';

export default function AddReferences({ onNext }: { onNext: () => void }) {
    const { articles, setArticles, clear } = useArticlesRepository();
    const [file, setFile] = useState<File>();
    const [error, setError] = useState<string>();

    const onFile = async (f: File | undefined) => {
        setError(undefined);
        setFile(f);
        if (!f) return;
        try {
            const parsed = await parseArticlesCsv(f);
            if (!parsed.length) throw new Error('Nenhuma referência encontrada no arquivo.');
            setArticles(parsed);
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

            {error && (
                <Text type="caption" className={Styles.error} role="alert">
                    {error}
                </Text>
            )}

            {articles.length > 0 && (
                <div className={Styles.actions}>
                    <Text type="caption">{articles.length} referências carregadas.</Text>
                    <Button
                        variant="outline"
                        onClick={() => {
                            setFile(undefined);
                            clear();
                        }}
                    >
                        Limpar
                    </Button>
                    <Button variant="primary" onClick={onNext}>
                        Associar texto completo →
                    </Button>
                </div>
            )}
        </section>
    );
}
