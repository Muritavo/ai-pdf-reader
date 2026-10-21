import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
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
