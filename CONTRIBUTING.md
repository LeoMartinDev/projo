# Contributing to projo

Bug reports, fixes and translations are welcome. For a new feature, open an issue first: the
specification in [PRODUCT.md](PRODUCT.md) is the contract, and some things are out of scope on
purpose (music, photos, live TV, casting, file renaming; see §2 of it).

## Setup

- [Bun](https://bun.sh), the canary pinned in `package.json`'s `packageManager`: `bun lint` does not
  exist in stable Bun. Install it with `npm i -g bun@<version>` (or `bun upgrade --canary`).
- `ffmpeg`, `ffprobe` and `fpcalc` (Chromaprint) in the `PATH`.
- For the desktop app only: Rust stable and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
bun install
bun run dev     # server on :8080 (data in .data/), web app on :5173
```

Open `http://localhost:5173`, create the administrator account and add a TMDB key in
**Administration → Metadata**.

## Before a pull request

```bash
bun run lint        # also checks the architecture rules
bun fmt             # formats
bun run typecheck
bun run test        # or bun test <path>
```

CI runs the same, plus the end-to-end tests (`bun run e2e`). Tests that call ffmpeg run in CI against
the version of the Docker image (7.1); an older ffmpeg can fail some of them locally (see "Tests" in
[CLAUDE.md](CLAUDE.md) to run them in the image).

## How the code is organised

[CLAUDE.md](CLAUDE.md) is the full guide, written for coding agents as much as for people: the layout,
the architecture rules (layers, `Result` instead of exceptions, no classes, no `null`, one use case per
file) and where each kind of change goes. The rules are enforced by `bun run lint`, so it will tell you
when one is broken.

- Code, comments, commit messages and docs are in English. UI strings go in both
  `packages/i18n/en.json` and `packages/i18n/fr.json`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) with the area as scope:
  `fix(web): …`, `feat(server): …`, `fix(desktop): …`.
- Database changes go through a new migration (`bun run db:generate`), never by editing an existing one.
- A change in behaviour comes with its test, next to the code (`x.test.ts`).

## License

By contributing, you agree that your contributions are licensed under the [GNU Affero General Public License v3.0](LICENSE).
