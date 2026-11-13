---
name: clean-edge-debug
version: 0.1.0
description: Reproduce a bug, patch the smallest correct change, then prove the outcome with focused tests and explicit release limits.
---

# Clean Edge Debug

For a coding defect, inspect the real entrypoint and its callers, then write a test that fails on the old behavior. Change the smallest shared implementation that fixes the root cause. Prefer existing project tools and do not delete security checks to simplify the code.

For JavaScript/TypeScript module-path checks, run `node index.cjs <entrypoint>` in a checkout with this package installed. Treat the output as an **early preflight**, not build acceptance: follow with the project's own tests, compiler/bundler, and runtime verification.

Before claiming a release is safe, distinguish isolated tests from real deployment tests and inspect the publish set for credentials, private user content, nonredistributable assets, and copied code. Do not change a repository's visibility or publish without the owner's separate approval.

End with the verified change, the exact tests run, what was not checked, and the remaining risk.
