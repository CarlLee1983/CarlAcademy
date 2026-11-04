import { spawnSync, spawn } from "node:child_process";
import { mkdtemp, cp, symlink, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildEnv,
  copyRealSite,
  copySampleSite,
  artifactKey,
  readArtifact,
  sampleDocsRoot,
} from "../scripts/test-artifacts.mjs";
// Where tests read sample content (relative to the repo root, the tests' cwd).
export { sampleDocsRoot };
// Shared baseline of the REAL content at `base`, or a fresh build when run standalone.
export async function baseline(t, base = "/") {
  const shared = await readArtifact(artifactKey({ content: "real", base }));
  if (shared) return shared;
  return buildFresh(await workspace(t, copyRealSite), base);
}
// Shared baseline of the SAMPLE content at /academy/. `siteUrl: ""` means no production domain.
export async function sampleBaseline(t, { siteUrl } = {}) {
  const shared = await readArtifact(artifactKey({ content: "sample", siteUrl }));
  if (shared) return shared;
  return buildFresh(await fixture(t), "/academy/", { siteUrl });
}
function buildFresh(directory, base, options) {
  const result = build(directory, base, options);
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  return { directory, result };
}
// A mutable copy of the site whose docs/ is the sample content.
export function fixture(t) {
  return workspace(t, copySampleSite);
}
async function workspace(t, copy) {
  const directory = await mkdtemp(path.join(tmpdir(), "carlacademy-build-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await copy(process.cwd(), directory);
  await symlink(
    path.resolve("node_modules"),
    path.join(directory, "node_modules"),
    "dir",
  );
  return directory;
}
export function build(directory, base = "/", { siteUrl } = {}) {
  return spawnSync("pnpm", ["run", "build"], {
    cwd: directory,
    env: buildEnv(base, siteUrl),
    encoding: "utf8",
  });
}
export async function serve(t, directory, base = "/") {
  const root = await mkdtemp(path.join(tmpdir(), "carlacademy-http-"));
  await mkdir(path.join(root, base), { recursive: true });
  await cp(path.join(directory, "dist"), path.join(root, base), {
    recursive: true,
  });
  const server = spawn(
    "python3",
    [
      "-u",
      "-m",
      "http.server",
      "0",
      "--bind",
      "127.0.0.1",
      "--directory",
      root,
    ],
    // Python logs every request to stderr; an unread pipe fills during a full-site sweep.
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  t.after(async () => {
    server.kill();
    await rm(root, { recursive: true, force: true });
  });
  let output = "";
  for await (const chunk of server.stdout) {
    output += chunk;
    if (/port (\d+)/.test(output)) break;
  }
  const port = output.match(/port (\d+)/)?.[1];
  if (!port) throw new Error(output);
  return `http://127.0.0.1:${port}${base}`;
}
