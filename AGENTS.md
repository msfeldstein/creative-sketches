# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is a static front-end creative coding sketch gallery. There is no backend, no database, and no API — everything runs client-side in the browser. The only service needed is the **Vite dev server**.

### Running the dev server

```bash
npm run dev    # Starts Vite on http://localhost:3000
```

### Build

```bash
npm run build  # Vite production build → dist/
```

The workspace rule references a custom build command called "BUIDL" — use that instead of `npm build` when building.

### Key notes

- **No lint/test tooling** is configured (`package.json` has no `lint`, `test`, or `check` scripts; no ESLint/Prettier configs exist).
- **No TypeScript** — all source is vanilla JavaScript ES modules.
- **No environment variables or `.env` files** are needed.
- **Audio files** (`*.mp3`) are gitignored; audio-reactive sketches expect users to drag-drop MP3s into the Song Manager UI at `/sketches/songs/`.
- Some sketches load Three.js from `unpkg.com` CDN via import maps — this requires internet access for those specific sketches.
- The Vite config auto-discovers sketch HTML entry points from subdirectories of `sketches/`.
