import { Fragment, useMemo, useRef, useState } from 'react';
import Text from '@onepercentio/one-ui/components/Text';
import { RotateCcw } from 'lucide-react';
import Button from '@onepercentio/one-ui/components/Button';
import AdaptiveDialog from '@onepercentio/one-ui/components/AdaptiveDialog';
import AdaptiveContainer from '@onepercentio/one-ui/components/AdaptiveContainer';
import { useArticlesRepository } from '../context/ArticlesRepository';
import type { Article, FullText } from '../models/Article';
import DocumentPreview from '../features/DocumentPreview';
import ManualReference from '../features/ManualReference';
import ArticleTags from '../features/ArticleTags';
import { isReadToTheEnd, resetReadingProgress, useLastOpening, useReadingProgress } from '../utils/readingProgress';
import useShortcut from '../hooks/useShortcut';
import { TestIds } from '../testids';
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
    onAttach: (file: File) => Promise<unknown>;
    onDetach: () => void;
    onOpen: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    const [attachError, setAttachError] = useState<string>();
    const readProgress = useReadingProgress(fullText?.hash);
    const readToTheEnd = isReadToTheEnd(readProgress);
    const lastOpening = useLastOpening(fullText?.hash);
    const attach = async (file: File) => {
        setAttachError(undefined);
        try {
            await onAttach(file);
        } catch {
            setAttachError('Arquivo inválido: envie um PDF válido.');
        }
    };
    const meta = [article.year, article.journal].filter(Boolean).join(' · ');

    return (
        <div className={Styles.articleSlot}>
            <div
                data-testid={TestIds.fullTexts.articleCard}
                data-state={fullText ? 'with-pdf' : 'missing-pdf'}
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
                    if (file) attach(file);
                }}
            >
                <div className={Styles.articleInfo}>
                    <Text type="description" className={Styles.articleTitle}>
                        {article.title}
                    </Text>
                    <ArticleTags articleKey={article.key} />
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
                    {fullText && (readProgress > 0 || lastOpening !== undefined) && (
                        <>
                            <div className={Styles.readLine} data-testid={TestIds.fullTexts.readLine}>
                                {/* First, so it stays at the same place whatever the texts after it say */}
                                <button
                                    type="button"
                                    className={Styles.readReset}
                                    data-testid={TestIds.fullTexts.readReset}
                                    title="Zerar leitura"
                                    aria-label="Zerar leitura"
                                    onClick={e => {
                                        // Resetting does not open the document
                                        e.stopPropagation();
                                        resetReadingProgress(fullText.hash);
                                    }}
                                >
                                    <RotateCcw size={13} strokeWidth={2} />
                                </button>
                                {lastOpening !== undefined && (
                                    <Text
                                        type="caption"
                                        className={Styles.lastOpening}
                                        data-testid={TestIds.fullTexts.lastOpening}
                                        data-progress={Math.round(lastOpening * 100)}
                                    >
                                        {Math.round(lastOpening * 100)}% na última abertura
                                    </Text>
                                )}
                                {lastOpening !== undefined && readProgress > 0 && (
                                    <Text type="caption" className={Styles.readSeparator} aria-hidden>
                                        /
                                    </Text>
                                )}
                                {readProgress > 0 && (
                                    <Text
                                        type="caption"
                                        className={`${Styles.readProgress} ${readToTheEnd ? Styles.readComplete : ''}`}
                                        data-testid={TestIds.fullTexts.readProgress}
                                        data-complete={readToTheEnd}
                                        data-progress={Math.round(readProgress * 100)}
                                    >
                                        {readToTheEnd ? '✓ Lido até o fim' : `${Math.round(readProgress * 100)}% lido`}
                                    </Text>
                                )}
                            </div>
                            {/* The furthest point, with where the reader stopped the last time drawn over it */}
                            <div className={Styles.readBar} data-testid={TestIds.fullTexts.readBar} aria-hidden>
                                <div
                                    className={`${Styles.readBarFill} ${readToTheEnd ? Styles.readBarComplete : ''}`}
                                    data-testid={TestIds.fullTexts.readBarProgress}
                                    style={{ width: `${readProgress * 100}%` }}
                                />
                                {lastOpening !== undefined && (
                                    <div
                                        className={Styles.lastOpeningFill}
                                        data-testid={TestIds.fullTexts.readBarLastOpening}
                                        style={{ width: `${lastOpening * 100}%` }}
                                    />
                                )}
                            </div>
                        </>
                    )}
                    {attachError && (
                        <Text type="caption" className={Styles.error} role="alert" data-testid={TestIds.fullTexts.articleError}>
                            {attachError}
                        </Text>
                    )}
                </div>
                <div className={Styles.articleActions} onClick={e => e.stopPropagation()}>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="application/pdf"
                        data-testid={TestIds.fullTexts.articleFileInput}
                        hidden
                        onChange={e => {
                            const file = e.target.files?.item(0);
                            if (file) attach(file);
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
    const searchRef = useRef<HTMLInputElement>(null);
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
    const pendingVisible = pending.filter(a => visibleKeys.has(a.key)).length;
    const associated = articles.filter(a => fullTexts[a.key]).length;
    // Takes over the search of the browser, but not while a document is open over the list
    useShortcut(
        previewOpen
            ? null
            : () => {
                  searchRef.current?.focus();
                  searchRef.current?.select();
              },
        'mod',
        'f',
    );

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
                ref={searchRef}
                type="search"
                className={Styles.search}
                placeholder="Buscar por título"
                aria-label="Buscar por título"
                data-testid={TestIds.fullTexts.search}
                value={query}
                onChange={e => setQuery(e.target.value)}
            />
            <Text type="subtitle">Associar texto completo</Text>
            <Text type="description">
                Envie ou arraste o PDF de cada artigo. Itens tracejados ainda não possuem texto completo.
            </Text>
            <div className={Styles.actions}>
                <Text type="caption" data-testid={TestIds.fullTexts.progressCount}>
                    {associated} de {articles.length} artigos com PDF
                    {query.trim() && ` · ${visible.length} encontrados`}
                </Text>
                {/* For the articles that were not on the CSV of the screening */}
                <ManualReference variant="transparent" />
            </div>
            <progress className={Styles.progress} max={articles.length || 1} value={associated} />

            <ul className={Styles.articleList} data-testid={TestIds.fullTexts.list}>
                {visible.length === 0 && <Text type="description">Nenhum artigo encontrado.</Text>}
                {uploaded.map(renderItem)}
                {uploadedVisible > 0 && pendingVisible > 0 && (
                    <li role="separator" className={Styles.divider} data-testid={TestIds.fullTexts.pendingDivider}>
                        <Text type="caption">Sem texto completo · {pendingVisible}</Text>
                    </li>
                )}
                {pending.map(renderItem)}
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
