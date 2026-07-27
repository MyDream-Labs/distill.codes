# Review Plan

## Инструкция по прохождению ревью

1. Провести отдельное ревью только в объёме текущего пункта плана и разделить файндинги на блокеры и неблокеры.
   - Блокер — проблема, из-за которой переход к следующему этапу небезопасен или невозможен либо возможна потеря или утечка данных.
   - Неблокеры не исправлять в рамках текущего ревью: сохранить их в отчёте для отдельной задачи или подходящего следующего этапа.
2. Сохранить отчёт в папку `.reviews` со сквозной нумерацией и именем, содержащим название ревью. В отчёте указать номер, название, дату, статус, а для каждого файндинга — приоритет, путь или область, доказательство и краткую рекомендацию.
3. Если ревью неприменимо к проекту, отметить его как `N/A`, кратко объяснить причину и установить его чекбокс в блоке «Прогресс».
4. Если найдены блокеры:
   - Запустить подагента для исправления только найденных блокеров.
   - После его завершения провести повторное ревью того же пункта и в том же объёме, проверив прежние блокеры и регрессии от исправлений.
   - Если после трёх циклов исправления один и тот же блокер остаётся, зафиксировать его как внешний блокер с описанием необходимого решения или доступа.
   - Оставить чекбокс ревью незакрытым и добавить к нему ссылку на отчёт с блокером.
5. Если блокеры не найдены, отметить ревью как пройденное, установить его чекбокс в блоке «Прогресс» и перейти к следующему ревью.
6. После завершения каждого ревью создать отдельный коммит. В сообщении коммита указать название ревью.

## Прогресс

- [ ] [1. Foundation: Immediate Risk Triage](#foundation-immediate-risk-triage)
- [ ] [2. Foundation: Reproducible Local Run](#foundation-reproducible-local-run)
- [ ] [3. Foundation: Core Scope & Critical Journeys](#foundation-core-scope-critical-journeys)
- [ ] [4. Foundation: Critical Smoke Baseline](#foundation-critical-smoke-baseline)
- [ ] [5. Architecture: System Shape & Dependency Boundaries](#architecture-system-shape-dependency-boundaries)
- [ ] [6. Architecture: Data Model & Persistence](#architecture-data-model-persistence)
- [ ] [7. Architecture: Dead Code & Dependency Cleanup](#architecture-dead-code-dependency-cleanup)
- [ ] [8. Architecture: Simplification & Deduplication](#architecture-simplification-deduplication)
- [ ] [9. Correctness: Type Safety](#correctness-type-safety)
- [ ] [10. Correctness: Runtime Contracts](#correctness-runtime-contracts)
- [ ] [11. Correctness: Error Handling](#correctness-error-handling)
- [ ] [12. Correctness: Failure Diagnostics](#correctness-failure-diagnostics)
- [ ] [13. Correctness: Data Integrity & Migrations](#correctness-data-integrity-migrations)
- [ ] [14. Correctness: Consolidation & Cleanup](#correctness-consolidation-cleanup)
- [ ] [15. Product: UX Completeness](#product-ux-completeness)
- [ ] [16. Product: Accessibility](#product-accessibility)
- [ ] [17. Product: Interaction & UI Cleanup](#product-interaction-ui-cleanup)
- [ ] [18. Verification: Core Unit & Invariants](#verification-core-unit-invariants)
- [ ] [19. Verification: Integration](#verification-integration)
- [ ] [20. Verification: Contracts & Compatibility](#verification-contracts-compatibility)
- [ ] [21. Verification: End-to-End Critical Journeys](#verification-end-to-end-critical-journeys)
- [ ] [22. Verification: Test Suite Cleanup & Stability](#verification-test-suite-cleanup-stability)
- [ ] [23. Verification: Static Analysis & Formatting](#verification-static-analysis-formatting)
- [ ] [24. Operations: Observability](#operations-observability)
- [ ] [25. Operations: Reliability & Operability](#operations-reliability-operability)
- [ ] [26. Operations: Performance & Resource Efficiency](#operations-performance-resource-efficiency)
- [ ] [27. Operations: Instrumentation & Runtime Cleanup](#operations-instrumentation-runtime-cleanup)
- [ ] [28. Assurance: Application Security Hardening](#assurance-application-security-hardening)
- [ ] [29. Assurance: Privacy & Sensitive Data](#assurance-privacy-sensitive-data)
- [ ] [30. Assurance: Legal & Compliance Readiness](#assurance-legal-compliance-readiness)
- [ ] [31. Cleanup: Dead Code & Unused Surface](#cleanup-dead-code-unused-surface)
- [ ] [32. Cleanup: Dependencies, Scripts & Configuration](#cleanup-dependencies-scripts-configuration)
- [ ] [33. Cleanup: Duplication & Consolidation](#cleanup-duplication-consolidation)
- [ ] [34. Cleanup: Temporary, Legacy & Debug Artifacts](#cleanup-temporary-legacy-debug-artifacts)
- [ ] [35. Cleanup: Owned Code Reduction](#cleanup-owned-code-reduction)
- [ ] [36. Delivery: CI Quality Gates](#delivery-ci-quality-gates)
- [ ] [37. Delivery: Release Artifact Integrity](#delivery-release-artifact-integrity)
- [ ] [38. Delivery: Secure Supply Chain](#delivery-secure-supply-chain)
- [ ] [39. Delivery: Deployment Readiness](#delivery-deployment-readiness)
- [ ] [40. Delivery: Staging Verification](#delivery-staging-verification)
- [ ] [41. Delivery: Documentation & Repository](#delivery-documentation-repository)

## Wave 1: Foundation

### <a id="foundation-immediate-risk-triage"></a>1. Foundation: Immediate Risk Triage

Review only immediate stop-the-line risks before further work: exposed secrets or production credentials, destructive scripts, unsafe debug or admin access, obvious critical vulnerabilities, and accidental production connections. Ignore normal hardening at this stage.

### <a id="foundation-reproducible-local-run"></a>2. Foundation: Reproducible Local Run

Review whether the project can be installed, configured, and started from a clean local environment. Check runtime and package-manager consistency, lockfiles, environment examples, setup or migration steps, start commands, and machine-specific assumptions. Do not require production packaging yet.

### <a id="foundation-core-scope-critical-journeys"></a>3. Foundation: Core Scope & Critical Journeys

Review whether the product's intended scope and critical user journeys are clear and coherent. Identify incomplete blockers, contradictory flows, and obsolete experiments that would distort later architecture. Do not expand the product or invent features.

### <a id="foundation-critical-smoke-baseline"></a>4. Foundation: Critical Smoke Baseline

Review whether a minimal black-box smoke suite protects the product's essential behavior before structural changes. Cover startup and only the most critical happy path, failure path, and side effect. Do not require broad coverage or implementation-detail tests.

## Wave 2: Architecture

### <a id="architecture-system-shape-dependency-boundaries"></a>5. Architecture: System Shape & Dependency Boundaries

Review whether the system shape and dependency boundaries support a coherent implementation and reasonable growth. Check the business core, side effects, external integrations, dependency direction, coupling, global state, and scale assumptions. Prefer the simplest viable architecture without ceremony.

### <a id="architecture-data-model-persistence"></a>6. Architecture: Data Model & Persistence

Review whether the data model and persistence design fit the product and intended architecture. Check entities, ownership, identifiers, relationships, storage choices, transaction boundaries, tenancy, and data lifecycle. Allow necessary PoC redesign; avoid speculative stores.

### <a id="architecture-dead-code-dependency-cleanup"></a>7. Architecture: Dead Code & Dependency Cleanup

Review for code, configuration, endpoints, flags, and dependencies that no longer support the chosen product and architecture. Use suitable static analysis where useful, but verify dynamic usage before removing anything.

### <a id="architecture-simplification-deduplication"></a>8. Architecture: Simplification & Deduplication

Review the remaining design for avoidable complexity and duplication. Check repeated domain rules, parallel implementations, unnecessary abstractions, oversized flows, and inconsistent patterns. Use duplicate detection where useful and simplify only material issues without changing intended behavior.

## Wave 3: Correctness

### <a id="correctness-type-safety"></a>9. Correctness: Type Safety

Review compile-time type safety. Check strictness, unsafe any or casts, nullability, domain states, exhaustiveness, and public or library boundaries. Strengthen types only where they prevent plausible defects.

### <a id="correctness-runtime-contracts"></a>10. Correctness: Runtime Contracts

Review validation at untrusted runtime boundaries: environment, requests, files, database data, external APIs, queues, webhooks, and model output. Require explicit parsing, defaults, or rejection where invalid data can break behavior.

### <a id="correctness-error-handling"></a>11. Correctness: Error Handling

Review whether failures are handled correctly. Check propagation, causes, expected versus unexpected errors, partial operations, statuses or exit codes, user-safe messages, and justified retries or fallbacks. Do not build full observability here.

### <a id="correctness-failure-diagnostics"></a>12. Correctness: Failure Diagnostics

Review whether concrete failures can be diagnosed quickly. Check stack traces, source maps, stable error codes, operation context, actionable messages, and correlation identifiers where useful. Do not add full telemetry in this phase.

### <a id="correctness-data-integrity-migrations"></a>13. Correctness: Data Integrity & Migrations

Review persisted-data safety after the model has stabilized. Check constraints, uniqueness, transactions, concurrency, idempotency, migrations, safe reruns, partial failures, and backup or restore expectations. Pass when the project has no persistent data.

### <a id="correctness-consolidation-cleanup"></a>14. Correctness: Consolidation & Cleanup

Review artifacts left by correctness work: parallel types, validators, error mappings, compatibility wrappers, migrations, and obsolete code paths. Consolidate overlapping mechanisms and remove only confidently superseded code before deeper verification is added.

## Wave 4: Product

### <a id="product-ux-completeness"></a>15. Product: UX Completeness

Review completion of critical user-facing states and journeys. Check loading, empty, error, success, validation feedback, destructive confirmations, recovery, responsiveness, and equivalent CLI behavior where relevant. Do not add nonessential features.

### <a id="product-accessibility"></a>16. Product: Accessibility

Review material accessibility issues in the actual user interface. Check keyboard and focus behavior, semantics and labels, contrast, error communication, motion or timing, and basic screen-reader support. Adapt or pass for non-UI projects.

### <a id="product-interaction-ui-cleanup"></a>17. Product: Interaction & UI Cleanup

Review obsolete components, states, styles, routes, copy, feature flags, and duplicate interaction logic left by product work. Remove only confidently unused artifacts and consolidate repeated behavior without redesigning the product.

## Wave 5: Verification

### <a id="verification-core-unit-invariants"></a>18. Verification: Core Unit & Invariants

Review whether critical business logic and invariants have focused deterministic tests. Check branches, boundaries, invalid states, calculations, transitions, and permissions. Seek high coverage only for small critical pure-core code.

### <a id="verification-integration"></a>19. Verification: Integration

Review tests across real infrastructure boundaries such as databases, filesystems, caches, queues, migrations, external adapters, auth middleware, and process execution. Require representative success and failure coverage without duplicating unit tests.

### <a id="verification-contracts-compatibility"></a>20. Verification: Contracts & Compatibility

Review contracts consumed by other components or users: HTTP schemas, events, webhooks, CLI output and exit codes, stored formats, and package exports. Protect intended compatibility without preserving accidental PoC internals.

### <a id="verification-end-to-end-critical-journeys"></a>21. Verification: End-to-End Critical Journeys

Review a small set of critical journeys through the complete system. Cover startup, the core value flow, auth or permissions, financial or destructive actions, and recovery where relevant. Avoid exhaustive UI permutations.

### <a id="verification-test-suite-cleanup-stability"></a>22. Verification: Test Suite Cleanup & Stability

Review whether the test suite is trustworthy, maintainable, and fast enough to support change. Remove duplicate or obsolete tests, fixtures, snapshots, and mocks; check flakiness, order dependence, weak assertions, skipped tests, slowness, and unstable selectors.

### <a id="verification-static-analysis-formatting"></a>23. Verification: Static Analysis & Formatting

Review lightweight automated formatting and static checks for the now-stable codebase. Configure compatible formatter, linter, imports, and useful analysis with minimal friction. Avoid conflicting tools, style churn, or rules that fight the framework.

## Wave 6: Operations

### <a id="operations-observability"></a>24. Operations: Observability

Review whether production behavior can be understood through appropriate logs, metrics, and traces. Check structured context, correlation, key errors, latency, dependencies, business events, and sensitive-data redaction. Avoid vendor lock-in and telemetry overkill.

### <a id="operations-reliability-operability"></a>25. Operations: Reliability & Operability

Review lifecycle and failure resilience. Check startup, health or readiness, graceful shutdown, timeouts, retries and backoff, idempotency, resource and concurrency limits, dependency outages, and recovery. Require only mechanisms relevant to this architecture.

### <a id="operations-performance-resource-efficiency"></a>26. Operations: Performance & Resource Efficiency

Review measured performance and resource risks. Check latency, startup, memory, CPU, query count, bundle or image size, network calls, and concurrency. Optimize only evidenced bottlenecks; do not perform speculative optimization.

### <a id="operations-instrumentation-runtime-cleanup"></a>27. Operations: Instrumentation & Runtime Cleanup

Review operational artifacts for duplicated telemetry, debug output, redundant health checks, obsolete runtime flags, overlapping retries, and stale operational configuration. Keep only mechanisms that materially support this architecture.

## Wave 7: Assurance

### <a id="assurance-application-security-hardening"></a>28. Assurance: Application Security Hardening

Review the final application attack surface. Check authentication, authorization, tenancy, input and output handling, sessions, injection, SSRF, path traversal, uploads, rate limits, webhooks, and sensitive logging. Fix material exploitable risks, not irrelevant checklist items.

### <a id="assurance-privacy-sensitive-data"></a>29. Assurance: Privacy & Sensitive Data

Review actual collection, storage, transmission, logging, and deletion of sensitive data. Check minimization, consent, cookies, analytics, retention, export or deletion, redaction, test data, and third parties. Base requirements on real data flows.

### <a id="assurance-legal-compliance-readiness"></a>30. Assurance: Legal & Compliance Readiness

Review legal and compliance-facing readiness. Check licenses and notices, privacy, terms, cookies, age or industry disclaimers, processor disclosures, and jurisdiction assumptions. Prepare necessary drafts and open items without claiming certification.

## Wave 8: Cleanup

### <a id="cleanup-dead-code-unused-surface"></a>31. Cleanup: Dead Code & Unused Surface

Review production code reachable from real entry points. Use project-appropriate dead-code or unused-export analysis where useful, verify dynamic usage, and remove only confidently unreachable modules, exports, endpoints, assets, and flags.

### <a id="cleanup-dependencies-scripts-configuration"></a>32. Cleanup: Dependencies, Scripts & Configuration

Review dependencies, scripts, environment variables, configuration, CI fragments, and feature flags. Use dependency analysis where useful; remove only confidently unused or obsolete items and keep manifests, lockfiles, and docs consistent.

### <a id="cleanup-duplication-consolidation"></a>33. Cleanup: Duplication & Consolidation

Review duplicated code, domain rules, schemas, adapters, utilities, and fixtures. Use project-appropriate duplicate detection where useful, then consolidate only material duplication into the simplest existing or shared implementation.

### <a id="cleanup-temporary-legacy-debug-artifacts"></a>34. Cleanup: Temporary, Legacy & Debug Artifacts

Review temporary shims, compatibility paths, commented code, debug logging, experimental endpoints, stale flags, generated leftovers, and abandoned TODOs. Remove only artifacts that are clearly obsolete; preserve required history and migrations.

### <a id="cleanup-owned-code-reduction"></a>35. Cleanup: Owned Code Reduction

Review whether custom code can be safely deleted or replaced by already-used standard-library, platform, framework, or project primitives. Reduce maintenance surface without adding dependency churn or rewriting stable code for aesthetics.

## Wave 9: Delivery

### <a id="delivery-ci-quality-gates"></a>36. Delivery: CI Quality Gates

Review whether the stable checks the project now relies on run automatically before merge or release. Include only relevant install, formatting, lint, type, test, security, and build commands. Keep feedback fast and configuration minimal.

### <a id="delivery-release-artifact-integrity"></a>37. Delivery: Release Artifact Integrity

Review whether a distributable artifact can be built, tested, and versioned reproducibly. Check package or container contents, production dependencies, startup, metadata, versioning, source maps, and size. Do not impose containers when the target platform does not need them.

### <a id="delivery-secure-supply-chain"></a>38. Delivery: Secure Supply Chain

Review dependencies and the build or release chain. Check vulnerability and secret scanning, lifecycle scripts, lockfile integrity, CI permissions, pinned actions or images, and SBOM, provenance, or signing where justified. Avoid unsupported enterprise ceremony.

### <a id="delivery-deployment-readiness"></a>39. Delivery: Deployment Readiness

Review readiness for a simple staging target. Prefer an existing target or the simplest suitable managed platform; check configuration, environment and secrets, services, migrations, health, deployment, and rollback instructions. Without credentials, prepare everything local and leave the external step non-blocking.

### <a id="delivery-staging-verification"></a>40. Delivery: Staging Verification

Review the deployed staging environment when accessible, otherwise review the prepared verification procedure. Check smoke or critical E2E flows, migrations, health, headers, telemetry, and recovery or rollback. Missing credentials alone are not a blocker when preparation is complete.

### <a id="delivery-documentation-repository"></a>41. Delivery: Documentation & Repository

Review whether another person can understand, run, test, deploy, operate, and maintain the project. Check README, quick start, architecture, environment, testing, deployment, rollback, troubleshooting, security, limitations, license, contribution guidance, and badges backed by real checks.
