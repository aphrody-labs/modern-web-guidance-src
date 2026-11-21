// `bun test` preload. node:test marks test processes (and their children) with NODE_TEST_CONTEXT, and
// ClearcutLogger keys telemetry suppression off it; Bun does not set it, so do it here.
process.env.NODE_TEST_CONTEXT ??= 'child-v8';
