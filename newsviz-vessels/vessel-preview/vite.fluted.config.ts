import {defineConfig} from 'vite';
import path from 'node:path';

export default defineConfig({
  base: process.env.VITE_BASE || '/rank/newsviz-vessels-fluted/',
  publicDir: 'public-fluted',
  build: {
    outDir: 'dist-fluted',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'fluted.html'),
    },
  },
});
