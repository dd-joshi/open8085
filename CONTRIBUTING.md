# Contributing to Open8085 Lab

Thank you for helping improve Open8085 Lab. Contributions should strengthen its
value as an Intel 8085 teaching tool while preserving deterministic simulator
behaviour.

## Before starting

- Search existing issues and pull requests before proposing duplicate work.
- Use an issue to discuss substantial CPU, assembler, instruction, or interface
  changes before implementing them.
- Keep pull requests focused on one behaviour or closely related group of
  changes.

## Development setup

Requirements:

- Node.js 22.13.0 or newer
- npm
- A modern browser

Install and start the local application:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000/`.

## Quality requirements

Before submitting a pull request:

```bash
npm run lint
npm test
```

Contributions must also follow these project guardrails:

- Preserve 8-bit and 16-bit wrapping behaviour.
- Keep CPU, assembler, memory, port, and timing changes covered by tests.
- Keep instruction explanations deterministic and based on executed opcodes.
- Add accessible names and keyboard behaviour for new controls.
- Check desktop and narrow-screen layouts.
- Keep credentials, environment files, generated output, and local logs out of
  commits.
- Update the README when user-visible behaviour changes.

## Pull requests

Describe:

- The problem being solved
- The user-visible or engine behaviour that changed
- Tests added or updated
- The verification commands run
- Screenshots for visible interface changes, when available

By contributing, you agree that your contribution will be distributed under
the MIT License.
