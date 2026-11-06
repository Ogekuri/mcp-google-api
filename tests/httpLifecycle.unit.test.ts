import assert from "node:assert/strict";
import test from "node:test";

// cli.ts is also the executable entrypoint and detects direct execution from
// process.argv[1]. Import it with a neutral argv value so the test process
// does not start an HTTP server as a side effect.
const originalArgv1 = process.argv[1];
process.argv[1] = "http-lifecycle-unit-test";
const { createShutdownHandler, startServer } = await import("../src/cli.js");
process.argv[1] = originalArgv1;

const { BaseMcpServer } = await import("../src/core/BaseMcpServer.js");
const { resolveRuntimeConfig, validateHttpEndpoint } = await import("../src/utils/configResolver.js");
const { loadCliSettings } = await import("../src/utils/cliSettings.js");

test("invalid or unset port values are marked as startup failures", () => {
  const invalid = validateHttpEndpoint(resolveRuntimeConfig({ ...loadCliSettings(), port: Number.NaN }));
  assert.equal(invalid.valid, false);

  const zero = validateHttpEndpoint(resolveRuntimeConfig({ ...loadCliSettings(), port: 0 }));
  assert.equal(zero.valid, false);

  const unset = validateHttpEndpoint(resolveRuntimeConfig(loadCliSettings()));
  assert.equal(unset.valid, true);
});

test("startServer marks the instance failed and starts zero listeners on an invalid port", async () => {
  const outcome = await startServer(Number.NaN);
  assert.equal(outcome.started, 0);
  assert.equal(outcome.failed, 1);
  assert.deepEqual(outcome.servers, []);
});

test("startServer marks the instance failed when the port is out of range", async () => {
  const outcome = await startServer(0);
  assert.equal(outcome.started, 0);
  assert.equal(outcome.failed, 1);
});

test("BaseMcpServer HTTP lifecycle starts on an ephemeral port and stops orderly", async () => {
  const server = new BaseMcpServer("lifecycle-test", []);
  await server.startHttpServer(0, "127.0.0.1");
  await server.stopHttpServer();
  // Second stop is idempotent: resolves without throwing.
  await server.stopHttpServer();
});

test("shutdown handler stops every server once and exits zero", async () => {
  let stops = 0;
  const fakeServer = {
    stopHttpServer: async () => {
      stops++;
    },
  };
  const exitCodes: number[] = [];
  const handler = createShutdownHandler([fakeServer as unknown as BaseMcpServer], (code) => exitCodes.push(code));

  await handler("SIGTERM");
  await handler("SIGINT");

  assert.equal(stops, 1);
  assert.deepEqual(exitCodes, [0]);
});
