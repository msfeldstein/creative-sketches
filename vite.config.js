import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdirSync, statSync } from 'fs';

// Auto-discover all sketch HTML files
function getSketchEntries() {
  const sketchesDir = resolve(__dirname, 'sketches');
  const entries = {
    main: resolve(__dirname, 'index.html'),
  };
  
  try {
    const sketches = readdirSync(sketchesDir);
    for (const sketch of sketches) {
      const sketchPath = resolve(sketchesDir, sketch);
      if (statSync(sketchPath).isDirectory()) {
        const indexPath = resolve(sketchPath, 'index.html');
        try {
          statSync(indexPath);
          entries[`sketches/${sketch}`] = indexPath;
        } catch {
          // No index.html in this sketch folder
        }
      }
    }
  } catch {
    // sketches folder doesn't exist
  }
  
  return entries;
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: getSketchEntries(),
    },
  },
  server: {
    port: 3000,
    open: false,
  },
});
