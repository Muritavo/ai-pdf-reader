import { test as base } from '@playwright/test';
import { MockAI } from './mock-ai';

export const test = base.extend<{ ai: MockAI }>({
    /**
     * The mocked AI server, online and with a model loaded. Specs change it to simulate other situations.
     * It is automatic, so even the specs that never use it start with the AI online.
     */
    ai: [
        async ({}, use) => {
            const ai = new MockAI();
            await ai.start();
            await use(ai);
            await ai.stop();
        },
        { auto: true },
    ],
    // Every spec starts from an empty context (fresh storage), and never reaches the real Google
    context: async ({ context }, use) => {
        await context.route('https://www.google.com/**', route =>
            route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Mocked search</title>' }),
        );
        await use(context);
    },
});

export { expect } from '@playwright/test';
