import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'https://review.flyingpluto.ai',
        changeOrigin: true,
        secure: false, // In case of custom certs
      }
    }
  }
});
