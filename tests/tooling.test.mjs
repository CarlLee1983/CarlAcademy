import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function project(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'carlacademy-task-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp('scripts', path.join(root, 'scripts'), { recursive: true });
  for (const name of ['src', 'tests', 'node_modules/astro/bin']) await mkdir(path.join(root, name), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { build: 'node scripts/tasks.mjs build' } }));
  await writeFile(path.join(root, 'node_modules/astro/package.json'), '{"type":"module"}');
  await writeFile(path.join(root, 'node_modules/astro/bin/astro.mjs'), `
    import { appendFile, mkdir, writeFile } from 'node:fs/promises';
    if (process.env.TASK_TEST_DESCENDANT) {
      const {spawn} = await import('node:child_process');
      const {access} = await import('node:fs/promises');
      spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); require("fs").writeFileSync(process.env.TASK_TEST_DESCENDANT, String(process.pid)); setInterval(() => {}, 1000);'], {stdio:'ignore'});
      for (;;) { try { await access(process.env.TASK_TEST_DESCENDANT); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
    }
    if (process.env.TASK_TEST_WAIT) { console.log('ready'); await new Promise(resolve => setTimeout(resolve, 30000)); }
    if (process.env.TASK_TEST_FAIL) process.exit(7);
    if (process.argv[2] === 'build') {
      await mkdir('dist', {recursive:true}); await writeFile('dist/index.html', process.env.BASE_PATH || '/');
      if (process.env.TASK_TEST_LOG) await appendFile(process.env.TASK_TEST_LOG, process.env.BASE_PATH + '\\n');
      console.log('actual build ' + process.env.BASE_PATH);
    }
  `);
  for (const name of ['build-search.mjs', 'verify-output.mjs']) await writeFile(path.join(root, 'scripts', name), 'console.log("verified");');
  return root;
}
function invoke(root, command, args = [], env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['scripts/tasks.mjs', command, ...args], { cwd: root, env: childEnv, encoding: 'utf8' });
}

test('suite prepares exactly two baselines, validates supplied evidence, and cleans owned artifacts', async t => {
  const root = await project(t);
  const log = path.join(root, 'builds.log');
  const evidence = path.join(root, 'evidence.json');
  await writeFile(path.join(root, 'tests/probe.test.mjs'), `
    import assert from 'node:assert/strict';
    import { writeFile } from 'node:fs/promises';
    import { readArtifact } from '../scripts/test-artifacts.mjs';
    const root = await readArtifact('/'); const sub = await readArtifact('/academy/');
    assert.match(root.result.stdout, /actual build \\/\\n/);
    assert.match(sub.result.stdout, /actual build \\/academy\\//);
    assert.notEqual(root.directory, sub.directory);
    await assert.rejects(readArtifact('/', {...process.env, CARLACADEMY_ARTIFACT_TOKEN:'wrong'}), /Invalid suite/);
    await assert.rejects(readArtifact('/', {CARLACADEMY_ARTIFACT_MANIFEST:process.env.CARLACADEMY_ARTIFACT_MANIFEST}), /together/);
    await writeFile(${JSON.stringify(evidence)}, JSON.stringify({manifest: process.env.CARLACADEMY_ARTIFACT_MANIFEST}));
    await writeFile('src/changed', 'changed');
    await assert.rejects(readArtifact('/'), /source changed/);
    // Restore source so the runner's independent final fingerprint can pass.
    const {rm} = await import('node:fs/promises'); await rm('src/changed');
  `);
  const result = invoke(root, 'test', ['tests/probe.test.mjs'], { TASK_TEST_LOG: log });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), ['/', '/academy/']);
  const { manifest } = JSON.parse(await readFile(evidence, 'utf8'));
  await assert.rejects(readFile(manifest), { code: 'ENOENT' });
  assert.equal(invoke(root, 'check').status, 0, 'lock released after suite');
});

test('failed child status propagates and releases workspace ownership', async t => {
  const root = await project(t);
  assert.equal(invoke(root, 'check', [], { TASK_TEST_FAIL: '1' }).status, 7);
  assert.equal(invoke(root, 'check').status, 0);
  assert.notEqual(invoke(root, 'focused').status, 0, 'focused execution needs an explicit scope');
});

test('concurrent workspace writers are refused and interruption releases the owned lock', async t => {
  const root = await project(t);
  const first = spawn(process.execPath, ['scripts/tasks.mjs', 'check'], { cwd: root, env: { ...process.env, TASK_TEST_WAIT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => first.kill('SIGTERM'));
  let output = '';
  for await (const chunk of first.stdout) { output += chunk; if (output.includes('ready')) break; }
  const second = invoke(root, 'check');
  assert.equal(second.status, 1);
  assert.match(second.stderr, /Another workspace task owns/);
  const closed = new Promise(resolve => first.once('close', resolve));
  first.kill('SIGTERM');
  assert.equal(await closed, 143);
  assert.equal(invoke(root, 'check').status, 0);
});


test('cancellation terminates stubborn descendants before releasing the workspace', async t => {
  const root = await project(t);
  const marker = path.join(root, 'descendant.pid');
  const preload = path.join(root, 'group-probe-preload.mjs');
  // Reproduce EPERM from an OS group-existence probe, including after exit.
  await writeFile(preload, `
    const original = process.kill;
    process.kill = function(pid, signal) {
      if (pid < 0 && signal === 0) throw Object.assign(new Error('kill EPERM'), {code:'EPERM'});
      return original.call(this, pid, signal);
    };
  `);
  const first = spawn(process.execPath, ['scripts/tasks.mjs', 'check'], { cwd: root, env: { ...process.env, TASK_TEST_WAIT: '1', TASK_TEST_DESCENDANT: marker, NODE_OPTIONS: `--import=${preload}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  let pid, errors = '';
  first.stderr.on('data', chunk => { errors += chunk; });
  t.after(() => { first.kill('SIGTERM'); if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} } });
  let output = '';
  for await (const chunk of first.stdout) { output += chunk; if (output.includes('ready')) break; }
  pid = Number(await readFile(marker, 'utf8'));
  const closed = new Promise(resolve => first.once('close', resolve));
  first.kill('SIGTERM');
  assert.equal(await closed, 143);
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  assert.ok(!state.stdout.trim() || state.stdout.trim().startsWith('Z'), `descendant still running: ${state.stdout}`);
  const retry = invoke(root, 'check');
  assert.equal(retry.status, 0, errors + retry.stdout + retry.stderr);
});

test('interruption during artifact cleanup remains nonzero and completes cleanup', async t => {
  const root = await project(t);
  const preload = path.join(root, 'cleanup-preload.mjs');
  // Delay real filesystem cleanup through Node's preload boundary to deliver a
  // deterministic OS signal after test execution, without production test flags.
  await writeFile(preload, `
    import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    if (process.argv[2] === 'test') {
      const original = fs.promises.rm;
      fs.promises.rm = async function(target, ...rest) {
        if (String(target).includes('carlacademy-suite-')) {
          console.log('cleanup-ready:' + target);
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        return original.call(this, target, ...rest);
      };
      syncBuiltinESMExports();
    }
  `);
  await writeFile(path.join(root, 'tests/probe.test.mjs'), 'console.log("probe finished");');
  const env = { ...process.env, NODE_OPTIONS: `--import=${preload}` };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['scripts/tasks.mjs', 'test', 'tests/probe.test.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGTERM'));
  const closed = new Promise(resolve => child.once('close', resolve));
  let output = '', directory;
  for await (const chunk of child.stdout) {
    output += chunk;
    const match = output.match(/cleanup-ready:([^\n]+)/);
    if (match) { directory = match[1]; child.kill('SIGTERM'); break; }
  }
  assert.ok(directory, output);
  assert.equal(await closed, 143);
  await assert.rejects(readFile(path.join(directory, 'manifest.json')), {code:'ENOENT'});
  assert.equal(invoke(root, 'check').status, 0);
});
