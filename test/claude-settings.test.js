import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clearBaseURL, disableProxy, enableProxy, readSettings } from "../src/claude-settings.js";

test("enable writes distill URL and full backup", async () => {
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const claudeDir = join(home, ".claude");
  await writeJSON(join(claudeDir, "settings.json"), {
    theme: "dark",
    env: {
      ANTHROPIC_BASE_URL: "https://example.com/custom",
      KEEP_ME: "yes"
    }
  });

  await enableProxy("https://proxy.distill.codes/key123456/essential/anthropic", {
    home,
    preflight: async () => {}
  });

  assert.deepEqual(await readJSON(join(claudeDir, "settings.json")), {
    theme: "dark",
    env: {
      ANTHROPIC_BASE_URL: "https://proxy.distill.codes/key123456/essential/anthropic",
      KEEP_ME: "yes"
    }
  });
  assert.deepEqual(await readJSON(join(claudeDir, "settings.distill-codes-backup.json")), {
    theme: "dark",
    env: {
      ANTHROPIC_BASE_URL: "https://example.com/custom",
      KEEP_ME: "yes"
    }
  });
});

test("enable rejects a non-Distill URL before preflight or settings writes", async () => {
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const settings = join(home, ".claude", "settings.json");
  await writeJSON(settings, { env: { KEEP_ME: "yes" } });
  let preflightCalled = false;

  await assert.rejects(
    enableProxy("https://attacker.example/key123456/essential/anthropic", {
      home,
      preflight: async () => {
        preflightCalled = true;
      }
    }),
    /distill\.codes host/
  );

  assert.equal(preflightCalled, false);
  assert.deepEqual(await readJSON(settings), { env: { KEEP_ME: "yes" } });
  await assert.rejects(readFile(join(home, ".claude", "settings.distill-codes-backup.json")), { code: "ENOENT" });
});

test("enable rejects array settings before preflight, backup, or write", async () => {
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const settings = join(home, ".claude", "settings.json");
  const original = [];
  await writeJSON(settings, original);
  let preflightCalled = false;

  await assert.rejects(
    enableProxy("https://proxy.distill.codes/key123456/essential/anthropic", {
      home,
      preflight: async () => {
        preflightCalled = true;
      }
    }),
    /JSON root.*object/
  );

  assert.equal(preflightCalled, false);
  assert.deepEqual(await readJSON(settings), original);
  await assert.rejects(readFile(join(home, ".claude", "settings.distill-codes-backup.json")), { code: "ENOENT" });
});

test("readSettings rejects non-object JSON roots", async () => {
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const settings = join(home, ".claude", "settings.json");

  await writeJSON(settings, null);

  await assert.rejects(readSettings(settings), /JSON root.*object/);
});

test("disable restores only previous ANTHROPIC_BASE_URL", async () => {
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const claudeDir = join(home, ".claude");
  await writeJSON(join(claudeDir, "settings.json"), {
    theme: "light",
    env: {
      ANTHROPIC_BASE_URL: "https://proxy.distill.codes/key123456/essential/anthropic",
      AFTER_ENABLE: "preserve"
    }
  });
  await writeJSON(join(claudeDir, "settings.distill-codes-backup.json"), {
    theme: "dark",
    env: {
      ANTHROPIC_BASE_URL: "https://example.com/custom",
      BEFORE_ENABLE: "backup-only"
    }
  });

  const result = await disableProxy({ home });

  assert.equal(result.changed, true);
  assert.deepEqual(await readJSON(join(claudeDir, "settings.json")), {
    theme: "light",
    env: {
      ANTHROPIC_BASE_URL: "https://example.com/custom",
      AFTER_ENABLE: "preserve"
    }
  });
});

test("disable leaves non-distill URL unchanged", async () => {
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const settings = join(home, ".claude", "settings.json");
  await writeJSON(settings, { env: { ANTHROPIC_BASE_URL: "https://example.com/custom" } });

  const result = await disableProxy({ home });

  assert.equal(result.changed, false);
  assert.deepEqual(await readJSON(settings), { env: { ANTHROPIC_BASE_URL: "https://example.com/custom" } });
});

test("clear-base-url removes any configured base URL", async () => {
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const settings = join(home, ".claude", "settings.json");
  await writeJSON(settings, { env: { ANTHROPIC_BASE_URL: "https://example.com/custom", KEEP_ME: "yes" } });

  const result = await clearBaseURL({ home });

  assert.equal(result.changed, true);
  assert.deepEqual(await readJSON(settings), { env: { KEEP_ME: "yes" } });
});

async function writeJSON(file, value) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJSON(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
