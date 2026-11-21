/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression guards for test-suite telemetry suppression.
 *
 * Every test run via `bun test` (whether through `bun run test`, CI,
 * `publish-skills.ts`, or a direct `bun test <file>` invocation) gets
 * `NODE_TEST_CONTEXT` from the bunfig.toml preload, in the test process and any child it spawns.
 * `ClearcutLogger` inspects `NODE_TEST_CONTEXT` so tests never emit product
 * telemetry without requiring `DISABLE_TELEMETRY=1` across scripts or test files.
 */

import test, { mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ClearcutLogger } from './clearcut-logger.ts';
import { WatchdogClient } from './watchdog-client.ts';
import { CommandType } from './types.ts';
import { rootDir } from '../../core/paths.ts';

const ROOT_DIR = rootDir;

test('bun test sets NODE_TEST_CONTEXT and suppresses ClearcutLogger by default', async () => {
  assert.ok(
    process.env.NODE_TEST_CONTEXT !== undefined,
    'NODE_TEST_CONTEXT must be set by the bunfig.toml test preload so ClearcutLogger suppresses telemetry automatically.'
  );

  const savedDisableTelemetry = process.env.DISABLE_TELEMETRY;
  const sendMock = mock.method(WatchdogClient.prototype, 'send', () => {});
  try {
    delete process.env.DISABLE_TELEMETRY;
    const logger = new ClearcutLogger();
    await logger.logToolCommand(50, true, CommandType.LIST);
    assert.strictEqual(
      sendMock.mock.calls.length,
      0,
      'ClearcutLogger must not send telemetry inside bun test even when DISABLE_TELEMETRY is unset.'
    );
  } finally {
    sendMock.mock.restore();
    if (savedDisableTelemetry !== undefined) {
      process.env.DISABLE_TELEMETRY = savedDisableTelemetry;
    }
  }
});

test('root test script runs bun test over src with the telemetry preload configured', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')
  );
  assert.match(pkg.scripts.test, /^bun test .*\bsrc$/, 'root package.json test script must run bun test over src/.');
  const bunfig = fs.readFileSync(path.join(ROOT_DIR, 'bunfig.toml'), 'utf8');
  assert.match(bunfig, /preload\s*=\s*\[[^\]]*src\/core\/test-env\.ts/, 'bunfig.toml must preload the test env that sets NODE_TEST_CONTEXT.');
});
