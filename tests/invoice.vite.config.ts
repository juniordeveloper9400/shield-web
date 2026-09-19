import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['tests/invoice-browser.html'] },
  resolve: { alias: [
    { find: '@/lib/db', replacement: resolve('tests/invoiceDb.ts') },
    { find: '@', replacement: resolve('src') },
  ] },
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
});
