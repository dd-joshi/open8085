import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const smokeScript = fileURLToPath(
  new URL("./browser-smoke.mjs", import.meta.url),
);
const wranglerScript = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);

async function runSmoke(baseUrl) {
  const smoke = spawn(process.execPath, [smokeScript], {
    cwd: process.cwd(),
    windowsHide: true,
    env: { ...process.env, OPEN8085_BASE_URL: baseUrl },
    stdio: "inherit",
  });

  await new Promise((resolveRun, rejectRun) => {
    smoke.once("error", rejectRun);
    smoke.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          `Browser smoke exited with ${code ?? `signal ${signal ?? "unknown"}`}.`,
        ),
      );
    });
  });
}

async function waitUntilReady(server, baseUrl, serverOutput) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Built Worker exited before browser smoke.\n${serverOutput()}`,
      );
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    await delay(500);
  }
  throw new Error(
    `Timed out waiting for ${baseUrl}.\n${serverOutput()}`,
  );
}

async function stopServer(server) {
  if (server.exitCode !== null || server.pid === undefined) return;

  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }

  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    return;
  }
  await Promise.race([
    new Promise((resolveExit) => server.once("exit", resolveExit)),
    delay(5_000),
  ]);
  if (server.exitCode === null) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // The process group exited between the check and signal.
    }
  }
}

const externalBaseUrl = process.env.OPEN8085_BASE_URL;
if (externalBaseUrl) {
  await runSmoke(externalBaseUrl);
} else {
  const port = 3200 + (process.pid % 500);
  const baseUrl = `http://127.0.0.1:${port}/`;
  const windows = process.platform === "win32";
  const server = spawn(
    process.execPath,
    [
      wranglerScript,
      "dev",
      "--config",
      "dist/server/wrangler.json",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      detached: !windows,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const appendOutput = (chunk) => {
    output = `${output}${chunk}`.slice(-8_000);
  };
  server.stdout.on("data", appendOutput);
  server.stderr.on("data", appendOutput);

  try {
    await waitUntilReady(server, baseUrl, () => output);
    await runSmoke(baseUrl);
  } finally {
    await stopServer(server);
  }
}
