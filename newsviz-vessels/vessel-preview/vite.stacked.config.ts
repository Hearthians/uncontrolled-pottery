import {defineConfig} from 'vite';
import path from 'node:path';

export default defineConfig({
  base: process.env.VITE_BASE || '/rank/newsviz-vessels-stacked/',
  publicDir: 'public-stacked',
  build: {
    outDir: 'dist-stacked',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'stacked.html'),
    },
  },
});
