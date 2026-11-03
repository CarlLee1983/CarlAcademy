import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../scripts/check-diff.mjs', import.meta.url));

async function repository(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'carlacademy-diff-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = spawnSync('git', ['init', '--quiet', directory], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return directory;
}

function check(directory) {
  const env = { ...process.env };
  delete env.CARLACADEMY_DIFF_BASE;
  return spawnSync(process.execPath, [script], { cwd: directory, env, encoding: 'utf8' });
}

test('whitespace CLI rejects new text with trailing whitespace and accepts clean new text', async t => {
  const directory = await repository(t);
  const file = path.join(directory, 'new document.md');
  await writeFile(file, 'new text  \n');
  const bad = check(directory);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout + bad.stderr, /new document\.md:1: trailing whitespace/);
  await writeFile(file, 'new text\n');
  const clean = check(directory);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
});

test('whitespace CLI checks staged additions and unstaged changes independently', async t => {
  const directory = await repository(t);
  const file = path.join(directory, 'tracked.md');
  await writeFile(file, 'staged text \n');
  const added = spawnSync('git', ['add', 'tracked.md'], { cwd: directory, encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);
  await writeFile(file, 'clean working text\n');
  const staged = check(directory);
  assert.equal(staged.status, 1);
  assert.match(staged.stdout + staged.stderr, /tracked\.md:1: trailing whitespace/);
  const cleaned = spawnSync('git', ['add', 'tracked.md'], { cwd: directory, encoding: 'utf8' });
  assert.equal(cleaned.status, 0, cleaned.stderr);
  await writeFile(file, 'unstaged text \n');
  const unstaged = check(directory);
  assert.equal(unstaged.status, 1);
  assert.match(unstaged.stdout + unstaged.stderr, /tracked\.md:1: trailing whitespace/);
  await writeFile(file, 'clean working text\n');
  assert.equal(check(directory).status, 0);
});


test('whitespace CLI rejects an unresolved CI comparison base', async t => {
  const directory = await repository(t);
  const result = spawnSync(process.execPath, [script], { cwd: directory, env: {...process.env, CARLACADEMY_DIFF_BASE:'missing-reference'}, encoding:'utf8' });
  assert.equal(result.status, 1);
});

test('CI comparison rejects committed whitespace even when the checkout is clean', async t => {
  const directory = await repository(t);
  const env = { ...process.env, GIT_AUTHOR_NAME:'Fixture', GIT_AUTHOR_EMAIL:'fixture@example.invalid', GIT_COMMITTER_NAME:'Fixture', GIT_COMMITTER_EMAIL:'fixture@example.invalid' };
  // Disposable Git objects model a base/head pair without touching project history.
  function object(args, input = '') {
    const result = spawnSync('git', args, { cwd:directory, env, input, encoding:'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  const empty = object(['mktree']);
  const base = object(['commit-tree', empty], 'base\n');
  const blob = object(['hash-object', '-w', '--stdin'], 'committed text  \n');
  const tree = object(['mktree'], `100644 blob ${blob}\tcommitted.md\n`);
  const head = object(['commit-tree', tree, '-p', base], 'head\n');
  object(['update-ref', 'HEAD', head]);
  object(['read-tree', '--reset', '-u', 'HEAD']);
  assert.equal(check(directory).status, 0, 'working tree itself is clean');
  const result = spawnSync(process.execPath, [script], { cwd:directory, env:{...env, CARLACADEMY_DIFF_BASE:base}, encoding:'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /committed.md:1: trailing whitespace/);
});
