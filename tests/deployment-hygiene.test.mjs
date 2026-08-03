import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const origin = "https://open8085.example";
let workerPromise;

function loadWorker() {
  if (!workerPromise) {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
    workerPromise = import(workerUrl.href).then(({ default: worker }) => worker);
  }

  return workerPromise;
}

async function fetchWorker(path) {
  const worker = await loadWorker();

  return worker.fetch(
    new Request(new URL(path, origin), {
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

test("declares the shipped SVG favicon in rendered metadata", async () => {
  await access(new URL("../public/favicon.svg", import.meta.url));

  const response = await fetchWorker("/");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(
    html,
    /<link(?=[^>]*\brel="icon")(?=[^>]*\bhref="\/favicon\.svg")[^>]*>/i,
  );
});

test("redirects only the exact legacy favicon path to the same-origin SVG", async () => {
  const target = `${origin}/favicon.svg`;
  const response = await fetchWorker(
    "/favicon.ico?next=https%3A%2F%2Fevil.example%2Ffavicon.svg",
  );

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), target);

  const lookalikeResponse = await fetchWorker("/favicon.ico/");
  assert.notEqual(lookalikeResponse.headers.get("location"), target);
});
