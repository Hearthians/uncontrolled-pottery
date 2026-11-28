import {defineConfig} from 'vite';
import path from 'node:path';

export default defineConfig({
  base: process.env.VITE_BASE || '/rank/newsviz-vessels-scroll/',
  publicDir: 'public-scroll',
  build: {
    outDir: 'dist-scroll',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'scroll.html'),
    },
  },
});
