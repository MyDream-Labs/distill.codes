import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Table from "cli-table3";
import { configurationForTemporarySettings, writeTemporarySettings } from "./claude-settings.js";
import { redactProxyURL } from "./proxy-url.js";

const DEFAULT_PROMPT = `You are in a fresh directory. Implement a minimal Node.js CLI secret scanner.

Create scan-secrets.mjs. It must run as:
node scan-secrets.mjs <directory>

Output only JSON to stdout:
{"findings":[{"file":"relative/path","type":"aws_access_key_id|openai_api_key|generic_secret","line":1,"match":"..."}]}

Detect:
- AWS access key IDs: AKIA or ASIA followed by 16 uppercase letters/digits
- OpenAI-like API keys: sk- followed by at least 20 letters, digits, underscores, or hyphens
- generic secret assignments: names containing API_KEY, SECRET, TOKEN, or PASSWORD with value length at least 8

Ignore node_modules, .git, binary files, and scan-secrets.mjs itself.
Keep the implementation compact and dependency-free.`;

const SONNET_WARNING =
  "WARNING: Sonnet is not recommended for this benchmark because its Distill.codes gains are typically small and unstable. Use Fable or Opus with xhigh effort for a stronger, more reliable signal.";

export async function runBenchmark(options) {
  const startedAt = new Date();
  const outputRoot = options.outputDir ?? join(process.cwd(), "distill-codes-bench");
  const runID = timestamp(startedAt);
  const runRoot = join(outputRoot, runID);
  const prompt = options.promptFile ? await readFile(options.promptFile, "utf8") : DEFAULT_PROMPT;
  const customPrompt = Boolean(options.promptFile);

  await makePrivateDir(outputRoot);
  await makePrivateDir(runRoot);
  await writePrivateFile(join(runRoot, "prompt.txt"), prompt);

  const configuration = await configurationForTemporarySettings(options.home);
  const baseEnv = configuration.env;
  const planned = {
    model: options.model ?? baseEnv.ANTHROPIC_MODEL ?? configuration.model ?? "Claude Code default",
    effort: options.effort ?? baseEnv.CLAUDE_CODE_EFFORT_LEVEL ?? configuration.effort ?? "Claude Code default"
  };
  options.onPlan?.(planned);

  const direct = await runCase({
    name: "direct",
    runRoot,
    prompt,
    proxyURL: "",
    env: isolatedBenchmarkEnv(baseEnv, ""),
    options,
    planned,
    customPrompt,
    sessionName: `distill-codes-benchmark-direct-${runID}`
  });
  const distill = await runCase({
    name: "distill",
    runRoot,
    prompt,
    proxyURL: options.proxyURL,
    env: isolatedBenchmarkEnv(baseEnv, options.proxyURL),
    options,
    planned,
    customPrompt,
    sessionName: `distill-codes-benchmark-distill-${runID}`
  });

  const report = {
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    task: customPrompt ? "custom" : "secret-scanner",
    prompt_file: options.promptFile ?? null,
    proxy_url: redactProxyURL(options.proxyURL),
    planned,
    anthropic_reported_cost: {
      source: "claude_code_total_cost_usd",
      visibility: "report_json_only",
      note: "Reference only. This cache-dependent Claude Code estimate may not match API billing or a subscription charge."
    },
    runs: { direct, distill },
    comparison: compareRuns(direct, distill)
  };

  await writePrivateFile(join(runRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writePrivateFile(join(runRoot, "report.md"), renderMarkdown(report));
  const sharePath = options.share ? join(runRoot, "share.md") : null;
  if (sharePath) {
    await writePrivateFile(sharePath, renderShareMarkdown(report));
  }
  return { runRoot, report, sharePath };
}

async function runCase({ name, runRoot, prompt, proxyURL, env, options, planned, customPrompt, sessionName }) {
  const workdir = join(runRoot, name);
  await makePrivateDir(workdir);
  await writePrivateFile(join(workdir, "TASK.md"), prompt);

  const tempDir = await mkdtemp(join(tmpdir(), "distill-codes-"));
  const settingsFile = join(tempDir, "settings.json");
  await writeTemporarySettings(settingsFile, env);

  const args = [
    "-p",
    "--setting-sources",
    "user",
    "--output-format",
    "stream-json",
    "--verbose",
    "--name",
    sessionName,
    "--no-session-persistence",
    "--permission-mode",
    options.permissionMode ?? "acceptEdits",
    "--settings",
    settingsFile
  ];
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }
  args.push(prompt);

  const startedAt = Date.now();
  options.onRunStart?.(name);
  const result = await runCommand(options.claudeBin ?? "claude", args, {
    cwd: workdir,
    timeoutMs: options.timeoutMs ?? 30 * 60 * 1000,
    baseURL: env.ANTHROPIC_BASE_URL
  });
  await rm(tempDir, { recursive: true, force: true });

  await writePrivateFile(join(runRoot, `${name}.stdout.log`), result.stdout);
  await writePrivateFile(join(runRoot, `${name}.stderr.log`), result.stderr);

  const stream = parseJSONStream(result.stdout);
  const parsed = stream.result;
  const verifier = customPrompt ? { ok: null, mode: "manual", message: "Custom prompt verification is manual." } : await verifySecretScanner(workdir);
  const files = await collectFiles(workdir);
  const modelUsage = extractModelUsage(parsed);
  const primaryModel = selectPrimaryModel(modelUsage);
  const models = [...new Set(modelUsage.map(({ canonical_model }) => canonical_model))];
  const usage = aggregateModelUsage(modelUsage);
  const claudeSucceeded = parsed?.type === "result" && parsed.subtype === "success" && parsed.is_error !== true;

  return {
    name,
    session_name: sessionName,
    proxy_url: proxyURL ? redactProxyURL(proxyURL) : null,
    proxy_enabled: Boolean(proxyURL),
    ok: result.status === 0 && claudeSucceeded && verifier.ok !== false,
    exit_status: result.status,
    stream: {
      events: stream.events.length,
      invalid_lines: stream.invalidLines
    },
    duration_ms: Date.now() - startedAt,
    model: models.join(", ") || options.model || "not reported",
    models,
    model_usage: modelUsage,
    primary_model: primaryModel,
    reasoning_effort: planned.effort,
    speed: findFirstKey(stream.events, ["speed"]),
    turns: findFirstNumber(parsed, ["num_turns", "numTurns"]),
    usage,
    anthropic_reported_cost_usd: findFirstNumber(parsed, ["total_cost_usd", "totalCostUsd"]),
    verifier,
    files: files.length,
    loc: await countLOC(files),
    stdout_log: `${name}.stdout.log`,
    stderr_log: `${name}.stderr.log`
  };
}

function isolatedBenchmarkEnv(baseEnv, baseURL) {
  return {
    ...baseEnv,
    ANTHROPIC_BASE_URL: baseURL,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1"
  };
}

async function runCommand(command, args, options) {
  return await new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_BASE_URL;
    if (options.baseURL) {
      env.ANTHROPIC_BASE_URL = options.baseURL;
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: 127, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function verifySecretScanner(workdir) {
  const scanner = join(workdir, "scan-secrets.mjs");
  const fixture = join(workdir, ".distill-verify");
  await makePrivateDir(fixture);
  await writePrivateFile(
    join(fixture, "secrets.txt"),
    [
      "AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF",
      "OPENAI_API_KEY=sk-1234567890abcdefghijklmnop",
      "DATABASE_PASSWORD=correct-horse-battery-staple"
    ].join("\n")
  );
  await writePrivateFile(join(fixture, "safe.txt"), "nothing secret here\n");

  const result = await runCommand(process.execPath, [scanner, fixture], { cwd: workdir, timeoutMs: 10_000 });
  if (result.status !== 0) {
    return { ok: false, mode: "automatic", message: `scanner exited ${result.status}`, stderr: result.stderr };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, mode: "automatic", message: "scanner output is not JSON", stdout: result.stdout };
  }
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const types = new Set(findings.map((finding) => finding.type));
  const missing = ["aws_access_key_id", "openai_api_key", "generic_secret"].filter((type) => !types.has(type));
  return {
    ok: missing.length === 0,
    mode: "automatic",
    findings: findings.length,
    missing
  };
}

async function collectFiles(root, dir = root, output = []) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".distill-verify" || entry.name === "TASK.md") {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, path, output);
    } else {
      output.push(path);
    }
  }
  return output;
}

async function countLOC(files) {
  let total = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    total += text.split(/\r?\n/).filter((line) => line.trim()).length;
  }
  return total;
}

async function makePrivateDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function writePrivateFile(path, contents) {
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
}

function parseJSONStream(stdout) {
  const events = [];
  let invalidLines = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      events.push(JSON.parse(line));
    } catch {
      invalidLines++;
    }
  }
  const result = events.findLast((event) => event?.type === "result") ?? null;
  return { events, invalidLines, result };
}

function findFirstKey(value, keys) {
  if (!value || typeof value !== "object") {
    return null;
  }
  for (const key of keys) {
    if (typeof value[key] === "string") {
      return value[key];
    }
  }
  for (const child of Object.values(value)) {
    const found = Array.isArray(child) ? child.map((item) => findFirstKey(item, keys)).find(Boolean) : findFirstKey(child, keys);
    if (found) {
      return found;
    }
  }
  return null;
}

function findFirstNumber(value, keys) {
  if (!value || typeof value !== "object") {
    return null;
  }
  for (const key of keys) {
    if (typeof value[key] === "number" && Number.isFinite(value[key])) {
      return value[key];
    }
  }
  for (const child of Object.values(value)) {
    const found = Array.isArray(child) ? child.map((item) => findFirstNumber(item, keys)).find((item) => item != null) : findFirstNumber(child, keys);
    if (found != null) {
      return found;
    }
  }
  return null;
}

function extractModelUsage(value) {
  const modelUsage = findFirstObject(value, "modelUsage");
  if (!modelUsage) {
    return [];
  }
  return Object.entries(modelUsage).map(([model, usage]) => ({
    model,
    canonical_model: usage?.canonicalModel ?? model,
    context_window: usage?.contextWindow ?? null,
    max_output_tokens: usage?.maxOutputTokens ?? null,
    input_tokens: usage?.inputTokens ?? null,
    cache_creation_input_tokens: usage?.cacheCreationInputTokens ?? null,
    cache_read_input_tokens: usage?.cacheReadInputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    anthropic_reported_cost_usd: usage?.costUSD ?? null,
    provider: usage?.provider ?? null
  }));
}

function selectPrimaryModel(modelUsage) {
  return modelUsage.toSorted((left, right) => (right.output_tokens ?? 0) - (left.output_tokens ?? 0))[0] ?? null;
}

function aggregateModelUsage(modelUsage) {
  return {
    input_tokens: sumModelMetric(modelUsage, "input_tokens"),
    cache_creation_input_tokens: sumModelMetric(modelUsage, "cache_creation_input_tokens"),
    cache_read_input_tokens: sumModelMetric(modelUsage, "cache_read_input_tokens"),
    output_tokens: sumModelMetric(modelUsage, "output_tokens")
  };
}

function sumModelMetric(modelUsage, key) {
  const values = modelUsage.map((usage) => usage[key]).filter((value) => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function findFirstObject(value, key) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) {
    return value[key];
  }
  for (const child of Object.values(value)) {
    const found = Array.isArray(child) ? child.map((item) => findFirstObject(item, key)).find(Boolean) : findFirstObject(child, key);
    if (found) {
      return found;
    }
  }
  return null;
}

function compareRuns(direct, distill) {
  const compatibility = compareRuntime(direct, distill);
  return {
    ...compatibility,
    input_tokens: compareMetric(direct.usage?.input_tokens, distill.usage?.input_tokens, compatibility.comparable),
    cache_creation_input_tokens: compareMetric(
      direct.usage?.cache_creation_input_tokens,
      distill.usage?.cache_creation_input_tokens,
      compatibility.comparable
    ),
    cache_read_input_tokens: compareMetric(
      direct.usage?.cache_read_input_tokens,
      distill.usage?.cache_read_input_tokens,
      compatibility.comparable
    ),
    output_tokens: compareMetric(direct.usage?.output_tokens, distill.usage?.output_tokens, compatibility.comparable),
    duration_ms: compareMetric(direct.duration_ms, distill.duration_ms, compatibility.comparable),
    turns: compareMetric(direct.turns, distill.turns, compatibility.comparable),
    loc: compareMetric(direct.loc, distill.loc, compatibility.comparable),
    files: compareMetric(direct.files, distill.files, compatibility.comparable),
    anthropic_reported_cost_usd: compareMetric(
      direct.anthropic_reported_cost_usd,
      distill.anthropic_reported_cost_usd,
      compatibility.comparable
    )
  };
}

function compareRuntime(direct, distill) {
  const directModel = direct.primary_model;
  const distillModel = distill.primary_model;
  const reasons = [];
  if (!directModel || !distillModel) {
    reasons.push("primary model was not reported by Claude Code");
  } else {
    if (directModel.canonical_model !== distillModel.canonical_model) {
      reasons.push(`primary models differ (${directModel.canonical_model} vs ${distillModel.canonical_model})`);
    }
    if (directModel.context_window == null || distillModel.context_window == null) {
      reasons.push("context window was not reported by Claude Code");
    } else if (directModel.context_window !== distillModel.context_window) {
      reasons.push(`context windows differ (${formatInteger(directModel.context_window)} vs ${formatInteger(distillModel.context_window)})`);
    }
    if (directModel.max_output_tokens == null || distillModel.max_output_tokens == null) {
      reasons.push("max output tokens were not reported by Claude Code");
    } else if (directModel.max_output_tokens !== distillModel.max_output_tokens) {
      reasons.push(`max output tokens differ (${formatInteger(directModel.max_output_tokens)} vs ${formatInteger(distillModel.max_output_tokens)})`);
    }
  }
  return { comparable: reasons.length === 0, reasons };
}

function compareMetric(direct, distill, comparable) {
  if (!comparable || direct == null || distill == null) {
    return { direct: direct ?? null, distill: distill ?? null, delta: null, percent: null };
  }
  const delta = distill - direct;
  return {
    direct,
    distill,
    delta,
    percent: direct === 0 ? null : roundToOneDecimal((delta / direct) * 100)
  };
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function renderMarkdown(report) {
  return `# Distill.codes Benchmark Report

- Task: ${report.task}
- Proxy: ${report.proxy_url}
- Started: ${report.started_at}
- Comparison: ${formatComparisonStatus(report.comparison)}

${renderMarkdownModelWarning(report)}
| Metric | Direct | Distill.codes | Delta | Change |
| --- | ---: | ---: | ---: | ---: |
${renderMarkdownRows(report.comparison)}

> Note: Distill.codes does not initially reuse the cache created by direct Claude traffic. Its cache warms over time, so latency and Anthropic-reported costs may improve. Run the benchmark several times for more stable results. Anthropic-reported costs are available in report.json for reference.

## Result

- Direct: ${formatResult(report.runs.direct)}
- Distill.codes: ${formatResult(report.runs.distill)}

## Runtime

| Run | Primary model | Context | Max output | All models | Effort setting | Speed |
| --- | --- | ---: | ---: | --- | --- | --- |
| Direct | ${formatPrimaryModel(report.runs.direct)} | ${formatInteger(report.runs.direct.primary_model?.context_window)} | ${formatInteger(report.runs.direct.primary_model?.max_output_tokens)} | ${formatModels(report.runs.direct)} | ${report.runs.direct.reasoning_effort} | ${report.runs.direct.speed ?? "not reported"} |
| Distill.codes | ${formatPrimaryModel(report.runs.distill)} | ${formatInteger(report.runs.distill.primary_model?.context_window)} | ${formatInteger(report.runs.distill.primary_model?.max_output_tokens)} | ${formatModels(report.runs.distill)} | ${report.runs.distill.reasoning_effort} | ${report.runs.distill.speed ?? "not reported"} |
`;
}

export function renderConsoleSummary(report) {
  const table = new Table({
    head: ["Metric", "Direct", "Distill.codes", "Delta", "Change"],
    colAligns: ["left", "right", "right", "right", "right"],
    style: { head: [], border: [] }
  });
  for (const [name, comparison, format] of summaryMetrics(report.comparison)) {
    table.push([
      name,
      format(comparison.direct),
      format(comparison.distill),
      formatComparisonDelta(comparison.delta, format),
      formatPercent(comparison.percent)
    ]);
  }
  const warning = usesSonnet(report) ? `\n\n\x1b[1;33m${SONNET_WARNING}\x1b[0m` : "";
  return `Benchmark summary\nComparison: ${formatComparisonStatus(report.comparison)}${warning}\n\n${table.toString()}\n\nRuntime\n  Direct primary: ${formatPrimaryRuntime(report.runs.direct)}\n  Distill.codes primary: ${formatPrimaryRuntime(report.runs.distill)}\n  Direct models: ${formatModels(report.runs.direct)}\n  Distill.codes models: ${formatModels(report.runs.distill)}\n  Direct effort setting: ${report.runs.direct.reasoning_effort}\n  Distill.codes effort setting: ${report.runs.distill.reasoning_effort}\n\nResult: Direct ${formatResult(report.runs.direct)}; Distill.codes ${formatResult(report.runs.distill)}`;
}

function renderMarkdownModelWarning(report) {
  return usesSonnet(report) ? `> [!WARNING]\n> ${SONNET_WARNING}\n` : "";
}

function usesSonnet(report) {
  return Object.values(report.runs ?? {}).some((run) =>
    [run.model, run.primary_model?.model, run.primary_model?.canonical_model, ...(run.models ?? [])].some(
      (model) => typeof model === "string" && model.toLowerCase().includes("sonnet")
    )
  );
}

function renderMarkdownRows(comparison) {
  return summaryMetrics(comparison)
    .map(([name, metric, format]) => `| ${name} | ${format(metric.direct)} | ${format(metric.distill)} | ${formatComparisonDelta(metric.delta, format)} | ${formatPercent(metric.percent)} |`)
    .join("\n");
}

function summaryMetrics(comparison) {
  return [
    ["Output tokens", comparison.output_tokens, formatInteger],
    ["Time", comparison.duration_ms, formatDuration],
    ["Turns", comparison.turns, formatInteger],
    ["LOC", comparison.loc, formatInteger],
    ["Files", comparison.files, formatInteger]
  ];
}

function formatResult(run) {
  return run.ok ? "passed" : "failed";
}

function formatModels(run) {
  return run.models?.length ? run.models.join(", ") : run.model ?? "not reported";
}

function formatPrimaryModel(run) {
  return run.primary_model?.canonical_model ?? "not reported";
}

function formatPrimaryRuntime(run) {
  const model = run.primary_model;
  if (!model) {
    return "not reported";
  }
  return `${model.canonical_model} (${formatInteger(model.context_window)} context, ${formatInteger(model.max_output_tokens)} max output)`;
}

function formatComparisonStatus(comparison) {
  return comparison.comparable ? "comparable" : `not comparable (${comparison.reasons.join("; ")})`;
}

function formatInteger(value) {
  return value == null ? "n/a" : value.toLocaleString("en-US");
}

function formatDuration(value) {
  return value == null ? "n/a" : `${(value / 1000).toFixed(1)}s`;
}

function formatComparisonDelta(value, format) {
  if (value == null) {
    return "n/a";
  }
  if (value === 0) {
    return format(value);
  }
  return `${value > 0 ? "+" : "-"}${format(Math.abs(value))}`;
}

function formatPercent(value) {
  return value == null ? "n/a" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function renderShareMarkdown(report) {
  const text = shareText(report);
  const benchmarkURL = "https://distill.codes/bench";
  const encodedText = encodeURIComponent(text);
  const encodedURL = encodeURIComponent(benchmarkURL);
  return `# Share Distill.codes Benchmark Result

Review \`report.md\` before sharing. Nothing was uploaded by the CLI.

## Suggested Text

${text}

## Share Links

- X: https://x.com/intent/tweet?text=${encodedText}&url=${encodedURL}
- LinkedIn: https://www.linkedin.com/sharing/share-offsite/?url=${encodedURL}
- Facebook: https://www.facebook.com/sharer/sharer.php?u=${encodedURL}
`;
}

function shareText(report) {
  const direct = report.runs.direct;
  const distill = report.runs.distill;
  if (!report.comparison.comparable) {
    return `I ran the Distill.codes Claude Code benchmark. Direct: ${direct.ok ? "passed" : "failed"}, Distill.codes: ${distill.ok ? "passed" : "failed"}. The runs were not comparable because their runtime configurations differed.`;
  }
  const outputDelta = report.comparison.output_tokens.delta;
  const outputSummary = outputDelta == null ? "output token delta unavailable" : `output token delta ${formatDelta(outputDelta)}`;
  return `I ran the Distill.codes Claude Code benchmark. Direct: ${direct.ok ? "passed" : "failed"}, Distill.codes: ${distill.ok ? "passed" : "failed"}, ${outputSummary}, LOC delta ${formatDelta(report.comparison.loc.delta)}. Results vary by task.`;
}

function formatDelta(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

function timestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}
