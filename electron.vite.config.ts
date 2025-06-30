// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import path from 'node:path';
import react from '@vitejs/plugin-react'; // Import react plugin

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: path.resolve(__dirname, 'electron/main.js'), // Vite's LibOptions entry
      },
      outDir: path.resolve(__dirname, 'out/electron'),
      emptyOutDir: true,
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: path.resolve(__dirname, 'electron/preload.js'), // Vite's LibOptions entry
      },
      outDir: path.resolve(__dirname, 'out/electron'),
      emptyOutDir: false, // Don't empty outDir if main already wrote to it
      rollupOptions: {
        output: {
          // Garante que o arquivo de saida seja preload.js
          // e no formato CJS, que é o que o Electron espera.
          entryFileNames: 'preload.js', 
          format: 'cjs', 
        },
      },
    }
  },
  renderer: {
    root: 'src/renderer', // Define o diretório raiz do código fonte do renderer
    plugins: [
      react(), // React plugin
    ],
    resolve: {
      alias: {
        '@renderer': path.resolve(__dirname, 'src/renderer')
      }
    },
    build: {
      // O diretório de saída para os assets do renderer
      outDir: path.resolve(__dirname, 'out/renderer'), 
      emptyOutDir: true, // Limpa o diretório de saída antes de construir
    },
  }
});