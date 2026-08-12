import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import {cpSync} from 'node:fs';
import {defineConfig} from 'vite';

/**
 * Copies eval/Dataset (images + ground truth) into the production build so
 * the Evaluation page's dataset loader works from dist/ as well as dev.
 * Runs only when a build bundle closes — never during dev.
 */
function copyDatasetToDist() {
  return {
    name: 'snapspend:copy-dataset',
    closeBundle() {
      const src = path.resolve(__dirname, 'eval/Dataset');
      const dest = path.resolve(__dirname, 'dist/eval/Dataset');
      try {
        cpSync(src, dest, {recursive: true});
        console.log(`[copy-dataset] eval/Dataset -> dist/eval/Dataset`);
      } catch (err) {
        console.warn(`[copy-dataset] skipped: ${err.message}`);
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [tailwindcss(), copyDatasetToDist()],
    build: {
      rollupOptions: {
        input: {
          app: path.resolve(__dirname, 'index.html'),
          eval: path.resolve(__dirname, 'eval.html')
        }
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});