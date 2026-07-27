import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envForTemporarySettings, writeTemporarySettings } from "./claude-settings.js";
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

export async function runBenchmark(options) {
  const startedAt = new Date();
  const outputRoot = options.outputDir ?? join(process.cwd(), "distill-codes-bench");
  const runRoot = join(outputRoot, timestamp(startedAt));
  const prompt = options.promptFile ? await readFile(options.promptFile, "utf8") : DEFAULT_PROMPT;
  const customPrompt = Boolean(options.promptFile);

  await makePrivateDir(outputRoot);
  await makePrivateDir(runRoot);
  await writePrivateFile(join(runRoot, "prompt.txt"), prompt);

  const baseEnv = await envForTemporarySettings(options.home);
  const planned = {
    model: options.model ?? baseEnv.ANTHROPIC_MODEL ?? "default/unknown",
    effort: options.effort ?? baseEnv.CLAUDE_CODE_DEFAULT_EFFORT ?? "default/unknown"
  };
  options.onPlan?.(planned);

  const direct = await runCase({
    name: "direct",
    runRoot,
    prompt,
    proxyURL: "",
    env: { ...baseEnv, ANTHROPIC_BASE_URL: "" },
    options,
    customPrompt
  });
  const distill = await runCase({
    name: "distill",
    runRoot,
    prompt,
    proxyURL: options.proxyURL,
    env: { ...baseEnv, ANTHROPIC_BASE_URL: options.proxyURL },
    options,
    customPrompt
  });

  const report = {
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    task: customPrompt ? "custom" : "secret-scanner",
    prompt_file: options.promptFile ?? null,
    proxy_url: redactProxyURL(options.proxyURL),
    planned,
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

async function runCase({ name, runRoot, prompt, proxyURL, env, options, customPrompt }) {
  const workdir = join(runRoot, name);
  await makePrivateDir(workdir);
  await writePrivateFile(join(workdir, "TASK.md"), prompt);

  const tempDir = await mkdtemp(join(tmpdir(), "distill-codes-"));
  const settingsFile = join(tempDir, "settings.json");
  await writeTemporarySettings(settingsFile, env);

  const args = [
    "-p",
    "--output-format",
    "json",
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
    timeoutMs: options.timeoutMs ?? 30 * 60 * 1000
  });
  await rm(tempDir, { recursive: true, force: true });

  await writePrivateFile(join(runRoot, `${name}.stdout.log`), result.stdout);
  await writePrivateFile(join(runRoot, `${name}.stderr.log`), result.stderr);

  const parsed = parseJSONOutput(result.stdout);
  const verifier = customPrompt ? { ok: null, mode: "manual", message: "Custom prompt verification is manual." } : await verifySecretScanner(workdir);
  const files = await collectFiles(workdir);

  return {
    name,
    proxy_url: proxyURL ? redactProxyURL(proxyURL) : null,
    ok: result.status === 0 && verifier.ok !== false,
    exit_status: result.status,
    duration_ms: Date.now() - startedAt,
    model: findFirstKey(parsed, ["model"]) ?? options.model ?? "default/unknown",
    effort: options.effort ?? "default/unknown",
    usage: extractUsage(parsed),
    verifier,
    files: files.length,
    loc: await countLOC(files),
    stdout_log: `${name}.stdout.log`,
    stderr_log: `${name}.stderr.log`
  };
}

async function runCommand(command, args, options) {
  return await new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_BASE_URL;
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

function parseJSONOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function extractUsage(value) {
  const usage = findUsage(value);
  if (!usage) {
    return null;
  }
  return {
    input_tokens: usage.input_tokens ?? usage.inputTokens ?? null,
    output_tokens: usage.output_tokens ?? usage.outputTokens ?? null,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? null
  };
}

function findUsage(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if ("input_tokens" in value || "output_tokens" in value || "inputTokens" in value || "outputTokens" in value) {
    return value;
  }
  for (const child of Object.values(value)) {
    const found = Array.isArray(child) ? child.map(findUsage).find(Boolean) : findUsage(child);
    if (found) {
      return found;
    }
  }
  return null;
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

function compareRuns(direct, distill) {
  return {
    duration_ms_delta: distill.duration_ms - direct.duration_ms,
    loc_delta: distill.loc - direct.loc,
    files_delta: distill.files - direct.files,
    output_tokens_delta:
      direct.usage?.output_tokens != null && distill.usage?.output_tokens != null
        ? distill.usage.output_tokens - direct.usage.output_tokens
        : null
  };
}

function renderMarkdown(report) {
  const rows = [report.runs.direct, report.runs.distill]
    .map(
      (run) =>
        `| ${run.name} | ${run.ok ? "yes" : "no"} | ${Math.round(run.duration_ms / 1000)}s | ${run.files} | ${run.loc} | ${run.usage?.input_tokens ?? "-"} | ${run.usage?.output_tokens ?? "-"} |`
    )
    .join("\n");
  return `# Distill.codes Benchmark Report

- Task: ${report.task}
- Proxy: ${report.proxy_url}
- Started: ${report.started_at}

| Run | Passed | Time | Files | LOC | Input tokens | Output tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${rows}

## Comparison

- LOC delta: ${report.comparison.loc_delta}
- Files delta: ${report.comparison.files_delta}
- Output token delta: ${report.comparison.output_tokens_delta ?? "unknown"}
`;
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
  const outputDelta = report.comparison.output_tokens_delta;
  const outputSummary = outputDelta == null ? "output token delta unavailable" : `output token delta ${formatDelta(outputDelta)}`;
  return `I ran the Distill.codes Claude Code benchmark. Direct: ${direct.ok ? "passed" : "failed"}, Distill.codes: ${distill.ok ? "passed" : "failed"}, ${outputSummary}, LOC delta ${formatDelta(report.comparison.loc_delta)}. Results vary by task.`;
}

function formatDelta(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

function timestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}
