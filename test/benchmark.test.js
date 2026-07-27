import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderConsoleSummary, runBenchmark } from "../src/benchmark.js";

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

  assert.deepEqual(planned, {
    model: "Claude Code default",
    effort: "Claude Code default"
  });
  assert.deepEqual(startedRuns, ["direct", "distill"]);
  assert.equal(report.runs.direct.ok, true);
  assert.equal(report.runs.distill.ok, true);
  assert.equal(report.runs.direct.proxy_enabled, false);
  assert.equal(report.runs.distill.proxy_enabled, true);
  assert.equal(report.runs.direct.usage.output_tokens, 100);
  assert.equal(report.runs.distill.usage.output_tokens, 60);
  assert.deepEqual(report.runs.direct.models, ["fake-claude"]);
  assert.equal(report.runs.direct.reasoning_effort, "Claude Code default");
  assert.equal(report.runs.direct.primary_model.context_window, 1_000_000);
  assert.equal(report.runs.direct.primary_model.cache_read_input_tokens, 900);
  assert.equal(report.runs.direct.primary_model.anthropic_reported_cost_usd, 0.842);
  assert.deepEqual(report.runs.direct.usage, {
    input_tokens: 10,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 900,
    output_tokens: 100
  });
  assert.deepEqual(report.runs.direct.stream, { events: 2, invalid_lines: 0 });
  assert.equal(report.runs.direct.turns, 10);
  assert.equal(report.anthropic_reported_cost.source, "claude_code_total_cost_usd");
  assert.equal(report.anthropic_reported_cost.visibility, "report_json_only");
  assert.equal(report.comparison.comparable, true);
  assert.deepEqual(report.comparison.output_tokens, { direct: 100, distill: 60, delta: -40, percent: -40 });
  assert.deepEqual(report.comparison.cache_read_input_tokens, { direct: 900, distill: 900, delta: 0, percent: 0 });
  assert.deepEqual(report.comparison.anthropic_reported_cost_usd, { direct: 0.842, distill: 0.487, delta: -0.355, percent: -42.2 });
  assert.deepEqual(report.comparison.turns, { direct: 10, distill: 8, delta: -2, percent: -20 });
  const markdown = await readFile(join(runRoot, "report.md"), "utf8");
  assert.match(markdown, /\| Output tokens \| 100 \| 60 \| -40 \| -40\.0% \|/);
  assert.doesNotMatch(markdown, /Reported cost|total_cost_usd|\$0\.842|\$0\.487/);
  assert.match(markdown, /Anthropic-reported costs are available in report\.json for reference/);
  assert.match(markdown, /Run the benchmark several times for more stable results/);
  assert.match(markdown, /\| Turns \| 10 \| 8 \| -2 \| -20\.0% \|/);
  assert.match(markdown, /\| Direct \| fake-claude \| 1,000,000 \| 64,000 \| fake-claude \| Claude Code default \| not reported \|/);
  const consoleSummary = renderConsoleSummary(report);
  assert.match(consoleSummary, /Output tokens/);
  assert.doesNotMatch(consoleSummary, /cost|USD|\$0\.842|\$0\.487/i);
  assert.match(await readFile(join(runRoot, "share.md"), "utf8"), /Nothing was uploaded by the CLI/);
  await assertPrivateArtifacts(runRoot);

  const directSettings = JSON.parse(await readFile(join(runRoot, "direct", "seen-settings.json"), "utf8"));
  const distillSettings = JSON.parse(await readFile(join(runRoot, "distill", "seen-settings.json"), "utf8"));
  const directEnv = JSON.parse(await readFile(join(runRoot, "direct", "seen-env.json"), "utf8"));
  const distillEnv = JSON.parse(await readFile(join(runRoot, "distill", "seen-env.json"), "utf8"));
  const directArgs = JSON.parse(await readFile(join(runRoot, "direct", "seen-args.json"), "utf8"));
  const distillArgs = JSON.parse(await readFile(join(runRoot, "distill", "seen-args.json"), "utf8"));
  assert.equal(directSettings.env.ANTHROPIC_BASE_URL, "");
  assert.equal(distillSettings.env.ANTHROPIC_BASE_URL, "https://proxy.distill.codes/key123456/essential/anthropic");
  assert.equal(directSettings.disableAllHooks, true);
  assert.equal(distillSettings.disableAllHooks, true);
  assert.equal(directSettings.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.equal(distillSettings.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.equal(directSettings.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
  assert.equal(distillSettings.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
  assert.equal(directEnv.ANTHROPIC_BASE_URL, null);
  assert.equal(distillEnv.ANTHROPIC_BASE_URL, "https://proxy.distill.codes/key123456/essential/anthropic");
  assert.equal(permissionMode(directArgs), "acceptEdits");
  assert.equal(permissionMode(distillArgs), "acceptEdits");
  assert.equal(optionValue(directArgs, "--setting-sources"), "user");
  assert.equal(optionValue(distillArgs, "--setting-sources"), "user");
  assert.equal(optionValue(directArgs, "--output-format"), "stream-json");
  assert.equal(optionValue(distillArgs, "--output-format"), "stream-json");
  assert.equal(directArgs.includes("--verbose"), true);
  assert.equal(distillArgs.includes("--verbose"), true);
  assert.match(optionValue(directArgs, "--name"), /^distill-codes-benchmark-direct-\d{4}-\d{2}-\d{2}T/);
  assert.match(optionValue(distillArgs, "--name"), /^distill-codes-benchmark-distill-\d{4}-\d{2}-\d{2}T/);
  assert.equal(
    optionValue(directArgs, "--name").replace("-direct-", "-"),
    optionValue(distillArgs, "--name").replace("-distill-", "-")
  );
  assert.equal(directArgs.includes("--model"), false);
  assert.equal(directArgs.includes("--effort"), false);
  assert.equal(distillArgs.includes("--model"), false);
  assert.equal(distillArgs.includes("--effort"), false);
});

test("benchmark preserves configured model and effort without CLI overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "distill-bench-"));
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const fakeClaude = join(root, "fake-claude.mjs");
  await writeFile(fakeClaude, fakeClaudeSource());
  await chmod(fakeClaude, 0o755);
  await writeJSON(join(home, ".claude", "settings.json"), {
    model: "sonnet[1m]",
    effortLevel: "high",
    env: {
      KEEP_ME: "yes"
    }
  });

  let planned;
  const { runRoot } = await runBenchmark({
    home,
    proxyURL: "https://proxy.distill.codes/key123456/essential/anthropic",
    claudeBin: fakeClaude,
    outputDir: join(root, "out"),
    timeoutMs: 10_000,
    onPlan: (value) => {
      planned = value;
    }
  });

  assert.deepEqual(planned, { model: "sonnet[1m]", effort: "high" });
  for (const name of ["direct", "distill"]) {
    const args = JSON.parse(await readFile(join(runRoot, name, "seen-args.json"), "utf8"));
    const settings = JSON.parse(await readFile(join(runRoot, name, "seen-settings.json"), "utf8"));
    assert.equal(args.includes("--model"), false);
    assert.equal(args.includes("--effort"), false);
    assert.equal(settings.model, undefined);
    assert.equal(settings.effortLevel, undefined);
    assert.equal(settings.env.KEEP_ME, "yes");
    assert.equal(settings.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
    assert.equal(settings.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
    assert.equal(settings.disableAllHooks, true);
    assert.equal(optionValue(args, "--setting-sources"), "user");
  }
});

test("benchmark totals usage across multiple reported models", async () => {
  const root = await mkdtemp(join(tmpdir(), "distill-bench-"));
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const fakeClaude = join(root, "fake-claude.mjs");
  await writeFile(fakeClaude, fakeClaudeSource({ directOutputOffset: 5, distillOutputOffset: 7 }));
  await chmod(fakeClaude, 0o755);

  const { report } = await runBenchmark({
    home,
    proxyURL: "https://proxy.distill.codes/key123456/essential/anthropic",
    claudeBin: fakeClaude,
    outputDir: join(root, "out"),
    timeoutMs: 10_000
  });

  assert.deepEqual(report.runs.direct.usage, {
    input_tokens: 13,
    cache_creation_input_tokens: 24,
    cache_read_input_tokens: 905,
    output_tokens: 105
  });
  assert.deepEqual(report.runs.distill.usage, {
    input_tokens: 13,
    cache_creation_input_tokens: 24,
    cache_read_input_tokens: 905,
    output_tokens: 67
  });
  assert.deepEqual(report.runs.direct.models, ["fake-claude", "fake-helper"]);
  assert.deepEqual(report.comparison.output_tokens, { direct: 105, distill: 67, delta: -38, percent: -36.2 });
});

test("benchmark passes explicit command overrides", async () => {
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
    permissionMode: "bypassPermissions",
    model: "opus[1m]",
    effort: "high"
  });

  const directArgs = JSON.parse(await readFile(join(runRoot, "direct", "seen-args.json"), "utf8"));
  const distillArgs = JSON.parse(await readFile(join(runRoot, "distill", "seen-args.json"), "utf8"));
  assert.equal(permissionMode(directArgs), "bypassPermissions");
  assert.equal(permissionMode(distillArgs), "bypassPermissions");
  assert.equal(optionValue(directArgs, "--model"), "opus[1m]");
  assert.equal(optionValue(distillArgs, "--model"), "opus[1m]");
  assert.equal(optionValue(directArgs, "--effort"), "high");
  assert.equal(optionValue(distillArgs, "--effort"), "high");
});

test("benchmark suppresses deltas when runtime contexts differ", async () => {
  const root = await mkdtemp(join(tmpdir(), "distill-bench-"));
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const fakeClaude = join(root, "fake-claude.mjs");
  await writeFile(fakeClaude, fakeClaudeSource({ distillContextWindow: 200_000 }));
  await chmod(fakeClaude, 0o755);

  const { runRoot, report } = await runBenchmark({
    home,
    proxyURL: "https://proxy.distill.codes/key123456/essential/anthropic",
    claudeBin: fakeClaude,
    outputDir: join(root, "out"),
    timeoutMs: 10_000
  });

  assert.equal(report.comparison.comparable, false);
  assert.deepEqual(report.comparison.reasons, ["context windows differ (1,000,000 vs 200,000)"]);
  assert.deepEqual(report.comparison.output_tokens, { direct: 100, distill: 60, delta: null, percent: null });
  const markdown = await readFile(join(runRoot, "report.md"), "utf8");
  assert.match(markdown, /Comparison: not comparable \(context windows differ \(1,000,000 vs 200,000\)\)/);
  assert.match(markdown, /\| Output tokens \| 100 \| 60 \| n\/a \| n\/a \|/);
  assert.match(renderConsoleSummary(report), /Comparison: not comparable/);
});

test("benchmark handles a successful stream without model usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "distill-bench-"));
  const home = await mkdtemp(join(tmpdir(), "distill-home-"));
  const fakeClaude = join(root, "fake-claude.mjs");
  await writeFile(fakeClaude, fakeClaudeSource({ omitModelUsage: true }));
  await chmod(fakeClaude, 0o755);

  const { runRoot, report } = await runBenchmark({
    home,
    proxyURL: "https://proxy.distill.codes/key123456/essential/anthropic",
    claudeBin: fakeClaude,
    outputDir: join(root, "out"),
    timeoutMs: 10_000
  });

  assert.equal(report.runs.direct.ok, true);
  assert.deepEqual(report.runs.direct.usage, {
    input_tokens: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    output_tokens: null
  });
  assert.equal(report.runs.direct.anthropic_reported_cost_usd, 0.842);
  assert.equal(report.comparison.comparable, false);
  assert.deepEqual(report.comparison.output_tokens, { direct: null, distill: null, delta: null, percent: null });
  assert.match(await readFile(join(runRoot, "report.md"), "utf8"), /\| Output tokens \| n\/a \| n\/a \| n\/a \| n\/a \|/);
  assert.match(renderConsoleSummary(report), /not comparable/);
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
  return optionValue(args, "--permission-mode");
}

function optionValue(args, name) {
  return args[args.indexOf(name) + 1];
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

function fakeClaudeSource(options = {}) {
  const directContextWindow = options.directContextWindow ?? 1_000_000;
  const distillContextWindow = options.distillContextWindow ?? 1_000_000;
  const directOutputOffset = options.directOutputOffset ?? 0;
  const distillOutputOffset = options.distillOutputOffset ?? 0;
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const settingsFile = process.argv[process.argv.indexOf("--settings") + 1];
const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
writeFileSync(join(process.cwd(), "seen-settings.json"), JSON.stringify(settings, null, 2));
writeFileSync(join(process.cwd(), "seen-env.json"), JSON.stringify({ ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? null }, null, 2));
writeFileSync(join(process.cwd(), "seen-args.json"), JSON.stringify(process.argv.slice(2), null, 2));
writeFileSync(join(process.cwd(), "scan-secrets.mjs"), scannerSource());
const isDistill = settings.env?.ANTHROPIC_BASE_URL?.includes("distill.codes");
const outputTokens = isDistill ? 60 : 100;
const helperOutputTokens = isDistill ? ${distillOutputOffset} : ${directOutputOffset};
const includeHelper = helperOutputTokens > 0;
const modelUsage = {
  "fake-claude": {
    canonicalModel: "fake-claude",
    contextWindow: isDistill ? ${distillContextWindow} : ${directContextWindow},
    maxOutputTokens: 64000,
    inputTokens: 10,
    cacheCreationInputTokens: 20,
    cacheReadInputTokens: 900,
    outputTokens,
    costUSD: includeHelper ? (isDistill ? 0.45 : 0.8) : (isDistill ? 0.487 : 0.842),
    provider: "firstParty"
  }
};
if (includeHelper) {
  modelUsage["fake-helper"] = {
    canonicalModel: "fake-helper",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputTokens: 3,
    cacheCreationInputTokens: 4,
    cacheReadInputTokens: 5,
    outputTokens: helperOutputTokens,
    costUSD: isDistill ? 0.037 : 0.042,
    provider: "firstParty"
  };
}
console.log(JSON.stringify({ type: "system", subtype: "init", model: "fake-claude" }));
const benchmarkResult = {
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: isDistill ? 8 : 10,
  total_cost_usd: isDistill ? 0.487 : 0.842,
  usage: { input_tokens: 1000, output_tokens: outputTokens }
};
if (!${Boolean(options.omitModelUsage)}) {
  benchmarkResult.modelUsage = modelUsage;
}
console.log(JSON.stringify(benchmarkResult));

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

async function writeJSON(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
