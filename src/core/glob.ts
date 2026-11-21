import path from 'node:path';
import { Glob } from 'bun';

export interface GlobOptions {
  cwd?: string;
  absolute?: boolean;
  /** Patterns (relative to cwd) whose matches are dropped from the result. */
  ignore?: string[];
  /** Include only files; directories are matched by default, like the `glob` package. */
  onlyFiles?: boolean;
}

/** Synchronous glob over Bun.Glob. Dotfiles are skipped, as with `glob` defaults. */
export function globSync(patterns: string | string[], options: GlobOptions = {}): string[] {
  const { cwd = process.cwd(), absolute = false, ignore = [], onlyFiles = false } = options;
  const ignoreGlobs = ignore.map((pattern) => new Glob(pattern));
  const results = new Set<string>();
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    for (const match of new Glob(pattern).scanSync({ cwd, onlyFiles })) {
      const relative = match.replaceAll('\\', '/');
      if (ignoreGlobs.some((glob) => glob.match(relative))) continue;
      results.add(absolute ? path.resolve(cwd, relative) : relative);
    }
  }
  return [...results];
}
