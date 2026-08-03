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
  const textHtml = html.replaceAll("<!-- -->", "");
  const visibleText = textHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  assert.match(html, /<title>Open8085 Lab/);
  assert.match(html, /Free browser-based 8085 simulator/i);
  assert.match(html, /Open8085 Lab/);
  assert.match(html, /IITRAM/);
  assert.match(html, /Dept\. of ECSE/);
  assert.match(html, /Designed by/);
  assert.match(html, /D\. Joshi/);
  assert.match(html, /Virtual trainer kit/);
  assert.match(html, /Processor state/);
  assert.match(html, />Insight</);
  assert.match(html, /Step the program to see instruction insight/i);
  assert.match(html, /Flag register/i);
  assert.match(visibleText, /F\s*=\s*02H\s*·\s*00000010B/i);
  const flagGrid = textHtml.match(
    /<div class="flag-byte-grid"[^>]*>([\s\S]*?)<\/div>/,
  )?.[1];
  assert.ok(flagGrid, "The complete Flag Register grid should render");
  const flagCells = [
    ...flagGrid.matchAll(
      /<span class="flag-bit([^"]*)"><span class="flag-position">D(\d)<\/span><span class="flag-name">([^<]+)<\/span><strong>([01])<\/strong><\/span>/g,
    ),
  ].map((match) => ({
    bit: Number(match[2]),
    meaning: match[3],
    value: Number(match[4]),
    constant: match[1].includes("flag-bit--constant"),
  }));
  assert.deepEqual(flagCells, [
    { bit: 7, meaning: "S", value: 0, constant: false },
    { bit: 6, meaning: "Z", value: 0, constant: false },
    { bit: 5, meaning: "UNUSED", value: 0, constant: true },
    { bit: 4, meaning: "AC", value: 0, constant: false },
    { bit: 3, meaning: "UNUSED", value: 0, constant: true },
    { bit: 2, meaning: "P", value: 0, constant: false },
    { bit: 1, meaning: "FIX", value: 1, constant: true },
    { bit: 0, meaning: "CY", value: 0, constant: false },
  ]);
  assert.equal((textHtml.match(/Total T-states/gi) ?? []).length, 1);
  assert.match(html, /Program\.asm/);
  assert.match(html, />Examples</);
  assert.match(html, />Experiments</);
  assert.match(textHtml, /01\s*·\s*Write an ALP to multiply two 8-bit data/i);
  assert.match(textHtml, /01–02 of 02/i);
  assert.doesNotMatch(html, /Fibonacci|Find the largest/i);
  assert.match(html, /1,000 instructions per second/i);
  assert.doesNotMatch(
    html,
    /100 instructions per second|10,000 instructions per second/i,
  );
  assert.match(html, /Number converter/i);
  assert.match(html, /Hexadecimal byte value/i);
  assert.match(html, /Decimal byte value/i);
  assert.match(html, /Binary byte value/i);
  assert.match(
    html,
    /href="https:\/\/github\.com\/dd-joshi\/open8085"[^>]*target="_blank"/i,
  );
  assert.match(html, /View Open8085 source code on GitHub/i);
  assert.match(html, /https:\/\/open8085\.example\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships the real simulator core without starter preview files", async () => {
  const [page, simulator, globals, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/simulator.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<Simulator \/>/);
  assert.match(simulator, /assemble8085/);
  assert.match(simulator, /instruction\.opcode/);
  assert.match(simulator, /instruction\.tStates/);
  assert.match(simulator, /new CPU8085/);
  assert.match(simulator, /createInstructionInsight/);
  assert.match(simulator, /Virtual trainer kit/);
  assert.match(simulator, /flag-bit--constant/);
  assert.doesNotMatch(simulator, /entry\.fixed|\b"fixed"\b/);
  assert.match(
    simulator,
    /entry\.flag\s*&&\s*changedFlags\.has\(entry\.flag\)/,
  );
  assert.match(globals, /\.flag-bit--constant/);
  assert.doesNotMatch(globals, /\.flag-bit\.fixed/);
  assert.doesNotMatch(
    simulator,
    /flag-stack|flag-grid|status-telemetry|currentInstruction/,
  );
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(
    access(new URL("../app/_sites-preview", import.meta.url)),
  );
  await access(new URL("../lib/cpu8085.ts", import.meta.url));
  await access(new URL("../lib/assembler8085.ts", import.meta.url));
  await access(new URL("../lib/insight8085.ts", import.meta.url));
  await access(new URL("../lib/lab-experiments.json", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
  await access(projectRoot);
});
