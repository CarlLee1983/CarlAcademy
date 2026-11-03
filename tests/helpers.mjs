import { spawnSync, spawn } from "node:child_process";
import { mkdtemp, cp, symlink, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
export async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "carlacademy-build-"));
  for (const name of [
    "src",
    "docs",
    "scripts",
    "public",
    "astro.config.ts",
    "tsconfig.json",
    "package.json",
  ]) {
    try {
      await cp(name, path.join(directory, name), { recursive: true });
    } catch (error) {
      if (name !== "public" || error.code !== "ENOENT") throw error;
    }
  }
  await symlink(
    path.resolve("node_modules"),
    path.join(directory, "node_modules"),
    "dir",
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
export function build(directory, base = "/") {
  return spawnSync("npm", ["run", "build"], {
    cwd: directory,
    env: { ...process.env, BASE_PATH: base },
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
    { stdio: ["ignore", "pipe", "pipe"] },
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
