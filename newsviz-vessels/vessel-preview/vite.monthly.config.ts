import {defineConfig} from 'vite';
import path from 'node:path';

export default defineConfig({
  base: process.env.VITE_BASE || '/rank/newsviz-vessels-monthly/',
  publicDir: 'public-monthly',
  build: {
    outDir: 'dist-monthly',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'monthly.html'),
    },
  },
});
