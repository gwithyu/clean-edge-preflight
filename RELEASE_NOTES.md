# Clean Edge Preflight 0.1.0 — consolidated verified delivery

This delivery consolidates the earlier candidates and closes the defects found in the final source, path and packaging review. The source is published on GitHub under MIT; the npm package is not published.

## Final fixes

- Kept dependency kinds through parsing/resolution: CommonJS filenames retain ?/#, while import URL suffixes still resolve correctly; bare and absolute triple-slash references are checked.
- Fixed filesystem-root handling, empty/invalid API inputs, missing/non-directory roots and source-read failures.
- Applied CommonJS extension and directory package-main/index rules. Manifest/main symlink and lexical escapes fail; cycles terminate; malformed manifests fail safely.
- Checked JSON dependencies and BOMs, handled dotted directory names and literal bracketed require.resolve access.
- Added the missing package main entrypoint so installed users can require the public API.
- Retained the earlier dynamic-import, wrapper, CommonJS, TypeScript and scope fixes. No new runtime dependency was added.

## Package boundary hardening

- Added an exact npm files allowlist and an automatic prepack check; npm pack refuses an unexpected or missing file before generating its tarball.
- Added npm run verify:package for an explicit preview check. The guard previews with lifecycle scripts disabled, avoiding recursion; successful npm pack --json output remains parseable.
- Added five release-boundary regressions: accidental private/temporary files, npm-forced README files, automatic pack refusal, missing runtime files and redacted malformed-manifest diagnostics.
- The scanner source is unchanged from the consolidated 75-case delivery; this revision completes its packaging boundary. No new runtime dependency was added.

## Acceptance

The core 75-test suite against RC6 yields 56 passes and 19 expected failures; all original 53 tests pass. The full suite including package checks passes 80/80 with zero failures, skips, cancellations or TODOs on Node 20.20.2, 22.23.5 and 24.22.1. Minimum TypeScript 5.8.3 and locked 5.9.3 both pass.

Fresh source extraction, empty-cache official npm installation, tests, packed-tarball installation, public API import, CLI exit codes 0/1/2 and staged fault/repair checks pass. The source ZIP has 12 allowlisted files; the npm tarball has 10 and no bundled dependencies.

Consolidated scanner acceptance reran the original private frontend preflight (576 files / 1,628 relative edges) and unmodified Vite build (1,170 transformed modules). Injecting a missing dependency makes both exit 1. After restoration, all 667 original build-input Git blobs match. Those results are retained here because the scanner source is byte-identical. No private sources, raw private logs or build output are distributed.

## Scope and release status

Remaining resolution boundaries are specified in README.md. This is a static preflight and does not replace original build/runtime/device testing. Existing Home mixed-import and chunk-size warnings remain. The remote Home was not modified, merged, deployed or restarted. private: true remains for npm. The source is public on GitHub; npm publication is a separate decision.
