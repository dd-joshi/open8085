# Open8085 Lab

A free, browser-based Intel 8085 programming lab for writing, assembling,
running, and debugging assembly programs without installing software.

## What is included

- Complete documented Intel 8085 CPU emulation
- Two-pass assembler with labels, expressions, and common directives
- Run, pause, single-step, reset, breakpoints, and execution trace
- Editable registers, flags, 64K memory, and 256 I/O ports
- Virtual 8-bit LED output and input-switch trainer kit
- Six practical student exercises with prepared memory data
- Searchable instruction reference and local source autosave

Everything runs locally in the browser. No account, backend, or paid service is
required to use the simulator.

## Development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
npm test
```

`npm test` builds the site, validates the assembler and CPU together, and checks
the server-rendered application shell.
