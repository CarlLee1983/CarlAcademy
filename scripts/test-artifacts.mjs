import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const inputs = ['src', 'docs', 'public', 'scripts', 'astro.config.ts', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
export const bases = ['/', '/academy/'];

export async function fingerprint(root) {
  const hash = createHash('sha256');
  async function visit(name) {
    const file = path.join(root, name);
    let contents;
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error(`Build input must not be a symlink: ${name}`);
      contents = await readdir(file, { withFileTypes: true });
    }
    catch (error) {
      if (error.code === 'ENOENT') { hash.update(`absent:${name}\0`); return; }
      if (error.code !== 'ENOTDIR') throw error;
      hash.update(`${name}\0`); hash.update(await readFile(file)); return;
    }
    for (const entry of contents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error(`Build input must not be a symlink: ${name}/${entry.name}`);
      await visit(path.join(name, entry.name));
    }
  }
  for (const name of inputs) await visit(name);
  return hash.digest('hex');
}

export async function copyInputs(source, destination) {
  for (const name of inputs) {
    try { await cp(path.join(source, name), path.join(destination, name), { recursive: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function prepareArtifacts(root, run) {
  const owned = await mkdtemp(path.join(tmpdir(), 'carlacademy-suite-'));
  try {
    const snapshot = path.join(owned, 'snapshot');
    const before = await fingerprint(root);
    await copyInputs(root, snapshot);
    if (await fingerprint(root) !== before || await fingerprint(snapshot) !== before) {
      throw new Error('Build inputs changed while capturing the suite snapshot; retry after edits stop.');
    }
    const token = randomUUID();
    const artifacts = {};
    for (const [index, base] of bases.entries()) {
      const directory = path.join(owned, `base-${index}`);
      await copyInputs(snapshot, directory);
      await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
      console.log(`Preparing baseline ${base}`);
      const result = await run('pnpm', ['run', 'build'], { cwd: directory, env: { ...process.env, BASE_PATH: base }, capture: true });
      artifacts[base] = { directory, result };
    }
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    const manifest = path.join(owned, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ schema: 1, token, source: before, revision: revision.status === 0 ? revision.stdout.trim() : null, artifacts }));
    return { manifest, token, source: before, cleanup: () => rm(owned, { recursive: true, force: true }) };
  } catch (error) {
    if (!error.retainArtifacts) await rm(owned, { recursive: true, force: true });
    else console.error(`Retained build snapshot: ${owned}`);
    throw error;
  }
}

export async function readArtifact(base, env = process.env) {
  const manifest = env.CARLACADEMY_ARTIFACT_MANIFEST;
  const token = env.CARLACADEMY_ARTIFACT_TOKEN;
  if (!manifest && !token) return null;
  if (!manifest || !token) throw new Error('Invalid suite artifacts: manifest and token must be supplied together.');
  const manifestPath = await realpath(manifest);
  const owned = path.dirname(manifestPath);
  const data = JSON.parse(await readFile(manifestPath, 'utf8'));
  const artifact = data.artifacts?.[base];
  if (data.schema !== 1 || data.token !== token || !bases.includes(base) || !artifact || artifact.result?.status !== 0 || typeof artifact.result.stdout !== 'string' || typeof artifact.result.stderr !== 'string') {
    throw new Error('Invalid suite artifacts: schema, invocation, base or build evidence mismatch.');
  }
  const directory = await realpath(artifact.directory);
  const relative = path.relative(owned, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid suite artifacts: directory escapes the invocation.');
  if (data.source !== await fingerprint(process.cwd())) throw new Error('Invalid suite artifacts: source changed after baseline capture.');
  await readFile(path.join(directory, 'dist/index.html'));
  return { directory, result: artifact.result };
}
