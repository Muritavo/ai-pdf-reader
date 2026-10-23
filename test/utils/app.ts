import { expect, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { TestIds } from '../../src/testids';
import type { UploadableFile } from './pdf';

export const ARTICLES_FIXTURE = fileURLToPath(new URL('../fixtures/articles.csv', import.meta.url));
export const ARTICLES_FIXTURE_SIZE = 51;

export const byId = (page: Page, id: string) => page.getByTestId(id);

/** The project the specs work in, created on the chooser the app starts at */
export const TEST_PROJECT = 'Projeto de teste';

export async function openApp(page: Page) {
    await page.goto('/');
    await createProject(page, TEST_PROJECT);
}

export async function createProject(page: Page, name: string) {
    await byId(page, TestIds.projects.nameInput).fill(name);
    await byId(page, TestIds.projects.create).click();
    await expect(byId(page, TestIds.steps.step).first()).toBeVisible();
}


/** The step buttons on the header, in order */
export const stepButtons = (page: Page) => byId(page, TestIds.steps.step);

export async function uploadReferences(page: Page, file: string | UploadableFile) {
    await byId(page, TestIds.references.fileInput).setInputFiles(file);
}

export async function goToFullTexts(page: Page) {
    await stepButtons(page).nth(1).click();
    await expect(byId(page, TestIds.fullTexts.list)).toBeVisible();
}

export const articleCards = (page: Page) => byId(page, TestIds.fullTexts.articleCard);
export const articleCard = (page: Page, title: string) => articleCards(page).filter({ hasText: title });

export async function attachPdf(card: Locator, file: string | UploadableFile) {
    await card.getByTestId(TestIds.fullTexts.articleFileInput).setInputFiles(file);
}

/** Attaches a valid PDF and waits for the article to settle with it, since the list reorders itself afterwards */
export async function attachValidPdf(card: Locator, file: UploadableFile) {
    await attachPdf(card, file);
    await expect(card).toHaveAttribute('data-state', 'with-pdf');
    await expect(card).toContainText(file.name);
}

/** Fills the context the manual way: uploads the references and goes to the full texts step */
export async function startWithReferences(page: Page, file: string | UploadableFile) {
    await openApp(page);
    await uploadReferences(page, file);
    await expect(byId(page, TestIds.references.loadedCount)).toBeVisible();
    await goToFullTexts(page);
}

/** Opens the preview of an article that already has its PDF, and waits for it to be rendered */
export async function openPreview(page: Page, card: Locator, pages: number) {
    await expect(card).toHaveAttribute('data-state', 'with-pdf');
    // The list animates the articles that change, ignoring clicks until it settles
    await expect(card).toHaveCSS('pointer-events', 'auto');
    await page.waitForTimeout(700);
    await card.click();
    await expect(byId(page, TestIds.preview.canvas)).toHaveCount(pages);
    await waitForTextLayers(page, pages);
}

export async function waitForTextLayers(page: Page, pages: number) {
    await page.waitForFunction(
        ({ layer, expected }) => {
            const layers = [...document.querySelectorAll(`[data-testid="${layer}"]`)];
            return layers.length === expected && layers.every(l => l.querySelector('span'));
        },
        { layer: TestIds.preview.textLayer, expected: pages },
    );
}
