import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Parse root .env.prod for LLM configuration
let llmApi = 'https://llm.heretek.one/v1';
let llmApiKey = '';
let llmModel = 'mimotp/mimo-v2.6-flash';

const envProdPath = path.resolve(__dirname, '../.env.prod');
if (fs.existsSync(envProdPath)) {
  const content = fs.readFileSync(envProdPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('LLM_API=')) llmApi = trimmed.replace('LLM_API=', '').trim();
    if (trimmed.startsWith('LLM_API_KEY=')) llmApiKey = trimmed.replace('LLM_API_KEY=', '').trim();
    if (trimmed.startsWith('LLM_API_MODEL=')) llmModel = trimmed.replace('LLM_API_MODEL=', '').trim();
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __LLM_MODEL__: JSON.stringify(llmModel)
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@heretek/engine': path.resolve(__dirname, '../engine/dist/index.js')
    }
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api/llm': {
        target: llmApi,
        changeOrigin: true,
        rewrite: (pathStr) => pathStr.replace(/^\/api\/llm/, ''),
        headers: {
          Authorization: `Bearer ${llmApiKey}`
        }
      }
    }
  }
});
