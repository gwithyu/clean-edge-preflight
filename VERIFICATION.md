# Consolidated verification — 2026-11-13

Linux, npm 11.9.0. No new runtime dependency.

| Check | Result |
| --- | --- |
| Core 75-test suite against RC6 | 56 pass / 19 expected failures; original 53 all pass |
| Node 20.20.2 / TypeScript 5.9.3 | 80/80, zero failures/skips/cancellations/TODOs |
| Node 22.23.5 / TypeScript 5.9.3 | 80/80, zero failures/skips/cancellations/TODOs |
| Node 24.22.1 / TypeScript 5.9.3 | 80/80, zero failures/skips/cancellations/TODOs |
| Node 24.22.1 / TypeScript 5.8.3 | 80/80, zero failures/skips/cancellations/TODOs |
| Fresh source extraction and empty-cache npm ci --ignore-scripts | PASS, official registry, project-local parser, NODE_PATH unset |
| Extracted source tests | 80/80 PASS |
| Packed tarball in an independent consumer | PASS, public API loads and CLI exits 0/1/2 |
| Installed CLI staged missing-file repair | PASS, failures decrease 2 / 1 / 0 |
| Installed final path/reference/directory/JSON checks | PASS |
| Source execution and scope-binder filesystem probes | No source execution or external reads |
| Original Home entrypoint preflight | 576 files / 1,628 relative edges, zero failures |
| Original Home npm run build | PASS, Vite 6.4.3, 1,170 transformed modules |
| Injected missing dependency | Preflight and Vite both exit 1 for the same dependency |
| Restored original Home build inputs | 667/667 original Git blob hashes match |
| Explicit verify:package and ordinary npm pack hook | PASS, unexpected/missing files stop packaging |
| Forced private README negative test | PASS, no tarball generated; contents not echoed |
| Source / npm package file sets | 12 / 10 allowlisted files, no bundled dependencies/private source |

Home preflight, Vite build and missing-dependency parity were rerun during consolidated scanner acceptance. The packaging revision retains these results on byte-identical scanner source. Existing mixed-import/chunk-size warnings were retained. Backend, live browser and device acceptance are not claimed. Only an isolated local copy was used; no remote Home edit, merge, deployment or restart occurred.

The tool checks the static local-dependency contract in README.md. Computed paths, package/project aliases, loader reassignment and custom factory base paths are not a claim of supported resolution. Conservative factory handling may report false positives; original compiler/bundler/runtime checks remain necessary.

Source ZIP reproducibility:

```sh
npm ci --registry=https://registry.npmjs.org --ignore-scripts
npm test
npm run verify:package
npm pack
```

The source ZIP includes package-lock.json locking TypeScript 5.9.3. npm excludes that lockfile from its tarball normally; the declared dependency remains ^5.8.3. The npm package stays private and is not published. The reviewed source is public at https://github.com/gwithyu/clean-edge-preflight. No existing private repository or its history was exposed.
