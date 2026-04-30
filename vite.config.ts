import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/triple-integral-3d-visualizer/' : '/',
  plugins: [react()],
}));
