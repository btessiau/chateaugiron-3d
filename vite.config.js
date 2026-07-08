import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Relative base so the build works both locally and when hosted in a subfolder
// (for example a GitHub Pages project site).
export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    rollupOptions: {
      // Two pages: the 2D top-down map is the main view (index), the 3D game
      // lives on its own page (play3d).
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        play3d: fileURLToPath(new URL('./play3d.html', import.meta.url)),
      },
    },
  },
});
