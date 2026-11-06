import { defineConfig } from 'vite';

// base './' keeps every path relative, so the game works from any host or
// sub-folder (GitHub Pages, Vercel, or inside an Android wrapper later).
export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
