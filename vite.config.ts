import { defineConfig } from 'vite'


export default defineConfig ({
  build: {
    assetsDir: '',
    rollupOptions: {
      output: {
        // entryFileNames: `assets/[name].js`,
        chunkFileNames: `[name].js`,
        assetFileNames: `[name].[ext]`
      }
    },
    lib: {
      entry: 'src/index.ts',
      name: 'RLottie',
      formats: ['umd', 'es'],
      fileName: 'index'
    },
    outDir: "dist/lib",
  }
})
