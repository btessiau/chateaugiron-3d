import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Relative base so the build works both locally and when hosted in a subfolder
// (for example a GitHub Pages project site).
export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    rollupOptions: {
      // Two pages: the 3D game (index) and the 2D top-down map (map2d).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        map2d: fileURLToPath(new URL('./map2d.html', import.meta.url)),
      },
    },
  },
});
