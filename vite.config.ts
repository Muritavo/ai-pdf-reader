import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

// local mkcert certificate (see .cert/); falls back to plain http when absent
const certDir = fileURLToPath(new URL('./.cert/', import.meta.url));
const https = fs.existsSync(`${certDir}cert.pem`)
  ? { key: fs.readFileSync(`${certDir}key.pem`), cert: fs.readFileSync(`${certDir}cert.pem`) }
  : undefined;

export default defineConfig({
  plugins: [react()],
  server: { https },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // one-ui ships this component without the index.js its exports point to
      '@onepercentio/one-ui/components/ScrollendIndicator': fileURLToPath(
        new URL('./node_modules/@onepercentio/one-ui/dist-ts/components/ScrollendIndicator/ScrollendIndicator.js', import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    include: ['@onepercentio/one-ui/components/AdaptiveContainer', '@onepercentio/one-ui/components/AdaptiveDialog'],
  },
});
