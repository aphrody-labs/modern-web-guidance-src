---
name: project-maintenance
description: "Routine maintenance notes: checking vendored deps, web-features/compat dataset updates, and doc coherence."
---

# Repository Maintenance

Things that should happen with some regularity across the repository:

### Vendored Dependencies
Check if upstream packages have newer releases than what we vendored:
```bash
echo "Upstream: $(npm info @vercel/detect-agent version)" && echo "Vendored: $(grep -o 'detect-agent@[0-9.]*' src/cli/telemetry/detect-agent.ts)"
```
If updated, sync changes to `src/cli/telemetry/detect-agent.ts`, bump the version comment, and run `bun test --timeout=120000 src/cli/telemetry/detect-agent.test.ts src/cli/telemetry/clearcut-logger.test.ts`.

### Web Standards & Compatibility Datasets
- **`web-features`**: Automated via `.github/workflows/update-web-features.yml` (Mon/Thu). Can also be run manually with `bun update web-features`, followed by `src/ci/generate-feature-to-groups.ts` and `src/ci/validate-after-web-feature-update.ts`.
- **Compat & WebRef**: Periodically bump `@mdn/browser-compat-data`, `@webref/css`, `@webref/elements`, `@webref/idl`, `caniuse-lite`, and `mdn-data`.

### Document Coherence & Link Integrity
```bash
bun .agents/skills/coherence-auditor/scripts/coherence-audit.ts
```
