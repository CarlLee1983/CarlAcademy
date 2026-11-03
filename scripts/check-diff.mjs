import { spawnSync } from 'node:child_process';

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

let failed = false;
function check(args, allowedStatuses = [0]) {
  const result = git(args);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (!allowedStatuses.includes(result.status)) failed = true;
}

// A clean CI checkout still needs to check the commits introduced by this run.
const base = process.env.CARLACADEMY_DIFF_BASE;
if (base) {
  const resolved = /^0+$/.test(base)
    ? spawnSync('git', ['hash-object', '-t', 'tree', '--stdin'], { input: '', encoding: 'utf8' })
    : git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
  if (resolved.status !== 0) {
    process.stderr.write(resolved.stderr || 'Cannot resolve whitespace comparison base.\n');
    failed = true;
  } else check(['diff', '--check', resolved.stdout.trim(), 'HEAD', '--']);
}

// Check both sides of the index; one can be clean while the other is not.
check(['diff', '--check']);
check(['diff', '--cached', '--check']);
const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']);
if (untracked.status !== 0) {
  process.stderr.write(untracked.stderr);
  failed = true;
} else {
  for (const file of untracked.stdout.split('\0').filter(Boolean)) {
    // Git handles binary files, attributes and whitespace rules consistently
    // with the tracked-file checks. New text is compared against an empty file.
    // --no-index also returns 1 for an ordinary, whitespace-clean difference.
    check(['diff', '--no-index', '--check', '--', '/dev/null', file], [0, 1]);
  }
}
process.exitCode = failed ? 1 : 0;
