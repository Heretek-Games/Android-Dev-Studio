import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

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

// Dev-server bridge to the real headless Artemis QA pipeline:
// POST /api/qa/run { goal, scenario?, frames? } -> spawns artemis_qa_runner.py
// and returns its JSON report (real engine metrics + rule evaluation).
function qaBridgePlugin(): Plugin {
  return {
    name: 'heretek-qa-bridge',
    configureServer(server) {
      server.middlewares.use('/api/qa/run', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'POST required' }));
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          let goal = 'Headless QA audit';
          let scenario: string | undefined;
          let frames = 600;
          try {
            const parsed = JSON.parse(body || '{}');
            if (parsed.goal) goal = String(parsed.goal);
            if (parsed.scenario) scenario = String(parsed.scenario);
            if (parsed.frames) frames = Number(parsed.frames) || 600;
          } catch {
            // keep defaults on malformed payloads
          }
          const repoRoot = path.resolve(__dirname, '..');
          const runnerArgs = [
            'harness/agents/artemis_qa_runner.py',
            '--json',
            '--goal', goal,
            '--frames', String(frames)
          ];
          if (scenario) runnerArgs.push('--scenario', scenario);
          const proc = spawn('python3', runnerArgs, { cwd: repoRoot });
          let stdout = '';
          let stderr = '';
          proc.stdout.on('data', d => { stdout += d; });
          proc.stderr.on('data', d => { stderr += d; });
          proc.on('close', () => {
            res.setHeader('Content-Type', 'application/json');
            if (stdout.trim()) {
              res.statusCode = 200;
              res.end(stdout);
            } else {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: stderr.trim() || 'QA runner produced no output' }));
            }
          });
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), qaBridgePlugin()],
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
