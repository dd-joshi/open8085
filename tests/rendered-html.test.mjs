import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://open8085.example/", {
      headers: { accept: "text/html", host: "open8085.example" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Open8085 simulator workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Open8085 Lab/);
  assert.match(html, /Free browser-based 8085 simulator/i);
  assert.match(html, /Open8085 Lab/);
  assert.match(html, /Virtual trainer kit/);
  assert.match(html, /Processor state/);
  assert.match(html, /Program\.asm/);
  assert.match(html, /https:\/\/open8085\.example\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships the real simulator core without starter preview files", async () => {
  const [page, simulator, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/simulator.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<Simulator \/>/);
  assert.match(simulator, /assemble8085/);
  assert.match(simulator, /new CPU8085/);
  assert.match(simulator, /Virtual trainer kit/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(
    access(new URL("../app/_sites-preview", import.meta.url)),
  );
  await access(new URL("../lib/cpu8085.ts", import.meta.url));
  await access(new URL("../lib/assembler8085.ts", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
  await access(projectRoot);
});
