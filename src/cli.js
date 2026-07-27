import { Command } from "commander";
import { createRequire } from "node:module";
import { clearBaseURL, disableProxy, enableProxy } from "./claude-settings.js";
import { renderConsoleSummary, runBenchmark } from "./benchmark.js";
import { preflightProxy } from "./preflight.js";
import { normalizeProxyInput, redactProxyURL } from "./proxy-url.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

export async function main(argv = process.argv, dependencies = {}) {
  const benchmark = dependencies.runBenchmark ?? runBenchmark;
  const preflight = dependencies.preflightProxy ?? preflightProxy;
  const log = dependencies.log ?? console.log;
  const program = new Command();
  program
    .name("distill-codes")
    .description("Distill.codes setup and benchmark helper CLI.")
    .version(version);

  program
    .command("bench")
    .argument("<key-or-url-or-config>", "Distill.codes proxy key, URL, or Claude config fragment")
    .option("--model <model>", "Claude model override")
    .option("--effort <level>", "Claude effort override: low, medium, high, xhigh, or max")
    .option("--prompt-file <path>", "custom benchmark prompt")
    .option("--output-dir <path>", "benchmark output directory")
    .option("--claude-bin <path>", "Claude Code binary", "claude")
    .option("--timeout-ms <ms>", "per-run timeout", parseNumber)
    .option("--permission-mode <mode>", "Claude permission mode", "acceptEdits")
    .option("--share", "write a local social-sharing helper after the report")
    .action(async (input, options) => {
      const proxyURL = normalizeProxyInput(input);
      await preflight(proxyURL);
      log(`Proxy URL: ${redactProxyURL(proxyURL)}`);
      const { runRoot, report, sharePath } = await benchmark({
        ...options,
        proxyURL,
        onPlan: (planned) => {
          log(`Model: ${planned.model}`);
          log(`Effort: ${planned.effort}`);
        },
        onRunStart: (name) => {
          log(`Running ${name === "direct" ? "direct" : "Distill.codes"} benchmark...`);
        }
      });
      log(renderConsoleSummary(report));
      log(`Report: ${runRoot}/report.md`);
      if (sharePath) {
        log(`Share helper: ${sharePath}`);
      }
    });

  program
    .command("enable")
    .argument("<key-or-url-or-config>", "Distill.codes proxy key, URL, or Claude config fragment")
    .action(async (input) => {
      const proxyURL = normalizeProxyInput(input);
      await enableProxy(proxyURL, { preflight: preflightProxy });
      console.log(`Claude Code now uses ${redactProxyURL(proxyURL)}`);
    });

  program.command("disable").action(async () => {
    const result = await disableProxy();
    console.log(result.changed ? "Distill.codes proxy disabled." : "No Distill.codes proxy URL was active.");
  });

  program.command("clear-base-url").action(async () => {
    const result = await clearBaseURL();
    console.log(result.changed ? "ANTHROPIC_BASE_URL removed from Claude Code settings." : "ANTHROPIC_BASE_URL was not set.");
  });

  await program.parseAsync(argv);
}

function parseNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}
