import { Fragment, useMemo, useRef, useState } from 'react';
import Text from '@onepercentio/one-ui/components/Text';
import Button from '@onepercentio/one-ui/components/Button';
import AdaptiveDialog from '@onepercentio/one-ui/components/AdaptiveDialog';
import AdaptiveContainer from '@onepercentio/one-ui/components/AdaptiveContainer';
import { useArticlesRepository } from '../context/ArticlesRepository';
import type { Article, FullText } from '../models/Article';
import DocumentPreview from '../features/DocumentPreview';
import Styles from './Steps.module.css';

function ArticleItem({
    article,
    fullText,
    onAttach,
    onDetach,
    onOpen,
}: {
    article: Article;
    fullText?: FullText;
    onAttach: (file: File) => void;
    onDetach: () => void;
    onOpen: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    const meta = [article.year, article.journal].filter(Boolean).join(' · ');

    return (
        <div className={Styles.articleSlot}>
            <div
                className={`${Styles.article} ${fullText ? Styles.withPdf : Styles.missingPdf} ${dragging ? Styles.dragging : ''}`}
                onDragOver={e => {
                    e.preventDefault();
                    setDragging(true);
                }}
                onClick={fullText ? onOpen : undefined}
                onDragLeave={() => setDragging(false)}
                onDrop={e => {
                    e.preventDefault();
                    setDragging(false);
                    const file = e.dataTransfer.files.item(0);
                    if (file?.type === 'application/pdf') onAttach(file);
                }}
            >
                <div className={Styles.articleInfo}>
                    <Text type="description" className={Styles.articleTitle}>
                        {article.title}
                    </Text>
                    {meta && <Text type="caption">{meta}</Text>}
                    {fullText && (
                        <Text type="caption" className={Styles.pdfName}>
                            📄 {fullText.name}
                            {fullText.wordCount !== undefined && (
                                <span className={Styles.wordCount}>
                                    {' · '}
                                    {fullText.wordCount.toLocaleString('pt-BR')} palavras
                                </span>
                            )}
                        </Text>
                    )}
                </div>
                <div className={Styles.articleActions} onClick={e => e.stopPropagation()}>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="application/pdf"
                        hidden
                        onChange={e => {
                            const file = e.target.files?.item(0);
                            if (file) onAttach(file);
                            e.target.value = '';
                        }}
                    />
                    <Button variant={fullText ? 'transparent' : 'outline'} onClick={() => inputRef.current?.click()}>
                        {fullText ? 'Substituir' : 'Enviar PDF'}
                    </Button>
                    {fullText && (
                        <Button variant="transparent" onClick={onDetach}>
                            Remover
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export default function AssociateFullText() {
    const { articles, fullTexts, attachFullText, detachFullText } = useArticlesRepository();
    const [query, setQuery] = useState('');
    const [previewKey, setPreviewKey] = useState<string>();
    const [previewOpen, setPreviewOpen] = useState(false);
    const previewFullText = previewKey ? fullTexts[previewKey] : undefined;
    const visible = useMemo(() => {
        const q = normalize(query.trim());
        return q ? articles.filter(a => normalize(a.title).includes(q)) : articles;
    }, [articles, query]);
    const visibleKeys = useMemo(() => new Set(visible.map(a => a.key)), [visible]);
    const pending = articles.filter(a => !fullTexts[a.key]);
    const uploaded = articles.filter(a => fullTexts[a.key]);
    const uploadedVisible = uploaded.filter(a => visibleKeys.has(a.key)).length;
    const associated = articles.filter(a => fullTexts[a.key]).length;

    // Articles missed by the search render an empty Fragment so the container animates the "out" state
    const renderItem = (article: Article) => (
        <AdaptiveContainer key={article.key} containerElement="li" direction="v">
            {visibleKeys.has(article.key) ? (
                <ArticleItem
                    key={article.key}
                    article={article}
                    fullText={fullTexts[article.key]}
                    onAttach={file => attachFullText(article.key, file)}
                    onDetach={() => detachFullText(article.key)}
                    onOpen={() => {
                        setPreviewKey(article.key);
                        setPreviewOpen(true);
                    }}
                />
            ) : (
                <Fragment key={`${article.key}-hidden`} />
            )}
        </AdaptiveContainer>
    );

    return (
        <section className={Styles.step}>
            <input
                type="search"
                className={Styles.search}
                placeholder="Buscar por título"
                aria-label="Buscar por título"
                value={query}
                onChange={e => setQuery(e.target.value)}
            />
            <Text type="subtitle">Associar texto completo</Text>
            <Text type="description">
                Envie ou arraste o PDF de cada artigo. Itens tracejados ainda não possuem texto completo.
            </Text>
            <Text type="caption">
                {associated} de {articles.length} artigos com PDF
                {query.trim() && ` · ${visible.length} encontrados`}
            </Text>
            <progress className={Styles.progress} max={articles.length || 1} value={associated} />

            <ul className={Styles.articleList}>
                {visible.length === 0 && <Text type="description">Nenhum artigo encontrado.</Text>}
                {pending.map(renderItem)}
                {uploadedVisible > 0 && (
                    <li role="separator" className={Styles.divider}>
                        <Text type="caption">Com texto completo · {uploadedVisible}</Text>
                    </li>
                )}
                {uploaded.map(renderItem)}
            </ul>
            <AdaptiveDialog
                open={previewOpen && !!previewFullText}
                onClose={() => setPreviewOpen(false)}
                onClickOut={() => setPreviewOpen(false)}
                onClosed={() => setPreviewKey(undefined)}
            >
                {previewFullText && <DocumentPreview key={previewFullText.hash} fullText={previewFullText} />}
            </AdaptiveDialog>
        </section>
    );
}
