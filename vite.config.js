import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: {target:'es2022', outDir:'docs', emptyOutDir:true, rollupOptions:{output:{manualChunks:{three:['three']}}}}, worker: { format:'es' } });
