import { defineConfig } from '@playwright/test';
import { MOCK_AI_PORT, TEST_PORT } from './test/utils/constants';

export default defineConfig({
    testDir: './test',
    testMatch: '**/*.spec.ts',
    // The mocked AI server uses a fixed port
    workers: 1,
    fullyParallel: false,
    timeout: 45_000,
    expect: { timeout: 10_000 },
    reporter: [['list']],
    use: {
        baseURL: `http://localhost:${TEST_PORT}`,
        // Uses the installed Chrome, so no browser download is needed
        channel: 'chrome',
        headless: true,
        trace: 'retain-on-failure',
    },
    webServer: {
        command: `npm run dev -- --port ${TEST_PORT} --strictPort`,
        url: `http://localhost:${TEST_PORT}`,
        env: { VITE_AI_ENDPOINT: `http://localhost:${MOCK_AI_PORT}` },
        reuseExistingServer: false,
        stdout: 'ignore',
        stderr: 'ignore',
        timeout: 60_000,
    },
});
