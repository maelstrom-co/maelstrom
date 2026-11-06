import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 4310,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4311' },
  },
  build: { outDir: 'dist/client', emptyOutDir: true },
});
