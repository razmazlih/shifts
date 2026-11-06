# Simplified smart scheduling

## Change

The previous setup dialog showed the mode, seven dates, both teams, template controls, and several explanations at once. The normal populated-week flow now shows a short summary and **יצירת הצעה לבדיקה**. **אפשרויות נוספות** reveals the day, team, mode, and template controls when needed.

- Existing defaults are unchanged: fill gaps, all seven days, both teams. Daily-template target and team selections passed in from template management are preserved.
- The selected scope and repair warning remain visible when options are collapsed. Template selection is immediately visible for an empty week or when opening with a selected template.
- Preview, explicit apply-to-draft, cancel, stale-data errors, locking, and server validation are unchanged. No database, migration, scheduler, or API changes are included.
- The template selector stays mounted in the same location throughout setup so keyboard focus is not lost when selecting or clearing a template.

## Verification on 2026-11-06

Base: `ddc89337db248fc394182030cae5c561070c8115` from `main`.

Passed with Node 22.23.4:

- `npm test`: 133 tests across 16 files.
- `npm run lint`.
- `npm run typecheck`.
- `npm run build` (Next.js 16.4.5).
- Independent static review of state, template handling, accessibility, and unchanged requests.

**Browser UI verification remains blocked, not passed.** The installed Chromium cannot create its process socket in this execution environment, including the approved elevated launch. The cloud browser cannot reach the local harness, and the supported Playwright headless-shell download did not return a valid archive. No screenshot of the changed screen is claimed. The existing database-writing E2E suites were deliberately not run. No production database, migration, restore, or deployment was performed.

## Isolated UI tests and demo

The new harness renders the real component and app styles with fictional data. It listens only on localhost, has no database connection, and rejects every API request. Playwright intercepts API calls inside each test.

```bash
npm ci
npx playwright install chromium
npm run test:ui
```

To use an installed compatible browser, set `CHROMIUM_PATH` to its executable. To inspect manually:

```bash
node scripts/serve-smart-schedule-harness.mjs
```

Open `http://127.0.0.1:3348`. Use `/?empty`, `/?empty&template=daily&target=3&group=PATROL`, or `/?empty&noTemplates&templateError` to inspect empty-week, inherited-scope, and template-error states. Manual preview requests intentionally fail because this demo has no backend.

The 8 UI tests cover default payload and separate apply, custom scope and validation, template focus, empty weeks, pending/retry/dismissal flows, and RTL overflow/actions at 360, 390, and 1440 pixels. They are committed for rerunning in a browser-capable environment, but their assertions did not execute here because browser launch failed.

Before merging, run the UI suite, inspect its screenshots, and run the relevant existing E2E specs on an isolated test database. Do not point either preview or tests at the production database.

## Undo

The change is isolated to `simplify/smart-scheduling`. Closing the draft PR leaves `main` and production unchanged. After a future merge, reverting its UI commit restores the previous dialog; there is no data migration or data rollback to perform.
