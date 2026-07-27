import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBenchmark } from "../src/benchmark.js";

test("benchmark uses acceptEdits by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "distill-bench-"));
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const fakeClaude = join(root, "fake-claude.mjs");
  await writeFile(fakeClaude, fakeClaudeSource());
  await chmod(fakeClaude, 0o755);

  let planned;
  const startedRuns = [];
  const { runRoot, report } = await runBenchmark({
    home,
    proxyURL: "https://proxy.distill.codes/key123456/essential/anthropic",
    claudeBin: fakeClaude,
    outputDir: join(root, "out"),
    timeoutMs: 10_000,
    share: true,
    onPlan: (value) => {
      planned = value;
    },
    onRunStart: (name) => {
      startedRuns.push(name);
    }
  });

  assert.equal(planned.model, "default/unknown");
  assert.deepEqual(startedRuns, ["direct", "distill"]);
  assert.equal(report.runs.direct.ok, true);
  assert.equal(report.runs.distill.ok, true);
  assert.equal(report.runs.direct.usage.output_tokens, 100);
  assert.equal(report.runs.distill.usage.output_tokens, 60);
  assert.equal(report.comparison.output_tokens_delta, -40);
  assert.match(await readFile(join(runRoot, "report.md"), "utf8"), /Distill\.codes Benchmark Report/);
  assert.match(await readFile(join(runRoot, "share.md"), "utf8"), /Nothing was uploaded by the CLI/);
  await assertPrivateArtifacts(runRoot);

  const directSettings = JSON.parse(await readFile(join(runRoot, "direct", "seen-settings.json"), "utf8"));
  const distillSettings = JSON.parse(await readFile(join(runRoot, "distill", "seen-settings.json"), "utf8"));
  const directArgs = JSON.parse(await readFile(join(runRoot, "direct", "seen-args.json"), "utf8"));
  const distillArgs = JSON.parse(await readFile(join(runRoot, "distill", "seen-args.json"), "utf8"));
  assert.equal(directSettings.env.ANTHROPIC_BASE_URL, "");
  assert.equal(distillSettings.env.ANTHROPIC_BASE_URL, "https://proxy.distill.codes/key123456/essential/anthropic");
  assert.equal(permissionMode(directArgs), "acceptEdits");
  assert.equal(permissionMode(distillArgs), "acceptEdits");
});

test("benchmark passes an explicit bypassPermissions override", async () => {
  const root = await mkdtemp(join(tmpdir(), "distill-bench-"));
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const fakeClaude = join(root, "fake-claude.mjs");
  await writeFile(fakeClaude, fakeClaudeSource());
  await chmod(fakeClaude, 0o755);

  const { runRoot } = await runBenchmark({
    home,
    proxyURL: "https://proxy.distill.codes/key123456/essential/anthropic",
    claudeBin: fakeClaude,
    outputDir: join(root, "out"),
    timeoutMs: 10_000,
    permissionMode: "bypassPermissions"
  });

  const directArgs = JSON.parse(await readFile(join(runRoot, "direct", "seen-args.json"), "utf8"));
  const distillArgs = JSON.parse(await readFile(join(runRoot, "distill", "seen-args.json"), "utf8"));
  assert.equal(permissionMode(directArgs), "bypassPermissions");
  assert.equal(permissionMode(distillArgs), "bypassPermissions");
});

test("benchmark records failed Claude runs and persists diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "distill-bench-"));
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const fakeClaude = join(root, "failing-claude.mjs");
  await writeFile(fakeClaude, "#!/usr/bin/env node\nconsole.error('intentional Claude failure');\nprocess.exit(17);\n");
  await chmod(fakeClaude, 0o755);

  const { runRoot, report } = await runBenchmark({
    home,
    proxyURL: "https://proxy.distill.codes/key123456/essential/anthropic",
    claudeBin: fakeClaude,
    outputDir: join(root, "out"),
    timeoutMs: 10_000
  });

  assert.deepEqual(Object.values(report.runs).map(({ ok, exit_status }) => [ok, exit_status]), [[false, 17], [false, 17]]);
  const persisted = JSON.parse(await readFile(join(runRoot, "report.json"), "utf8"));
  assert.deepEqual(Object.values(persisted.runs).map(({ ok, exit_status }) => [ok, exit_status]), [[false, 17], [false, 17]]);
  assert.equal(await readFile(join(runRoot, "direct.stderr.log"), "utf8"), "intentional Claude failure\n");
  assert.equal(await readFile(join(runRoot, "distill.stderr.log"), "utf8"), "intentional Claude failure\n");
});

function permissionMode(args) {
  return args[args.indexOf("--permission-mode") + 1];
}

async function assertPrivateArtifacts(runRoot) {
  for (const directory of [
    runRoot,
    join(runRoot, "direct"),
    join(runRoot, "distill"),
    join(runRoot, "direct", ".distill-verify"),
    join(runRoot, "distill", ".distill-verify")
  ]) {
    assert.equal((await stat(directory)).mode & 0o777, 0o700, directory);
  }
  for (const file of [
    "prompt.txt",
    "direct/TASK.md",
    "distill/TASK.md",
    "direct.stdout.log",
    "direct.stderr.log",
    "distill.stdout.log",
    "distill.stderr.log",
    "report.json",
    "report.md",
    "share.md"
  ]) {
    assert.equal((await stat(join(runRoot, file))).mode & 0o777, 0o600, file);
  }
}

function fakeClaudeSource() {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const settingsFile = process.argv[process.argv.indexOf("--settings") + 1];
const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
writeFileSync(join(process.cwd(), "seen-settings.json"), JSON.stringify(settings, null, 2));
writeFileSync(join(process.cwd(), "seen-args.json"), JSON.stringify(process.argv.slice(2), null, 2));
writeFileSync(join(process.cwd(), "scan-secrets.mjs"), scannerSource());
const isDistill = settings.env?.ANTHROPIC_BASE_URL?.includes("distill.codes");
console.log(JSON.stringify({ model: "fake-claude", usage: { input_tokens: 1000, output_tokens: isDistill ? 60 : 100 } }));

function scannerSource() {
  return \`#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2];
const findings = [];
walk(root);
console.log(JSON.stringify({ findings }));

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    const lines = readFileSync(file, "utf8").split(/\\\\r?\\\\n/);
    lines.forEach((line, index) => {
      if (/AKIA[A-Z0-9]{16}/.test(line)) findings.push({ file: relative(root, file), type: "aws_access_key_id", line: index + 1, match: line });
      if (/sk-[A-Za-z0-9_-]{20,}/.test(line)) findings.push({ file: relative(root, file), type: "openai_api_key", line: index + 1, match: line });
      if (/(API_KEY|SECRET|TOKEN|PASSWORD).*=[^\\\\n]{8,}/.test(line)) findings.push({ file: relative(root, file), type: "generic_secret", line: index + 1, match: line });
    });
  }
}
\`;
}
`;
}
