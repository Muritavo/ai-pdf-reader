import { createElement } from 'react';
import type { Plugin } from '../types';
import { findTerm, loadUberon, termOf } from './src/uberon';
import { loadSections } from './src/allen';
import AnatomyView from './src/components/AnatomyView';

/**
 * The structures of the brain, on the terms of Uberon, shown on the sections of the Allen Human Reference Atlas,
 * from the region around them down to their cells
 */
const Anatomy3DPlugin: Plugin = {
    id: 'anatomy3d',
    async setup(env) {
        await Promise.all([loadUberon(env.storage.optimization), loadSections(env.storage.optimization)]);
    },
    menuOptions: [
        {
            id: 'anatomy3d-view',
            label: 'Verificar na anatomia',
            testId: 'menu-plugin-anatomy3d',
            matches: selection => !!findTerm(selection),
            async onClick({ selection, showResult }) {
                const term = termOf(findTerm(selection)!)!;
                showResult({
                    title: 'Anatomia',
                    prompt: selection,
                    promptLabel: 'Seleção',
                    answerLabel: 'Uberon',
                    answer: `**${term.name}** (${term.id})`,
                    view: createElement(AnatomyView, { initial: term.id }),
                });
            },
        },
    ],
};

export default Anatomy3DPlugin;
