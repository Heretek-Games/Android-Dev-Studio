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

// Dev-server bridge to the harness scene store:
// GET  /api/scene -> harness/scenes/active_scene.json (source of truth)
// GET  /api/scene?rev=1 -> { rev } only (cheap poll for Track D.2 sync)
// POST /api/scene -> validates through the transactional invariant gate,
//                    persists, and syncs a project_memory snapshot.
function sceneBridgePlugin(): Plugin {
  return {
    name: 'heretek-scene-bridge',
    configureServer(server) {
      server.middlewares.use('/api/scene', (req, res) => {
        const repoRoot = path.resolve(__dirname, '..');
        const cli = ['harness/agents/scene_store_cli.py'];
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'GET') {
          const url = new URL(req.url || '/api/scene', 'http://localhost');
          if (url.searchParams.get('rev') === '1') {
            // Cheap revision probe: parse the canonical file directly.
            try {
              const raw = fs.readFileSync(
                path.resolve(repoRoot, 'harness/scenes/active_scene.json'), 'utf8');
              const rev = (JSON.parse(raw) || {}).rev;
              res.statusCode = 200;
              res.end(JSON.stringify({ rev: typeof rev === 'number' ? rev : 0 }));
            } catch (err) {
              res.statusCode = 502;
              res.end(JSON.stringify({ error: String(err) }));
            }
            return;
          }
          const proc = spawn('python3', [...cli, 'get'], { cwd: repoRoot });
          let out = '';
          let err = '';
          proc.stdout.on('data', d => { out += d; });
          proc.stderr.on('data', d => { err += d; });
          proc.on('close', () => {
            res.statusCode = out ? 200 : 502;
            res.end(out || JSON.stringify({ error: err || 'scene store unavailable' }));
          });
          return;
        }

        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            const proc = spawn('python3', [...cli, 'save'], { cwd: repoRoot });
            let out = '';
            let err = '';
            proc.stdout.on('data', d => { out += d; });
            proc.stderr.on('data', d => { err += d; });
            proc.on('close', code => {
              res.statusCode = code === 0 ? 200 : 409; // 409 = invariant rejection
              res.end(out || JSON.stringify({ ok: false, error: err || 'save failed' }));
            });
            proc.stdin.write(body);
            proc.stdin.end();
          });
          return;
        }

        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'GET or POST required' }));
      });
    }
  };
}

// Dev-server bridge to the frame diff audit (Track A.4 studio half):
// GET  /api/spatial/frames -> recent loop frame PNGs + approved baselines.
// POST /api/spatial/diff { frame, baseline?, promote? } -> compare_to_baseline
// JSON with diffPercent, worstRegion, and a heatmap data URL for the dock.
// Frame/baseline names are basenames only (no path traversal); heatmaps are
// never written to disk (data URL in the response).
function diffBridgePlugin(): Plugin {
  return {
    name: 'heretek-diff-bridge',
    configureServer(server) {
      const repoRoot = path.resolve(__dirname, '..');
      const runsDir = path.join(repoRoot, 'harness', 'runs', 'loop_runs');
      const baseDir = path.join(repoRoot, 'harness', 'runs', 'frame_baselines');
      const safe = (name: unknown) => String(name || '').split('/').pop()?.split('\\').pop() || '';

      server.middlewares.use('/api/spatial/frames', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'GET required' }));
          return;
        }
        const list = (dir: string) => {
          try {
            return fs.readdirSync(dir)
              .filter((f: string) => f.endsWith('.png'))
              .map((f: string) => {
                const st = fs.statSync(path.join(dir, f));
                return { name: f, mtime: st.mtimeMs };
              })
              .sort((a: { mtime: number }, b: { mtime: number }) => b.mtime - a.mtime)
              .slice(0, 20);
          } catch { return []; }
        };
        res.statusCode = 200;
        res.end(JSON.stringify({ frames: list(runsDir), baselines: list(baseDir) }));
      });

      server.middlewares.use('/api/spatial/diff', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'POST required' }));
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          let frame = '', baseline = '', promote = false;
          try {
            const parsed = JSON.parse(body || '{}');
            frame = safe(parsed.frame);
            baseline = safe(parsed.baseline) || frame.replace(/\.png$/, '');
            promote = parsed.promote === true;
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'frame is required' }));
            return;
          }
          if (!frame) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'frame is required' }));
            return;
          }
          const framePath = path.join(runsDir, frame);
          const script = [
            'import base64,json,sys;',
            'sys.path.insert(0, ".");',
            'from harness.loop.frame_diff import compare_to_baseline;',
            'from pathlib import Path;',
            'r = compare_to_baseline(sys.argv[2], Path(sys.argv[1]).read_bytes(), promote=sys.argv[3]=="1");',
            'h = r.pop("heatmap", b"");',
            'r["heatmapDataUrl"] = ("data:image/png;base64," + base64.b64encode(h).decode()) if h else None;',
            'print(json.dumps(r));'
          ].join('');
          const proc = spawn('python3', ['-c', script, framePath, baseline, promote ? '1' : '0'], { cwd: repoRoot });
          let out = '';
          let err = '';
          proc.stdout.on('data', d => { out += d; });
          proc.stderr.on('data', d => { err += d; });
          proc.on('close', code => {
            res.statusCode = code === 0 && out ? 200 : 502;
            res.end(out || JSON.stringify({ ok: false, error: err.trim() || 'diff unavailable' }));
          });
        });
      });
    }
  };
}
// POST /api/spatial/ghost { placement, scene? } -> runs ghost_cli.py against
// Dev-server bridge to the ghost placement probe (Track B.3):
// POST /api/spatial/ghost { placement, scene? } -> runs ghost_cli.py against
// the canonical scene (or a supplied scene) and returns the audit verdict
// BEFORE anything is written. Nothing mutates; validity only.
function ghostBridgePlugin(): Plugin {
  return {
    name: 'heretek-ghost-bridge',
    configureServer(server) {
      server.middlewares.use('/api/spatial/ghost', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'POST required' }));
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          let placement: unknown = null;
          let scene: string | undefined;
          try {
            const parsed = JSON.parse(body || '{}');
            placement = parsed.placement ?? null;
            if (parsed.scene) scene = '/tmp/heretek-ghost-scene.json';
          } catch {
            // fall through to the missing-placement error
          }
          if (!placement) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'placement is required' }));
            return;
          }
          const repoRoot = path.resolve(__dirname, '..');
          const run = (scenePath: string) => {
            const proc = spawn('python3', [
              'harness/spatial/ghost_cli.py',
              '--scene', scenePath,
              '--placement', JSON.stringify(placement)
            ], { cwd: repoRoot });
            let out = '';
            let err = '';
            proc.stdout.on('data', d => { out += d; });
            proc.stderr.on('data', d => { err += d; });
            proc.on('close', code => {
              res.statusCode = code === 0 ? 200 : 502;
              res.end(out || JSON.stringify({ ok: false, error: err || 'ghost probe unavailable' }));
            });
          };
          if (scene) {
            try {
              fs.writeFileSync(
                path.resolve(repoRoot, scene.slice(1)), JSON.stringify((JSON.parse(body) as { scene: unknown }).scene));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: 'scene must be JSON' }));
              return;
            }
            run(scene);
          } else {
            run('harness/scenes/active_scene.json');
          }
        });
      });
    }
  };
}
// Dev-server bridge to the real multi-agent swarm orchestrator:
// POST /api/swarm/run { goal } -> runs the pipeline (architect -> invariant
// audit -> headless QA -> review) and returns the real task log + ADRs.
function swarmBridgePlugin(): Plugin {
  return {
    name: 'heretek-swarm-bridge',
    configureServer(server) {
      server.middlewares.use('/api/swarm/run', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'POST required' }));
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          let goal = '';
          try {
            goal = String(JSON.parse(body || '{}').goal || '');
          } catch {
            // fall through to the empty-goal error
          }
          if (!goal.trim()) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'goal is required' }));
            return;
          }
          const repoRoot = path.resolve(__dirname, '..');
          const proc = spawn('python3', ['harness/agents/swarm_cli.py', goal], { cwd: repoRoot });
          let out = '';
          let err = '';
          proc.stdout.on('data', d => { out += d; });
          proc.stderr.on('data', d => { err += d; });
          proc.on('close', code => {
            res.statusCode = code === 0 ? 200 : 502;
            res.end(out || JSON.stringify({ ok: false, error: err || 'swarm unavailable' }));
          });
        });
      });
    }
  };
}

// Dev-server bridge to real ADB device detection and the packaging pipeline:
// GET  /api/devices -> harness/agents/device_cli.py list (real adb devices -l)
// POST /api/deploy  -> harness/build/apk_builder.py (dry-run by default; {real:true} attempts Gradle)
function deviceBridgePlugin(): Plugin {
  return {
    name: 'heretek-device-bridge',
    configureServer(server) {
      server.middlewares.use('/api/devices', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'GET required', devices: [] }));
          return;
        }
        const repoRoot = path.resolve(__dirname, '..');
        const proc = spawn('python3', ['harness/agents/device_cli.py', 'list'], { cwd: repoRoot });
        let out = '';
        let err = '';
        proc.stdout.on('data', d => { out += d; });
        proc.stderr.on('data', d => { err += d; });
        proc.on('close', () => {
          res.statusCode = out ? 200 : 502;
          res.end(out || JSON.stringify({ ok: false, error: err || 'device cli unavailable', devices: [] }));
        });
      });

      // GET /api/device/screen?serial=X -> live PNG frame (adb exec-out screencap -p)
      server.middlewares.use('/api/device/screen', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'GET required' }));
          return;
        }
        const url = new URL(req.url || '', 'http://localhost');
        const serial = url.searchParams.get('serial');
        const args = serial ? ['-s', serial, 'exec-out', 'screencap', '-p'] : ['exec-out', 'screencap', '-p'];
        const proc = spawn('adb', args);
        const chunks: Buffer[] = [];
        let err = '';
        proc.stdout.on('data', (d: Buffer) => chunks.push(d));
        proc.stderr.on('data', d => { err += String(d); });
        proc.on('close', code => {
          const buffer = Buffer.concat(chunks);
          if (code === 0 && buffer.length > 0 && buffer[0] === 0x89) {
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'no-store');
            res.end(buffer);
          } else {
            res.statusCode = 502;
            res.end(JSON.stringify({ ok: false, error: err.trim() || `screencap failed (exit ${code})` }));
          }
        });
      });

      // POST /api/device/input -> adb shell input (tap | swipe | key | text)
      server.middlewares.use('/api/device/input', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'POST required' }));
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          let payload: any = {};
          try {
            payload = JSON.parse(body || '{}');
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'invalid JSON body' }));
            return;
          }
          const serial: string | null = payload.serial ? String(payload.serial) : null;
          const action: string = String(payload.action || '');
          let inputArgs: string[] | null = null;
          if (action === 'tap') {
            inputArgs = ['input', 'tap', String(Number(payload.x) | 0), String(Number(payload.y) | 0)];
          } else if (action === 'swipe') {
            inputArgs = [
              'input', 'swipe',
              String(Number(payload.x1) | 0), String(Number(payload.y1) | 0),
              String(Number(payload.x2) | 0), String(Number(payload.y2) | 0),
              String(Number(payload.durationMs ?? 200) | 0)
            ];
          } else if (action === 'key') {
            inputArgs = ['input', 'keyevent', String(payload.keyCode ?? payload.key ?? '')];
          } else if (action === 'text') {
            inputArgs = ['input', 'text', String(payload.text ?? '')];
          }
          if (!inputArgs) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: `unsupported action '${action}' (tap|swipe|key|text)` }));
            return;
          }
          const args = serial ? ['-s', serial, 'shell', ...inputArgs] : ['shell', ...inputArgs];
          const proc = spawn('adb', args);
          let out = '';
          let err = '';
          proc.stdout.on('data', d => { out += String(d); });
          proc.stderr.on('data', d => { err += String(d); });
          proc.on('close', code => {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: code === 0, action, serial, stdout: out.trim(), stderr: err.trim() }));
          });
        });
      });

      // GET /api/device/stats?serial=X&package=Y -> parsed gfxinfo framestats + meminfo
      server.middlewares.use('/api/device/stats', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'GET required' }));
          return;
        }
        const url = new URL(req.url || '', 'http://localhost');
        const serial = url.searchParams.get('serial');
        const pkg = url.searchParams.get('package') || 'com.heretek.gamestudio';
        const adb = (args: string[]) => spawn('adb', serial ? ['-s', serial, ...args] : args);
        const collect = (child: any) =>
          new Promise<{ code: number | null; out: string; err: string }>(resolve => {
            let out = '';
            let err = '';
            child.stdout.on('data', (d: Buffer) => { out += String(d); });
            child.stderr.on('data', (d: Buffer) => { err += String(d); });
            child.on('close', (code: number | null) => resolve({ code, out, err }));
          });
        (async () => {
          const frames = await collect(adb(['shell', 'dumpsys', 'gfxinfo', pkg, 'framestats']));
          const mem = await collect(adb(['shell', 'dumpsys', 'meminfo', pkg]));
          let jankPercent: number | null = null;
          let totalFrames: number | null = null;
          const jankMatch = frames.out.match(/Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/);
          const totalMatch = frames.out.match(/Total frames rendered:\s*(\d+)/);
          if (jankMatch) jankPercent = Number(jankMatch[2]);
          if (totalMatch) totalFrames = Number(totalMatch[1]);

          let fps: number | null = null;
          const lines = frames.out.split('\n');
          const headerIndex = lines.findIndex(l => l.startsWith('Flags,'));
          if (headerIndex !== -1) {
            // Parse by header name: newer Android adds FrameTimelineVsyncId before IntendedVsync.
            const headerCols = lines[headerIndex].split(',').map(c => c.trim());
            const vsyncCol = headerCols.indexOf('IntendedVsync') !== -1 ? headerCols.indexOf('IntendedVsync') : 2;
            const vsyncs: number[] = [];
            for (let i = headerIndex + 1; i < lines.length && vsyncs.length < 600; i++) {
              const cols = lines[i].split(',');
              if (cols.length <= vsyncCol) continue;
              const intended = Number(cols[vsyncCol]);
              if (Number.isFinite(intended) && intended > 0) vsyncs.push(intended);
            }
            if (vsyncs.length >= 10) {
              const spanSeconds = (vsyncs[vsyncs.length - 1] - vsyncs[0]) / 1e9;
              if (spanSeconds > 0) fps = Number(((vsyncs.length - 1) / spanSeconds).toFixed(1));
            }
          }
          const pssMatch = mem.out.match(/TOTAL PSS:\s*(\d+)/);
          const percentiles: Record<string, number | null> = {};
          for (const p of [50, 90, 95, 99]) {
            const m = frames.out.match(new RegExp(`${p}th percentile:\\s*(\\d+)ms`));
            percentiles[`p${p}`] = m ? Number(m[1]) : null;
          }
          res.statusCode = 200;
          res.end(JSON.stringify({
            ok: frames.code === 0 || mem.code === 0,
            serial,
            package: pkg,
            fps,
            jankPercent,
            totalFrames,
            percentiles,
            pssMb: pssMatch ? Number((Number(pssMatch[1]) / 1024).toFixed(1)) : null,
            generatedAt: new Date().toISOString()
          }));
        })().catch(e => {
          res.statusCode = 502;
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        });
      });

      server.middlewares.use('/api/deploy', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'POST required' }));
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          let device: string | null = null;
          let real = false;
          let tier = 1;
          try {
            const parsed = JSON.parse(body || '{}');
            device = parsed.device ? String(parsed.device) : null;
            real = Boolean(parsed.real);
            tier = Number(parsed.tier) === 2 ? 2 : 1;
          } catch {
            // defaults
          }
          const repoRoot = path.resolve(__dirname, '..');
          const args = ['harness/build/apk_builder.py'];
          if (!real) args.push('--dry-run');
          if (device) args.push('--device', device);
          if (tier === 2) args.push('--tier2');
          const proc = spawn('python3', args, { cwd: repoRoot });
          let out = '';
          let err = '';
          proc.stdout.on('data', d => { out += d; });
          proc.stderr.on('data', d => { err += d; });
          proc.on('close', code => {
            res.statusCode = 200; // the payload carries success/failure details
            res.end(JSON.stringify({
              ok: code === 0,
              mode: real ? 'build' : 'dry-run',
              tier,
              stdout: out.trim(),
              stderr: err.trim()
            }));
          });
        });
      });
    }
  };
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
  // Relative asset paths so the built bundle also works when mounted under a
  // sub-path (the Android WebView container serves it at /assets/game/).
  base: './',
  plugins: [react(), sceneBridgePlugin(), qaBridgePlugin(), swarmBridgePlugin(), deviceBridgePlugin(), ghostBridgePlugin(), diffBridgePlugin()],
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
