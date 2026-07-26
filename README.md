# Distill.codes

Distill.codes helps Claude Code produce cleaner, smaller, lower-maintenance
changes through a drop-in optimization proxy.

This public repository contains:

- the `distill-codes` CLI for Claude Code setup and benchmarks;
- public bug reports, feature requests, and product feedback.

## Quick Start

Install or preview the CLI:

```sh
npx github:MyDream-Labs/distill.codes --help
```

After the npm package is published, the command will be:

```sh
npx distill-codes --help
```

## Commands

### Enable Distill.codes for Claude Code

```sh
npx distill-codes enable <proxy-key>
```

Raw proxy keys use production:

```text
https://proxy.distill.codes/<proxy-key>/essential/anthropic
```

You can also pass a full URL copied from the dashboard:

```sh
npx distill-codes enable https://proxy.distill.codes/<proxy-key>/essential/anthropic
```

Or paste the Claude config fragment:

```sh
npx distill-codes enable '"env": { "ANTHROPIC_BASE_URL": "https://proxy.distill.codes/<proxy-key>/essential/anthropic" }'
```

`enable` validates the URL before changing your Claude Code settings. It writes
only:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://proxy.distill.codes/<proxy-key>/essential/anthropic"
  }
}
```

inside `~/.claude/settings.json`.

Before changing the file, the CLI saves a full backup at:

```text
~/.claude/settings.distill-codes-backup.json
```

### Disable Distill.codes

```sh
npx distill-codes disable
```

This removes the active Distill.codes `ANTHROPIC_BASE_URL`. If the backup file
contains a previous non-Distill value, the CLI restores only that one setting.
It never overwrites your whole current `settings.json` with the backup.

### Clear Any Claude Base URL

```sh
npx distill-codes clear-base-url
```

Use this only for troubleshooting. It removes `ANTHROPIC_BASE_URL` even if the
value is not a Distill.codes URL.

### Run a Benchmark

```sh
npx distill-codes bench <proxy-key>
```

The benchmark runs the same Claude Code task twice:

1. direct: no `ANTHROPIC_BASE_URL`;
2. Distill.codes: your proxy URL as `ANTHROPIC_BASE_URL`.

Each run uses a fresh work directory:

```text
distill-codes-bench/<timestamp>/direct
distill-codes-bench/<timestamp>/distill
```

The default task asks Claude Code to implement a tiny dependency-free secret
scanner. A local verifier checks the result automatically.

Optional model and effort overrides:

```sh
npx distill-codes bench <proxy-key> --model fable --effort xhigh
```

Custom prompt:

```sh
npx distill-codes bench <proxy-key> --prompt-file ./my-task.md
```

Custom prompts are saved and reported, but verification is manual.

## Benchmark Output

Every benchmark saves local files before printing a summary:

```text
distill-codes-bench/<timestamp>/prompt.txt
distill-codes-bench/<timestamp>/direct.stdout.log
distill-codes-bench/<timestamp>/direct.stderr.log
distill-codes-bench/<timestamp>/distill.stdout.log
distill-codes-bench/<timestamp>/distill.stderr.log
distill-codes-bench/<timestamp>/report.json
distill-codes-bench/<timestamp>/report.md
```

The report includes:

- pass/fail status;
- elapsed time;
- files and LOC generated;
- input and output token usage when Claude Code exposes it;
- direct-vs-Distill deltas.

## Privacy

The CLI does not upload benchmark results.

It stores benchmark prompts, logs, and reports locally in
`./distill-codes-bench/`. Review those files before sharing them publicly.

Future upload or social sharing flows will be explicit opt-in.

## Requirements

- Node.js 20 or newer.
- Claude Code installed and authenticated.
- A Distill.codes proxy key from https://distill.codes/dashboard.

## Troubleshooting

If `enable` fails, copy a fresh proxy URL from the dashboard and try again.

If Claude Code does not appear to use Distill.codes after `enable`, restart
Claude Code and confirm that `ANTHROPIC_BASE_URL` is inside:

```text
~/.claude/settings.json
```

If a benchmark fails because of Claude limits or provider capacity, rerun it
later with the same model and effort.

## Feedback

Report a bug:

https://github.com/MyDream-Labs/distill.codes/issues/new?template=bug_report.yml

Request a feature:

https://github.com/MyDream-Labs/distill.codes/issues/new?template=feature_request.yml

General feedback:

https://github.com/MyDream-Labs/distill.codes/issues/new?template=feedback.yml

## Please Do Not Post Publicly

Do not include secrets or private data in public issues:

- API keys
- proxy URLs or Distill.codes keys
- billing details
- private source code
- private prompts, logs, or customer data

For private support, billing, or security-sensitive reports, email:

support@distill.codes
