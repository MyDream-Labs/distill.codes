# Distill.codes

Distill.codes helps Claude Code produce cleaner, smaller, lower-maintenance
changes through a drop-in optimization proxy.

This public repository contains:

- the `distill-codes` CLI for Claude Code setup and benchmarks;
- public bug reports, feature requests, and product feedback.

## Architecture

- `bin/distill-codes.js` starts the CLI; `src/cli.js` defines its commands.
- `src/proxy-url.js` normalizes, validates, and redacts Distill.codes proxy URLs.
- `src/preflight.js` checks a proxy before `enable` changes Claude Code settings.
- `src/claude-settings.js` updates `~/.claude/settings.json` and maintains its
  Distill.codes backup.
- `src/benchmark.js` runs direct and proxied Claude Code tasks in separate local
  directories and writes the reports.

## Local Development

From a clean checkout with Node.js 20 or newer:

```sh
npm ci
npm test
npm pack --dry-run
```

The test suite is also the repository's CI check. `npm pack --dry-run` shows the
files that would be included in the npm artifact without creating or publishing
one.

## Quick Start

Run the published CLI:

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

Benchmarks use Claude Code's `acceptEdits` permission mode by default. To
choose another mode explicitly:

```sh
npx distill-codes bench <proxy-key> --permission-mode bypassPermissions
```

Optional model and effort overrides:

```sh
npx distill-codes bench <proxy-key> --model fable --effort xhigh
```

Custom prompt:

```sh
npx distill-codes bench <proxy-key> --prompt-file ./my-task.md
```

Custom prompts are saved and reported, but verification is manual.

Optional local sharing helper:

```sh
npx distill-codes bench <proxy-key> --share
```

This writes `share.md` next to the report with suggested text and social
sharing links. It does not upload benchmark data.

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

## Security and Privacy

Proxy URLs contain a proxy key and must be treated as secrets. The CLI accepts
only HTTPS Distill.codes hosts for new proxy configuration, validates the proxy
before `enable` changes settings, and redacts proxy keys in its CLI summary and
benchmark reports. It writes Claude settings and the Distill.codes backup with
owner-only file permissions.

The CLI does not upload benchmark results.

It stores benchmark prompts, logs, and reports locally in
`./distill-codes-bench/`. Benchmark directories are restricted to the current
user (`0700`), and the CLI-written prompt, task, log, report, and share files
are `0600`, regardless of umask. Review those files before sharing them
publicly.

Future upload flows will be explicit opt-in.

These local permissions are not encryption or a substitute for securing the
machine and the Claude Code configuration. Benchmark prompts and Claude output
may contain sensitive data; proxy preflight and benchmark runs also communicate
with their configured external services. Review local artifacts before sharing
them and do not put proxy URLs or private data in public issues.

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

## Release and Package Verification

Before publishing a version, run the clean-install and artifact checks:

```sh
npm ci
npm test
npm pack --dry-run
npm publish --dry-run
```

After updating the package version, a maintainer can publish it with the npm
account that owns `distill-codes`:

```sh
npm publish
```

Verify the published version from a clean directory:

```sh
npm view distill-codes@<version> version
npx --yes distill-codes@<version> --help
```

Do not modify a published version to roll back a defect. Publish a fixed version
and deprecate the affected one with a clear upgrade message:

```sh
npm deprecate distill-codes@<bad-version> "Use <fixed-version>: <reason>"
```

If a release must be removed, follow the npm registry's current unpublish policy
and coordinate with package consumers; deprecation plus a fixed version is the
normal recovery path.

## Contributing and Feedback

Keep contributions focused, add or update tests for behavior changes, and run
`npm test` before opening a pull request. Use the issue templates for bugs,
features, and general feedback:

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

## License

Copyright 2026 MyDream Labs.

Licensed under the [Apache License, Version 2.0](LICENSE).

This license covers the source code in this repository only. It does not grant
rights to the Distill.codes name or trademarks, hosted proxy service, dashboard,
or user credentials.
