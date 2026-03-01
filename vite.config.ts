import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv, Plugin } from 'vite';

const localRunManagerPlugin = (): Plugin => ({
  name: 'local-run-manager-plugin',
  configureServer(server) {
    server.middlewares.use('/api/save-file', (req, res, next) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const { runId, fileName, base64Data } = data;

            if (!runId || !fileName || !base64Data) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing parameters' }));
              return;
            }

            const dir = path.resolve(__dirname, 'public', 'runs', runId);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }

            // Remove header from data URL (e.g. data:image/png;base64, or data:audio/mpeg;base64,)
            const base64Content = base64Data.split(';base64,').pop();
            const filePath = path.join(dir, fileName);

            fs.writeFileSync(filePath, base64Content, { encoding: 'base64' });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, path: `/runs/${runId}/${fileName}` }));
          } catch (e) {
            console.error('Error saving file:', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
          }
        });
      } else {
        next();
      }
    });

    server.middlewares.use('/api/save-run', (req, res, next) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const { runId, runData } = data;

            if (!runId || !runData) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing parameters' }));
              return;
            }

            const dir = path.resolve(__dirname, 'public', 'runs', runId);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }

            const filePath = path.join(dir, 'run-data.json');
            fs.writeFileSync(filePath, JSON.stringify(runData, null, 2), { encoding: 'utf-8' });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            console.error('Error saving run data:', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
          }
        });
      } else {
        next();
      }
    });

    server.middlewares.use('/api/list-runs', (req, res, next) => {
      if (req.method === 'GET') {
        try {
          const runsDir = path.resolve(__dirname, 'public', 'runs');
          if (!fs.existsSync(runsDir)) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ runs: [] }));
            return;
          }

          const runFolders = fs.readdirSync(runsDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

          const runs = [];
          for (const runId of runFolders) {
            const dataPath = path.join(runsDir, runId, 'run-data.json');
            if (fs.existsSync(dataPath)) {
              try {
                const runData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
                runs.push({
                  runId,
                  theme: runData.theme || 'Unknown Theme',
                  timestamp: parseInt(runId) || 0
                });
              } catch (e) {
                console.error(`Error parsing run-data.json for run ${runId}`, e);
              }
            }
          }

          // Sort newest first
          runs.sort((a, b) => b.timestamp - a.timestamp);

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ runs }));
        } catch (e) {
          console.error('Error listing runs:', e);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      } else {
        next();
      }
    });

    server.middlewares.use('/api/mistral-ocr', (req, res, next) => {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        req.on('end', async () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            const requestData = JSON.parse(body);

            const mistralApiKey = loadEnv('development', '.', '').MISTRAL_API_KEY;
            if (!mistralApiKey) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'MISTRAL_API_KEY is not configured' }));
              return;
            }

            const mistralRes = await fetch('https://api.mistral.ai/v1/ocr', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${mistralApiKey}`,
              },
              body: JSON.stringify(requestData),
            });

            const mistralData = await mistralRes.text();
            res.statusCode = mistralRes.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(mistralData);
          } catch (e) {
            console.error('Error proxying Mistral OCR:', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Mistral OCR proxy error' }));
          }
        });
      } else {
        next();
      }
    });

    server.middlewares.use('/api/mistral-chat', (req, res, next) => {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        req.on('end', async () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            const requestData = JSON.parse(body);

            const mistralApiKey = loadEnv('development', '.', '').MISTRAL_API_KEY;
            if (!mistralApiKey) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'MISTRAL_API_KEY is not configured' }));
              return;
            }

            const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${mistralApiKey}`,
              },
              body: JSON.stringify(requestData),
            });

            const mistralData = await mistralRes.text();
            res.statusCode = mistralRes.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(mistralData);
          } catch (e) {
            console.error('Error proxying Mistral chat:', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Mistral chat proxy error' }));
          }
        });
      } else {
        next();
      }
    });

    server.middlewares.use('/api/check-file', (req, res, next) => {
      if (req.method === 'GET') {
        try {
          const url = new URL(req.url || '', `http://${req.headers.host}`);
          const runId = url.searchParams.get('runId');
          const fileName = url.searchParams.get('fileName');

          if (!runId || !fileName) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing parameters' }));
            return;
          }

          const filePath = path.resolve(__dirname, 'public', 'runs', runId, fileName);
          const exists = fs.existsSync(filePath);

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ exists, url: exists ? `/runs/${runId}/${fileName}` : null }));
        } catch (e) {
          console.error('Error checking file:', e);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      } else {
        next();
      }
    });
  }
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), localRunManagerPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.GOOGLE_API_KEY),
      'process.env.ELEVENLABS_API_KEY': JSON.stringify(env.ELEVENLABS_API_KEY),
      'process.env.MISTRAL_API_KEY': JSON.stringify(env.MISTRAL_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  };
});
