import { createElement } from 'react';
import type { Plugin, PluginEnv } from '../types';
import { loadLibrary, preloadedCount } from './src/library';
import { askBooks } from './src/query';
import MenuLabel from './src/components/MenuLabel';
import QueryResult from './src/components/QueryResult';
import Settings from './src/components/Settings';

/** Kept from the setup, for the actions of the menu */
let env: PluginEnv;

const LiteratureReferentialPlugin: Plugin = {
    id: 'literature-referential',
    name: 'LiteratureReferential',
    description:
        'Associa livros completos e indexa o sumário e o índice deles, para encontrar em que página de cada livro um conceito é discutido.',
    async setup(given) {
        env = given;
        await loadLibrary(env.storage);
    },
    Settings,
    menuOptions: [
        {
            id: 'literature-query',
            label: () => createElement(MenuLabel),
            testId: 'menu-plugin-literature',
            // Without a reference preloaded there is nothing to search
            matches: () => preloadedCount() > 0,
            async onClick({ selection, showResult }) {
                const matches = await askBooks(env, selection);
                showResult({
                    title: 'Literatura',
                    prompt: selection,
                    promptLabel: 'Conceito',
                    answerLabel: 'Referências',
                    answer: matches.map(({ book, page }) => `Este conceito é discutido em **${book.title}**, página ${page}`).join('\n\n'),
                    view: createElement(QueryResult, { storage: env.storage, matches, searched: preloadedCount() }),
                });
            },
        },
    ],
};

export default LiteratureReferentialPlugin;
