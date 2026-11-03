import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fingerprint, prepareArtifacts } from './test-artifacts.mjs';

const root = await realpath(process.cwd());
const command = process.argv[2];
if (!['check', 'build', 'test', 'focused', 'verify', 'diff'].includes(command)) {
  console.error('Usage: node scripts/tasks.mjs check|build|test|focused|verify|diff [test arguments]');
  process.exit(2);
}
const lock = path.join(tmpdir(), `carlacademy-task-${createHash('sha256').update(root).digest('hex').slice(0, 24)}.lock`);
const token = randomUUID();
try { await mkdir(lock); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.error(`Another workspace task owns ${lock}. Inspect owner.json before removing a stale lock; it is never removed automatically.`);
  process.exit(1);
}
let recordedOwner = false;
let retainOwnership = false;
const controller = new AbortController();
let interrupted = 0;
const interrupt = signal => {
  interrupted = signal === 'SIGINT' ? 130 : 143;
  process.exitCode = interrupted;
  controller.abort();
};
const onInt = () => interrupt('SIGINT');
const onTerm = () => interrupt('SIGTERM');
process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);

async function run(program, args, options = {}) {
  controller.signal.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, env: process.env, ...options, detached: process.platform !== 'win32', stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '', stderr = '';
    child.stdout?.on('data', data => { stdout += data; });
    child.stderr?.on('data', data => { stderr += data; });
    let timeout, cancellationDeadline;
    function groupStopped() {
      const states = spawnSync('ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' });
      if (states.status !== 0) return false;
      return !states.stdout.split('\n').some(line => {
        const [group, state] = line.trim().split(/\s+/);
        return Number(group) === child.pid && !state?.startsWith('Z');
      });
    }
    function kill(signal) {
      if (!child.pid) return;
      try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); }
      catch (error) {
        if (error.code === 'ESRCH' || (error.code === 'EPERM' && groupStopped())) return;
        throw error;
      }
    }
    const abort = () => {
      kill('SIGTERM');
      cancellationDeadline = Date.now() + 5000;
      timeout = setTimeout(() => kill('SIGKILL'), 5000);
    };
    controller.signal.addEventListener('abort', abort, { once: true });
    child.once('error', error => { controller.signal.removeEventListener('abort', abort); clearTimeout(timeout); reject(error); });
    child.once('close', async (status, signal) => {
      try {
        controller.signal.removeEventListener('abort', abort);
        // A reaped leader does not imply its detached process group has exited.
        if (controller.signal.aborted && process.platform !== 'win32' && child.pid) {
          const alive = () => {
            try { process.kill(-child.pid, 0); return true; }
            catch (error) {
              if (error.code === 'ESRCH') return false;
              if (error.code === 'EPERM') return !groupStopped();
              throw error;
            }
          };
          while (alive() && Date.now() < cancellationDeadline) await new Promise(resolve => setTimeout(resolve, 25));
          if (alive()) {
            kill('SIGKILL');
            const stopped = () => {
              if (!alive()) return true;
              // Zombies cannot write but may remain until their new parent reaps them.
              return groupStopped();
            };
            const deadline = Date.now() + 5000;
            while (!stopped() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
            if (!stopped()) throw new Error(`Cannot confirm owned descendants stopped (group ${child.pid}); workspace lock and artifacts retained.`);
          }
        }
        clearTimeout(timeout);
        const result = { status: status ?? (interrupted || 1), stdout, stderr };
        if (status === 0 && !controller.signal.aborted) resolve(result);
        else {
          if (options.capture) console.error(stdout + stderr);
          const error = new Error(`${program} ${args.join(' ')} failed (${signal ?? status})`);
          error.exitCode = interrupted || status || 1; reject(error);
        }
      } catch (error) {
        retainOwnership = true;
        error.retainArtifacts = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    if (controller.signal.aborted) abort();
  });
}

async function suite() {
  const artifacts = await prepareArtifacts(root, run);
  try {
    await run(process.execPath, ['--test', '--test-concurrency=1', ...(process.argv.slice(3).length ? process.argv.slice(3) : (await readdir('tests')).filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`))], {
      env: { ...process.env, CARLACADEMY_ARTIFACT_MANIFEST: artifacts.manifest, CARLACADEMY_ARTIFACT_TOKEN: artifacts.token },
    });
    if (await fingerprint(root) !== artifacts.source) throw new Error('Build inputs changed during tests; results do not apply to the current source.');
  } finally {
    if (!retainOwnership) await artifacts.cleanup();
    else console.error(`Retained suite artifacts: ${artifacts.manifest}`);
  }
}

try {
  await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ token, pid: process.pid, command, root }));
  recordedOwner = true;
  if (command === 'focused' && !process.argv.slice(3).length) throw new Error('focused requires an explicit test file or test arguments.');
  if (command === 'check' || command === 'verify') await run(process.execPath, [path.join(root, 'node_modules/astro/bin/astro.mjs'), 'check']);
  if (command === 'build') {
    await run(process.execPath, [path.join(root, 'node_modules/astro/bin/astro.mjs'), 'build']);
    await run(process.execPath, ['scripts/build-search.mjs']);
    await run(process.execPath, ['scripts/verify-output.mjs']);
  }
  if (command === 'test' || command === 'verify') await suite();
  if (command === 'focused') await run(process.execPath, ['--test', '--test-concurrency=1', ...process.argv.slice(3)]);
  if (command === 'diff' || command === 'verify') await run(process.execPath, ['scripts/check-diff.mjs']);
} catch (error) {
  console.error(error.message); process.exitCode = interrupted || error.exitCode || 1;
} finally {
  try {
    const owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8'));
    if (owner.token === token && !retainOwnership) await rm(lock, { recursive: true });
  } catch (error) { if (error.code === 'ENOENT' && !recordedOwner) await rm(lock, { recursive: true, force: true });
    else { console.error(`Task lock retained: ${error.message}`); process.exitCode = 1; } }
  if (interrupted) process.exitCode = interrupted;
  process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
}
