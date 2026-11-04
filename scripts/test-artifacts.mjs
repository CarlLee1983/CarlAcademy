import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { topics } from '../src/utils/urls.ts';

// Sample content is a build input too: editing it must invalidate the suite snapshot.
export const sampleDocsRoot = 'tests/fixtures/docs';
const inputs = ['src', 'docs', sampleDocsRoot, 'public', 'scripts', 'astro.config.ts', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
// Shared baselines: real content at each base, then sample content at /academy/.
const baselines = [
  { key: '/', base: '/', sample: false },
  { key: '/academy/', base: '/academy/', sample: false },
  { key: 'sample', base: '/academy/', sample: true },
  { key: 'sample:no-site-url', base: '/academy/', sample: true, siteUrl: '' },
];
export const artifactKeys = baselines.map(({ key }) => key);
// Key of the baseline for `{ content: 'real', base }` or `{ content: 'sample', siteUrl }` (siteUrl '' means no production domain).
export function artifactKey({ content, base, siteUrl }) {
  const sample = content === 'sample';
  const found = baselines.find(entry => entry.sample === sample && (sample ? entry.siteUrl === (siteUrl === '' ? '' : undefined) : entry.base === base));
  if (!found) throw new Error(`No shared baseline for ${JSON.stringify({ content, base, siteUrl })}`);
  return found.key;
}

// siteUrl omitted means the product default domain, so an inherited SITE_URL must not leak in.
export function buildEnv(base, siteUrl, env = process.env) {
  const { SITE_URL: _inherited, ...rest } = env;
  return { ...rest, BASE_PATH: base, ...(siteUrl === undefined ? {} : { SITE_URL: siteUrl }) };
}

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

export async function copyInputs(source, destination, names = inputs) {
  for (const name of names) {
    try { await cp(path.join(source, name), path.join(destination, name), { recursive: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

// Site copy with the real docs/; sample content is not part of it.
export function copyRealSite(source, destination) {
  return copyInputs(source, destination, inputs.filter(name => name !== sampleDocsRoot));
}

// Site copy whose docs/ is the sample content; topics the sample lacks get a minimal index.
export async function copySampleSite(source, destination) {
  await copyInputs(source, destination, inputs.filter(name => name !== 'docs' && name !== sampleDocsRoot));
  await cp(path.join(source, sampleDocsRoot), path.join(destination, 'docs'), { recursive: true });
  for (const topic of topics) {
    const directory = path.join(destination, 'docs', topic);
    try { await lstat(path.join(directory, 'README.md')); continue; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // The site cannot render a topic without a document (start link and counts), so each stub has one.
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'README.md'), `# ${topic}\n\n測試用的最小主題索引。\n\n[最小文件](stub.md)\n`);
    await writeFile(path.join(directory, 'stub.md'), '# 最小文件\n\n測試用的最小文件。\n');
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
    for (const [index, { key, base, sample, siteUrl }] of baselines.entries()) {
      const directory = path.join(owned, `baseline-${index}`);
      if (sample) await copySampleSite(snapshot, directory);
      else await copyRealSite(snapshot, directory);
      await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
      console.log(`Preparing baseline ${key}`);
      const result = await run('pnpm', ['run', 'build'], { cwd: directory, env: buildEnv(base, siteUrl), capture: true });
      artifacts[key] = { directory, result };
    }
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    const manifest = path.join(owned, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ schema: 2, token, source: before, revision: revision.status === 0 ? revision.stdout.trim() : null, artifacts }));
    return { manifest, token, source: before, cleanup: () => rm(owned, { recursive: true, force: true }) };
  } catch (error) {
    if (!error.retainArtifacts) await rm(owned, { recursive: true, force: true });
    else console.error(`Retained build snapshot: ${owned}`);
    throw error;
  }
}

export async function readArtifact(key, env = process.env) {
  const manifest = env.CARLACADEMY_ARTIFACT_MANIFEST;
  const token = env.CARLACADEMY_ARTIFACT_TOKEN;
  if (!manifest && !token) return null;
  if (!manifest || !token) throw new Error('Invalid suite artifacts: manifest and token must be supplied together.');
  const manifestPath = await realpath(manifest);
  const owned = path.dirname(manifestPath);
  const data = JSON.parse(await readFile(manifestPath, 'utf8'));
  const artifact = data.artifacts?.[key];
  if (data.schema !== 2 || data.token !== token || !artifactKeys.includes(key) || !artifact || artifact.result?.status !== 0 || typeof artifact.result.stdout !== 'string' || typeof artifact.result.stderr !== 'string') {
    throw new Error('Invalid suite artifacts: schema, invocation, baseline or build evidence mismatch.');
  }
  const directory = await realpath(artifact.directory);
  const relative = path.relative(owned, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid suite artifacts: directory escapes the invocation.');
  if (data.source !== await fingerprint(process.cwd())) throw new Error('Invalid suite artifacts: source changed after baseline capture.');
  await readFile(path.join(directory, 'dist/index.html'));
  return { directory, result: artifact.result };
}
