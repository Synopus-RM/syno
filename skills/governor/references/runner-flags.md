# Runner flags: limit parallelism, split into parts

Use the worker numbers from `gov advise`. N below means that number. Split a suite only after the owner approves it, and give each part its own `gov run`.

| Tool | Limit parallelism | Split into parts |
| --- | --- | --- |
| Playwright | `--workers=N` | `--shard=i/N`, or pass spec files or folders, or use `--grep` |
| Cypress | runs specs one at a time already | `--spec "cypress/e2e/<area>/**"`, one folder per part |
| WebdriverIO | `maxInstances` in the config | `--spec <file>`, or suites with `--suite` |
| Jest | `--maxWorkers=N` (alias `-w N`) | `--shard=i/N` (Jest 28 or later), or test path patterns |
| Vitest | `--maxWorkers=N` | `--shard=i/N`, or file filters |
| Mocha | `--parallel --jobs N` | file globs |
| pytest | `-n N` (needs pytest-xdist) | paths, or `-k <expr>` |
| Go | `go test -p N ./...` | package paths, e.g. `./internal/...` |
| Cargo | `-j N` | `-p <crate>`, or test name filters |
| Gradle | `--max-workers=N` | one module or task at a time |
| Make / Ninja | `-j N` | one target at a time |
| Turborepo | `--concurrency=N` | `--filter=<package>` |
| Nx | `--parallel=N` | `--projects=a,b` |
| tsc | `--incremental` | one project at a time, with `-p <tsconfig>` |
| Next.js / Vite / Expo builds | no CLI worker flag: queue as heavy and run one at a time | build a single app or package of a monorepo |
| Docker build | queue as heavy | build one `--target` stage at a time |
| npm / pnpm install | `--prefer-offline` uses less network and CPU | — |

Targeted runs usually beat any flag. Run the tests for the files you changed (for example `npx jest path/to/changed.test.ts` or `npx playwright test tests/checkout.spec.ts`), and keep full suites for milestones.
