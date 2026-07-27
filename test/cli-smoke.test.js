import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "bin", "distill-codes.js");

test("CLI smoke: help starts successfully", async (t) => {
  const home = await temporaryHome(t);
  const result = await runCLI(["--help"], home);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: distill-codes/);
});

test("CLI smoke: disable restores the backup and preserves unrelated settings", async (t) => {
  const home = await temporaryHome(t);
  const claudeDir = join(home, ".claude");
  const settings = join(claudeDir, "settings.json");
  await writeJSON(settings, {
    env: {
      ANTHROPIC_BASE_URL: "https://proxy.distill.codes/key123456/essential/anthropic",
      KEEP_ME: "yes"
    }
  });
  await writeJSON(join(claudeDir, "settings.distill-codes-backup.json"), {
    env: { ANTHROPIC_BASE_URL: "https://example.com/original" }
  });

  const result = await runCLI(["disable"], home);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Distill\.codes proxy disabled/);
  assert.deepEqual(await readJSON(settings), {
    env: {
      ANTHROPIC_BASE_URL: "https://example.com/original",
      KEEP_ME: "yes"
    }
  });
});

test("CLI smoke: enable rejects a non-Distill URL without writing settings", async (t) => {
  const home = await temporaryHome(t);
  const settings = join(home, ".claude", "settings.json");
  const original = { env: { KEEP_ME: "yes" } };
  await writeJSON(settings, original);

  const result = await runCLI(["enable", "https://attacker.example/key123456/essential/anthropic"], home);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /distill\.codes host/);
  assert.deepEqual(await readJSON(settings), original);
  await assert.rejects(readFile(join(home, ".claude", "settings.distill-codes-backup.json")), { code: "ENOENT" });
});

async function temporaryHome(t) {
  const home = await mkdtemp(join(tmpdir(), "distill-cli-smoke-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

function runCLI(args, home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, HOME: home }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function writeJSON(file, value) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJSON(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
