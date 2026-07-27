import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { main } from "../src/cli.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "bin", "distill-codes.js");

test("CLI smoke: help starts successfully", async (t) => {
  const home = await temporaryHome(t);
  const result = await runCLI(["--help"], home);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: distill-codes/);
});

test("CLI version comes from package.json", async (t) => {
  const home = await temporaryHome(t);
  const result = await runCLI(["--version"], home);
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), version);
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

test("CLI bench reports progress before direct and Distill runs", async () => {
  const messages = [];

  await main(
    ["node", "distill-codes", "bench", "key123456"],
    {
      preflightProxy: async () => {},
      log: (message) => messages.push(message),
      runBenchmark: async (options) => {
        options.onPlan({ model: "test-model", effort: "high" });
        options.onRunStart("direct");
        options.onRunStart("distill");
        return {
          runRoot: "/tmp/bench",
          report: {
            runs: {
              direct: {
                ok: true,
                models: ["test-model"],
                primary_model: { canonical_model: "test-model", context_window: 1_000_000, max_output_tokens: 64_000 },
                reasoning_effort: "high"
              },
              distill: {
                ok: true,
                models: ["test-model"],
                primary_model: { canonical_model: "test-model", context_window: 1_000_000, max_output_tokens: 64_000 },
                reasoning_effort: "high"
              }
            },
            comparison: {
              comparable: true,
              reasons: [],
              output_tokens: { direct: 100, distill: 60, delta: -40, percent: -40 },
              duration_ms: { direct: 1000, distill: 800, delta: -200, percent: -20 },
              turns: { direct: 10, distill: 8, delta: -2, percent: -20 },
              loc: { direct: 20, distill: 15, delta: -5, percent: -25 },
              files: { direct: 2, distill: 1, delta: -1, percent: -50 }
            }
          },
          sharePath: null
        };
      }
    }
  );

  assert.deepEqual(messages.slice(0, 5), [
    "Proxy URL: https://proxy.distill.codes/<proxy-key>/essential/anthropic",
    "Model: test-model",
    "Effort: high",
    "Running direct benchmark...",
    "Running Distill.codes benchmark..."
  ]);
  assert.match(messages[5], /Output tokens/);
  assert.doesNotMatch(messages[5], /cost|USD/i);
  assert.match(messages[5], /Comparison: comparable/);
  assert.match(messages[5], /Direct primary: test-model \(1,000,000 context, 64,000 max output\)/);
  assert.match(messages[5], /Direct models: test-model/);
  assert.match(messages[5], /Distill\.codes effort setting: high/);
  assert.match(messages[5], /Result: Direct passed; Distill\.codes passed/);
  assert.equal(messages[6], "Report: /tmp/bench/report.md");
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
