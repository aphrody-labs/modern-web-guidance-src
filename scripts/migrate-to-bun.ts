#!/usr/bin/env bun
/**
 * Mechanical pnpm/Node -> Bun migration. Idempotent: safe to re-run after merging upstream
 * (GoogleChrome/modern-web-guidance-src), which still ships pnpm and node.
 *
 *   bun scripts/migrate-to-bun.ts [--dry-run] [--skip-install]
 *
 * Handles package.json, workflows, tooling docs, internal scripts and shebangs. Code-level
 * replacements (Bun.Glob, util.styleText, the bunx runner, ...) are plain source edits, not done here.
 *
 * Deliberately untouched (product, not tooling):
 *   - guides/**, skills-src/**, README.md: content for web developers and consumers of the published package.
 *   - src/cli/** (except baseline-status): the published `modern-web-guidance` CLI targets Node users.
 *   - src/harness/base-apps/**, src/grading/target-server.ts: eval fixture apps with their own pnpm lockfiles.
 *   - src/ci/gh-demo-proxy/**: separately deployed Node service.
 *   - fixtures recording commands that agents run (src/harness/lib, agents, *.test.ts).
 *   - `npx modern-web-guidance...` strings: the published package invocation.
 */
import { $ } from "bun";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const dryRun = process.argv.includes("--dry-run");
const skipInstall = process.argv.includes("--skip-install");

const SETUP_BUN_SHA = "0c5077e51419868618aeaa5fe8019c62421857d6"; // oven-sh/setup-bun v2.2.0
/** Workflows that still need Node: the published CLI is tested against it and `npm publish` runs there. */
const KEEPS_NODE = new Set([".github/workflows/ci.yml", ".github/workflows/publish.yml"]);

type Rule = readonly [pattern: RegExp, replacement: string];

const IGNORED = ["node_modules/**", "dist/**", "out/**", "results/**", ".git/**", "guides/**", "skills-src/**", "README.md", "bun.lock", "scripts/migrate-to-bun.ts"];
const PRODUCT = [
  "src/cli/**",
  "src/harness/base-apps/**",
  "src/harness/base-apps.test.ts",
  "src/grading/target-server.ts",
  "src/ci/gh-demo-proxy/**",
  "src/dashboard/vendor/**",
  "src/build/dist.test.ts",
  "src/build/build-dist*.ts",
  "src/build/devsite-markdown*.ts",
  "src/core/macros*.ts",
  "src/harness/npx-intercept.template.ts",
  "src/core/patch-utils*.ts",
];
const PRODUCT_ALLOWED = ["src/cli/baseline-status*.ts"];
/** Fixtures recording what agents or graded fixture apps run, not what this repo runs. */
const OBSERVED_COMMANDS = ["src/harness/lib/**", "src/harness/agents/**", "src/harness/**/*.test.ts", "src/harness/npx-intercept*", "src/grading/**/*.test.ts"];
/** Source files whose `npx` mentions are tooling instructions for contributors or their agents. */
const NPX_SOURCES = ["src/authoring/dev-prompts*.ts"];

const packageScripts = Object.keys((await Bun.file(path.join(root, "package.json")).json()).scripts ?? {});
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const bunVersion = (await $`bun --version`.text()).trim().replace(/-.*$/, "");
const bunRange = `>=${bunVersion.split(".").slice(0, 2).join(".")}.0`;

const RUNTIME_RULES: Rule[] = [
  [/\bpnpm link --global\b/g, "bun link"],
  [/\*\*pnpm\*\* \(requires Node\.js `[^`]*`\)/g, `**Bun** (requires Bun \`${bunRange}\`)`],
  [/\bpnpm install --ignore-workspace\b/g, "bun install"],
  [/\bpnpm (?:install|i)\b/g, "bun install"],
  [/\bpnpm (?:update|up)\b/g, "bun update"],
  [/\bpnpm add\b/g, "bun add"],
  [/\bpnpm (?:remove|rm)\b/g, "bun remove"],
  [/\bpnpm (?:exec|dlx)\b/g, "bunx"],
  [/\bpnpm run(?= )/g, "bun run"],
  // `pnpm <script>` only for scripts declared in package.json.
  ...(packageScripts.length > 0
    ? [[new RegExp(`\\bpnpm (?=(?:${packageScripts.map(escapeRegExp).join("|")})(?![\\w:.-]))`, "g"), "bun run "] as Rule]
    : []),
  // Child-process spawns of the package manager from internal tooling.
  [/\bspawnChild\('pnpm', args\)/g, "spawnChild('bun', ['run', ...args])"],
  [/\bspawn\('pnpm', \['dlx', 'statikk',/g, "spawn('bunx', ['statikk',"],
  [/\bspawn\('pnpm', \[(?=\n\s+'gd',)/g, "spawn('bun', ["],
  [/(?<=spawn\('bun', \[\n\s+)'gd',/g, "'bin/gd.ts',"],
  [/\bexecFileSync\(process\.execPath, \['--test',/g, "execFileSync(process.execPath, ['test',"],
  [/\bcorepack enable pnpm\n\s*/g, ""],
  [/\bnode --test --test-reporter \S+ "src\/\*\*\/\*\.test\.ts"/g, "bun test --timeout=120000 src"],
  [/\bnode --test --test-reporter \S+ /g, "bun test "],
  // node:test has no per-test timeout and several suites spawn the built CLI or Playwright; bun test defaults to 5s.
  [/\bnode --test\b/g, "bun test --timeout=120000"],
  [/\bnode --env-file=\S+ /g, "bun "],
  [/\bnode (?=(?:\.\/)?(?:src|bin|scripts|\.agents)\/)/g, "bun "],
  [/(?<![.\w/-])tsx (?=\S+\.[cm]?[jt]s\b)/g, "bun "],
];
const NPX_RULE: Rule = [/\bnpx (?!(?:-y |--yes )?modern-web-guidance\b)(?:-y |--yes )?/g, "bunx "];
/** Workflows, package.json and docs take every rule. */
const SHELL_RULES: Rule[] = [...RUNTIME_RULES, NPX_RULE];

const SHEBANG_FILES = ["bin/gd.ts"];

function matches(patterns: string[], file: string): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(file));
}

function inScope(file: string): boolean {
  if (matches(IGNORED, file)) return false;
  return !matches(PRODUCT, file) || matches(PRODUCT_ALLOWED, file);
}

function rulesFor(file: string): Rule[] {
  if (matches(OBSERVED_COMMANDS, file)) return [];
  if (/^(?:src|bin)\/.+\.[jt]s$/.test(file) || /^\.agents\/.+\.ts$/.test(file)) {
    return matches(NPX_SOURCES, file) ? SHELL_RULES : RUNTIME_RULES;
  }
  return SHELL_RULES;
}

function applyRules(text: string, rules: Rule[]): string {
  return rules.reduce((current, [pattern, replacement]) => current.replace(pattern, () => replacement), text);
}

const changed: string[] = [];

async function writeIfChanged(file: string, next: string): Promise<void> {
  const target = path.join(root, file);
  const previous = await Bun.file(target).text();
  if (previous === next) return;
  changed.push(file);
  if (!dryRun) await Bun.write(target, next);
}

function listFiles(patterns: string[]): string[] {
  const files = new Set<string>();
  for (const pattern of patterns) {
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: root, dot: true })) {
      const normalized = file.replaceAll("\\", "/");
      if (inScope(normalized)) files.add(normalized);
    }
  }
  return [...files].sort();
}

async function migratePackageJson(): Promise<void> {
  const file = "package.json";
  const pkg = await Bun.file(path.join(root, file)).json();

  for (const [name, command] of Object.entries<string>(pkg.scripts ?? {})) {
    pkg.scripts[name] = applyRules(command, SHELL_RULES)
      // Bun ships a native type checker (`bun check`, same errors as tsc). The lint script stays on the pinned oxlint:
      // embedded `bun lint` ignores .oxlintignore and reports false unused-import errors on re-exports.
      .replace(/(^|&& )tsc\b/g, "$1bun check")
      .replace(/^bun check && (?!bun check -p tsconfig\.guides\.json)/, "bun check && bun check -p tsconfig.guides.json && ");
  }

  pkg.packageManager = `bun@${bunVersion}`;
  pkg.engines = { bun: bunRange };

  const pnpmConfig = pkg.pnpm ?? {};
  const trusted = new Set<string>([...(pkg.trustedDependencies ?? []), ...(pnpmConfig.onlyBuiltDependencies ?? [])]);
  if (trusted.size > 0) pkg.trustedDependencies = [...trusted];
  if (pnpmConfig.overrides) pkg.overrides = { ...pnpmConfig.overrides, ...pkg.overrides };
  delete pkg.pnpm;

  // Replaced natively: glob -> Bun.Glob, minimatch -> Bun.Glob#match, colors -> util.styleText.
  for (const replaced of ["glob", "minimatch", "colors", "tsx", "ts-node"]) {
    delete pkg.dependencies?.[replaced];
    delete pkg.devDependencies?.[replaced];
  }
  // @types/bun brings @types/node in transitively; `bun add` records it after install.
  delete pkg.devDependencies?.["@types/node"];

  await writeIfChanged(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

function setupBunStep(indent: string): string {
  return [
    `${indent}- name: Setup Bun`,
    `${indent}  uses: oven-sh/setup-bun@${SETUP_BUN_SHA} # v2.2.0`,
    `${indent}  with:`,
    `${indent}    bun-version: latest`,
    "",
  ].join("\n");
}

async function migrateWorkflow(file: string): Promise<void> {
  let text = await Bun.file(path.join(root, file)).text();
  const keepsNode = KEEPS_NODE.has(file);

  // "Setup pnpm" + "Setup Node" (cached through pnpm) -> Bun; Node stays where the published CLI or npm publish needs it.
  text = text.replace(
    / *- name: Setup pnpm\n\s+uses: pnpm\/action-setup@\S+ # \S+\n\n( *)- name: Setup Node\n\s+uses: actions\/setup-node@(\S+ # \S+)\n\s+with:\n\s+node-version: (\d+)\n\s+cache: 'pnpm'\n((?:\s+registry-url: .*\n)?)/g,
    (_match, indent: string, nodeRef: string, nodeVersion: string, registry: string) => {
      const nodeStep = [
        "",
        `${indent}- name: Setup Node (published CLI target, npm publish)`,
        `${indent}  uses: actions/setup-node@${nodeRef}`,
        `${indent}  with:`,
        `${indent}    node-version: ${nodeVersion}`,
        ...(registry.trim() ? [`${indent}    ${registry.trim()}`] : []),
        "",
      ].join("\n");
      return setupBunStep(indent) + (keepsNode ? nodeStep : "");
    },
  );
  // Workflows that only set up Node to run TypeScript directly: Bun runs it natively.
  text = text.replace(
    /( *)- name: Setup Node\n\s+uses: actions\/setup-node@\S+ # \S+\n\s+with:\n\s+node-version: \d+\n/g,
    (_match, indent: string) => setupBunStep(indent),
  );
  text = text.replace(
    /pnpm list --depth 0 playwright --json \| jq -r '[^']+'/g,
    () => "jq -r .version node_modules/playwright/package.json",
  );
  await writeIfChanged(file, applyRules(text, SHELL_RULES));
}

async function migrateTextFile(file: string): Promise<void> {
  const text = await Bun.file(path.join(root, file)).text();
  await writeIfChanged(file, applyRules(text, rulesFor(file)));
}

/** The `Bun` global must be declared for oxlint's no-undef. */
async function migrateOxlintConfig(): Promise<void> {
  const file = ".oxlintrc.json";
  if (!(await Bun.file(path.join(root, file)).exists())) return;
  const config = await Bun.file(path.join(root, file)).json();
  config.globals = { ...config.globals, Bun: "readonly" };
  await writeIfChanged(file, `${JSON.stringify(config, null, 2)}\n`);
}

/** The `Bun` global must be declared for oxlint's no-undef. */
async function migrateOxlintConfig(): Promise<void> {
  const file = ".oxlintrc.json";
  if (!(await Bun.file(path.join(root, file)).exists())) return;
  const config = await Bun.file(path.join(root, file)).json();
  config.globals = { ...config.globals, Bun: "readonly" };
  await writeIfChanged(file, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * `bun check` needs Bun's global types in the root tsconfig. They redeclare `fetch` (with `preconnect`), which breaks the
 * graders under guides/ that stub `globalThis.fetch`; those are product code, so they get their own Node-typed project.
 */
async function migrateTsconfig(): Promise<void> {
  const file = "tsconfig.json";
  if (!(await Bun.file(path.join(root, file)).exists())) return;
  const config = await Bun.file(path.join(root, file)).json();
  config.compilerOptions ??= {};
  config.compilerOptions.types = [...new Set([...(config.compilerOptions.types ?? []), "bun"])];
  const guidesGlob = "guides/**/*";
  const hadGuides = (config.include ?? []).includes(guidesGlob);
  config.include = (config.include ?? []).filter((entry: string) => entry !== guidesGlob);
  await writeIfChanged(file, `${JSON.stringify(config, null, 2)}\n`);

  const guidesFile = "tsconfig.guides.json";
  const guidesExists = await Bun.file(path.join(root, guidesFile)).exists();
  if (hadGuides || guidesExists) {
    const guidesConfig = {
      extends: "./tsconfig.json",
      compilerOptions: { types: ["node"] },
      include: [guidesGlob],
      exclude: config.exclude,
    };
    if (!guidesExists && !dryRun) await Bun.write(path.join(root, guidesFile), "{}\n");
    await writeIfChanged(guidesFile, `${JSON.stringify(guidesConfig, null, 2)}\n`);
  }
}

async function migrateShebangs(): Promise<void> {
  for (const file of SHEBANG_FILES) {
    const text = await Bun.file(path.join(root, file)).text();
    await writeIfChanged(file, text.replace(/^#!\/usr\/bin\/env (?:node|tsx)\b.*\n/, "#!/usr/bin/env bun\n"));
  }
}

async function migrateLockfile(): Promise<void> {
  if (dryRun) return;
  const pnpmLock = Bun.file(path.join(root, "pnpm-lock.yaml"));
  const hadBunLock = await Bun.file(path.join(root, "bun.lock")).exists();
  if (!skipInstall) {
    // Without a bun.lock, `bun install` migrates the pnpm resolution from pnpm-lock.yaml first.
    await $`bun install`.cwd(root);
    const pkg = await Bun.file(path.join(root, "package.json")).json();
    if (!pkg.devDependencies?.["@types/bun"]) await $`bun add -d @types/bun`.cwd(root);
  }
  if (await pnpmLock.exists()) {
    await pnpmLock.delete();
    changed.push("pnpm-lock.yaml (deleted)");
  }
  if (!hadBunLock) changed.push("bun.lock (created)");
}

await migratePackageJson();
for (const file of listFiles([".github/workflows/*.yml"])) await migrateWorkflow(file);
for (const file of listFiles([
  "*.md",
  "docs/**/*.md",
  ".agents/**/*.md",
  ".github/**/*.md",
  "src/**/*.md",
  "bin/**/*.ts",
  "src/**/*.ts",
  "src/**/*.js",
  ".agents/**/*.ts",
])) {
  await migrateTextFile(file);
}
await migrateShebangs();
await migrateOxlintConfig();
await migrateTsconfig();
await migrateLockfile();

console.log(`${dryRun ? "[dry-run] would change" : "changed"} ${changed.length} file(s)`);
for (const file of changed) console.log(`  ${file}`);
