---
name: baseline-status
description: Use this skill to check the browser support and Baseline status of web features.
---

# Web Baseline Status Skill

Use this skill when you need to verify if a web feature is ready for use or when you need browser support data for specific features.

## Tool Usage

**Basic Search:**
To search for features by ID or description:
```bash
bun run baselinestatus <query>
```
Example: `bun run baselinestatus over`

**JSON Output:**
To get structured output for easier parsing:
```bash
bun run baselinestatus <query> --json
```

Example: `bun run baselinestatus over --json`

### Baseline Status Mapping

The output maps internal status codes to human-readable terms:
- **Widely** (`high`): Supported by all major browsers for a significant time.
- **Newly** (`low`): Recently supported by all major browsers.
- **Limited** (`false`): Not yet supported by all major browsers.

