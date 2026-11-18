import { spawn } from 'child_process';
import path from 'path';
import os from 'os';

export interface PythonResponse<T = any> {
  status: 'success' | 'error';
  message?: string;
  transformed_points?: T[];
  metrics?: T;
  file?: string;
  svg_file?: string;
  warning?: string;
  traceback?: string;
  scales?: { vp1: number; vp2: number };
  area?: number;
  perim?: number;
}

// En Render Cloud (512 MB) limitar a 1; en laptop local aprovechar los núcleos automáticamente
const isRenderCloud = Boolean(process.env.RENDER || process.env.NODE_ENV === 'production');
const defaultPythonConcurrency = isRenderCloud ? 1 : Math.max(4, Math.min(8, os.cpus().length));
const MAX_CONCURRENT_PYTHON = Number(process.env.PYTHON_MAX_CONCURRENCY) || defaultPythonConcurrency;
let runningPythonProcesses = 0;
const waitingQueue: (() => void)[] = [];

function acquirePythonLock(): Promise<void> {
  if (runningPythonProcesses < MAX_CONCURRENT_PYTHON) {
    runningPythonProcesses++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waitingQueue.push(resolve);
  });
}

function releasePythonLock(): void {
  runningPythonProcesses--;
  const next = waitingQueue.shift();
  if (next) {
    runningPythonProcesses++;
    next();
  }
}

async function executePythonScript<T = any>(
  scriptPath: string,
  payload: any,
  extraEnv?: NodeJS.ProcessEnv
): Promise<PythonResponse<T>> {
  return new Promise((resolve) => {
    const pythonExe = process.platform === 'win32' ? 'python' : 'python3';
    const pythonProcess = spawn(pythonExe, [scriptPath], {
      shell: false,
      env: {
        ...process.env,
        ...extraEnv,
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUNBUFFERED: '1',
      },
    });

    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        if (stdoutData) {
          try {
            const parsed = JSON.parse(stdoutData);
            return resolve(parsed);
          } catch (e) {
            // Fallback to stderr
          }
        }
        return resolve({
          status: 'error',
          message: stderrData || `Process exited with code ${code}`,
        });
      }

      try {
        const parsed = JSON.parse(stdoutData);
        resolve(parsed);
      } catch (e) {
        resolve({
          status: 'error',
          message: `Failed to parse Python output: ${e instanceof Error ? e.message : String(e)}\nSTDOUT: ${stdoutData}\nSTDERR: ${stderrData}`,
        });
      }
    });

    pythonProcess.on('error', (err) => {
      resolve({
        status: 'error',
        message: `Failed to start Python process: ${err instanceof Error ? err.message : String(err)}`,
      });
    });

    pythonProcess.stdin.write(JSON.stringify(payload));
    pythonProcess.stdin.end();

    const timeout = setTimeout(() => {
      pythonProcess.kill('SIGKILL');
      resolve({
        status: 'error',
        message: 'Python process timed out after 120 seconds',
      });
    }, 120000);

    pythonProcess.on('exit', () => clearTimeout(timeout));
  });
}

export async function runPythonScript<T = any>(
  scriptPath: string,
  payload: any,
  extraEnv?: NodeJS.ProcessEnv
): Promise<PythonResponse<T>> {
  await acquirePythonLock();
  try {
    return await executePythonScript<T>(scriptPath, payload, extraEnv);
  } finally {
    releasePythonLock();
  }
}
