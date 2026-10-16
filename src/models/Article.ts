/** A reference imported from the CSV export (e.g. Rayyan) */
export type Article = {
    key: string;
    title: string;
    year: string;
    journal: string;
    authors: string;
    doi: string;
    abstract: string;
};

/** Metadata of a full-text PDF associated to an article */
export type FullText = {
    articleKey: string;
    hash: string;
    name: string;
    size: number;
    createdAt: Date;
    url: string;
};
