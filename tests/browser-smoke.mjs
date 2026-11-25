import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const baseUrl = process.env.OPEN8085_BASE_URL ?? "http://localhost:3000/";
const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.CHROME_BIN,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  assert.ok(executable, "Chrome was not found; set CHROME_PATH for browser smoke testing.");
  return executable;
}

const profile = mkdtempSync(join(tmpdir(), "open8085-browser-smoke-"));
const debuggingPort = 9300 + (process.pid % 500);
const chrome = spawn(
  chromeExecutable(),
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
);

let socket;
try {
  let targets;
  // Up to 30 s: Chrome can start slowly on shared CI runners.
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      targets = await (
        await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)
      ).json();
      if (targets.some((target) => target.type === "page")) break;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }

  const target = targets?.find((candidate) => candidate.type === "page");
  assert.ok(target, "Chrome DevTools target was not available.");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.onopen = resolveOpen;
    socket.onerror = rejectOpen;
  });

  let nextId = 1;
  const pending = new Map();
  const events = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const handler = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(JSON.stringify(message.error)));
      else handler.resolve(message.result);
    } else if (message.method) {
      events.push(message);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolveMessage, rejectMessage) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve: resolveMessage, reject: rejectMessage });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.text);
    return response.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Log.enable");
  await send("Page.navigate", { url: baseUrl });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await evaluate("document.readyState")) === "complete") break;
    await delay(100);
  }
  await delay(1_000);

  const assemble = async (source) => {
    await evaluate(`(() => {
      const editor = document.querySelector('textarea[aria-label="8085 assembly source code"]');
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setValue.call(editor, ${JSON.stringify(source)});
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      return editor.value;
    })()`);
    await delay(100);
    await evaluate(`(() => {
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'Assemble').click();
      return true;
    })()`);
    await delay(300);
    return evaluate(`(() => ({
      status: document.querySelector('.status-message')?.textContent.trim(),
      build: document.querySelector('.editor-footer')?.innerText.replace(/\\s+/g, ' ').trim(),
      bytes: [...document.querySelectorAll('input.memory-cell')].slice(0, 5).map((cell) => cell.value),
    }))()`);
  };

  const invalidAlias = await assemble("ORG 2000H\nLDAX BC\nHLT");
  assert.match(invalidAlias.build, /assembler error/i);
  assert.match(invalidAlias.build, /use B instead of BC/i);

  const invalidComma = await assemble("ORG 2000H\nMOV A B\nHLT");
  assert.match(invalidComma.build, /assembler error/i);
  assert.match(invalidComma.build, /separated by a comma/i);

  const canonical = await assemble("ORG 2000H\nLDAX B\nHLT");
  assert.match(canonical.build, /Build successful/i);
  assert.deepEqual(canonical.bytes.slice(0, 2), ["0A", "76"]);

  const negative = await assemble("ORG 2000H\nMVI A,-1\nHLT");
  assert.match(negative.build, /Build successful/i);
  assert.deepEqual(negative.bytes.slice(0, 3), ["3E", "FF", "76"]);

  const asciiWord = await assemble("ORG 2000H\nLXI B,'AZ'\nHLT");
  assert.match(asciiWord.build, /Build successful/i);
  assert.deepEqual(asciiWord.bytes.slice(0, 4), ["01", "5A", "41", "76"]);

  await assemble("ORG 2000H\nMVI A,0ABH\nHLT");
  await evaluate(`(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Step').click();
    return true;
  })()`);
  await delay(250);
  const stepped = await evaluate(`(() => ({
    pc: document.querySelector('input[aria-label="Program Counter register in hexadecimal"]')?.value,
    a: document.querySelector('input[aria-label="A register in hexadecimal"]')?.value,
    insight: document.querySelector('.insight-content')?.innerText.replace(/\\s+/g, ' ').trim(),
  }))()`);
  assert.equal(stepped.pc, "2002");
  assert.equal(stepped.a, "AB");
  assert.match(stepped.insight, /MVI A, 0ABH/);

  await evaluate(`(() => {
    [...document.querySelectorAll('[role="tab"]')]
      .find((tab) => tab.textContent.trim() === 'Trace').click();
    return true;
  })()`);
  await delay(100);
  const traceMnemonic = await evaluate(
    "document.querySelector('.trace-mnemonic')?.textContent.trim()",
  );
  assert.equal(traceMnemonic, "MVI A, 0ABH");
  await evaluate(`(() => {
    [...document.querySelectorAll('[role="tab"]')]
      .find((tab) => tab.textContent.trim() === 'Memory').click();
    return true;
  })()`);
  await delay(100);

  // Virtual 8255/8155: switch on, drive the 8255 from a program, switch off again.
  const clickChipMode = (label) => evaluate(`(() => {
    [...document.querySelectorAll('.chips-control button')]
      .find((button) => button.textContent.trim() === ${JSON.stringify(label)}).click();
    return true;
  })()`);
  await clickChipMode("On");
  await delay(200);
  assert.equal(await evaluate("Boolean(document.querySelector('.chip-bench'))"), true);
  await assemble("ORG 2000H\nMVI A,89H\nOUT 83H\nMVI A,0C1H\nOUT 80H\nHLT");
  for (let index = 0; index < 4; index += 1) {
    await evaluate(`(() => {
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === 'Step').click();
      return true;
    })()`);
    await delay(150);
  }
  const chipState = await evaluate(`(() => ({
    summary: document.querySelector('.chip-say')?.textContent,
    last: document.querySelector('.chip-last')?.textContent,
  }))()`);
  assert.equal(chipState.summary, "Mode 0 · Port A out · Port B out · Port C in");
  assert.match(chipState.last, /OUT 80H ← C1H/);
  await clickChipMode("Off");
  await delay(200);
  assert.equal(await evaluate("Boolean(document.querySelector('.chip-bench'))"), false);

  await evaluate(`(() => {
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Opcodes').click();
    return true;
  })()`);
  await delay(200);
  const reference = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.instruction-card')];
    const byName = (name) => cards
      .find((card) => card.querySelector('.instruction-name strong')?.textContent === name)
      ?.innerText.replace(/\\s+/g, ' ').trim();
    return {
      count: cards.length,
      allHaveFacts: cards.every((card) => /Opcode /.test(card.innerText) && /T-states /.test(card.innerText)),
      mov: byName('MOV'),
      jnz: byName('JNZ'),
      hlt: byName('HLT'),
    };
  })()`);
  assert.equal(reference.count, 80);
  assert.equal(reference.allHaveFacts, true);
  assert.match(reference.mov, /Opcode 01dddsss/);
  assert.match(reference.mov, /4 \(register\), 7 \(memory\)/);
  assert.match(reference.jnz, /7 \(not taken\), 10 \(taken\)/);
  assert.match(reference.hlt, /T-states 5/);

  const referenceAccessibility = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const search = document.querySelector('input[aria-label="Search instructions"]');
    return {
      labelled: dialog?.getAttribute('aria-labelledby') === 'reference-title',
      modal: dialog?.getAttribute('aria-modal') === 'true',
      searchFocused: document.activeElement === search,
    };
  })()`);
  assert.deepEqual(referenceAccessibility, {
    labelled: true,
    modal: true,
    searchFocused: true,
  });

  await evaluate(`(() => {
    const search = document.querySelector('input[aria-label="Search instructions"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(search, 'JNZ');
    search.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await delay(150);
  const referenceSearch = await evaluate(`(() => ({
    count: document.querySelectorAll('.instruction-card').length,
    mnemonic: document.querySelector('.instruction-name strong')?.textContent,
  }))()`);
  assert.deepEqual(referenceSearch, { count: 1, mnemonic: "JNZ" });

  await evaluate(`(() => {
    const search = document.querySelector('input[aria-label="Search instructions"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(search, '');
    search.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await delay(150);
  assert.equal(
    await evaluate("document.querySelectorAll('.instruction-card').length"),
    80,
  );

  const pageState = await evaluate(`(() => ({
    contentLength: document.body.innerText.trim().length,
    overlay: Boolean(document.querySelector('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay')),
    title: document.title,
  }))()`);
  assert.ok(pageState.contentLength > 1_000);
  assert.equal(pageState.overlay, false);

  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
  });
  const screenshotPath = join(tmpdir(), "open8085-browser-smoke.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return true;
  })()`);
  await delay(150);
  const referenceClosedByEscape = await evaluate(
    "!document.querySelector('[role=dialog]')",
  );
  assert.equal(referenceClosedByEscape, true);

  const requestUrls = new Map(
    events
      .filter((event) => event.method === "Network.requestWillBeSent")
      .map((event) => [event.params.requestId, event.params.request.url]),
  );
  const isLocalVinextFontUrl = (url) =>
    typeof url === "string" &&
    url.startsWith("file:///") &&
    url.includes("/.vinext/fonts/") &&
    url.endsWith(".woff2");

  const ignoredLocalFontFailures = events.filter(
    (event) =>
      process.platform === "win32" &&
      event.method === "Network.loadingFailed" &&
      event.params.type === "Font" &&
      event.params.blockedReason === "other" &&
      !event.params.errorText &&
      isLocalVinextFontUrl(requestUrls.get(event.params.requestId)),
  );
  const resourceFailures = events.filter(
    (event) =>
      event.method === "Network.loadingFailed" &&
      !ignoredLocalFontFailures.includes(event),
  );
  const badResponses = events.filter(
    (event) =>
      event.method === "Network.responseReceived" &&
      event.params.response.status >= 400,
  );
  const ignoredLocalFontConsoleProblems = events.filter(
    (event) =>
      process.platform === "win32" &&
      event.method === "Log.entryAdded" &&
      event.params.entry.source === "javascript" &&
      event.params.entry.level === "error" &&
      event.params.entry.url === baseUrl &&
      event.params.entry.text.startsWith(
        "Not allowed to load local resource: ",
      ) &&
      isLocalVinextFontUrl(
        event.params.entry.text.slice(
          "Not allowed to load local resource: ".length,
        ),
      ),
  );
  const consoleProblems = events.filter(
    (event) =>
      !ignoredLocalFontConsoleProblems.includes(event) &&
      (event.method === "Runtime.exceptionThrown" ||
        event.method === "Log.entryAdded" ||
        (event.method === "Runtime.consoleAPICalled" &&
          ["error", "warning"].includes(event.params.type))),
  );
  assert.deepEqual(resourceFailures, []);
  assert.deepEqual(badResponses, []);
  assert.deepEqual(consoleProblems, []);

  console.log(
    JSON.stringify(
      {
        url: baseUrl,
        pageState,
        checks: {
          invalidAlias: "rejected",
          invalidComma: "rejected",
          canonical: canonical.bytes.slice(0, 2),
          negative: negative.bytes.slice(0, 3),
          asciiWord: asciiWord.bytes.slice(0, 4),
          stepped,
          traceMnemonic,
          reference,
          referenceAccessibility,
          referenceSearch,
          referenceClosedByEscape,
        },
        ignoredLocalFontFailures: ignoredLocalFontFailures.length,
        ignoredLocalFontConsoleProblems:
          ignoredLocalFontConsoleProblems.length,
        screenshotPath,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    socket?.close();
  } catch {
    // The browser may already have closed after a failed assertion.
  }
  try {
    chrome.kill();
  } catch {
    // The browser may already have exited.
  }
  await delay(150);
  rmSync(resolve(profile), { recursive: true, force: true });
}
