# TripCast coding standards

These instructions apply to TripCast, a React/Vite frontend with a same-origin
Cloudflare Worker API and Supabase authentication and persistence. See `README.md`
for setup, runtime requirements and detailed application contracts.

## Scope

- Preserve existing user changes, architecture and module boundaries. Keep edits
  focused on the requested task.
- Respect workspace and Git repository boundaries. `playbook/` is a separate Git
  submodule with its own guidance; this file grants no permission to modify it.
- Exclude dependencies, generated files, build output and archived Stitch references
  from routine source maintenance.
- Do not commit, push or deploy without explicit approval.

## Formatting and readability

- Use the existing root `.prettierrc.json`; do not introduce competing style rules.
- Before completing a task, run the installed Prettier on every modified JavaScript,
  JSX, CSS or other Prettier-supported source file: `npx prettier --write <files>`.
- Do not reformat unrelated files during small changes. `npm run format` and
  `npm run format:check` cover all JS, JSX and CSS in `src/` and `tests/`; use the
  latter when a repository-wide check is appropriate, or check explicit file paths.
- Keep formatting-only changes separate from functional changes when practical.
- Prefer straightforward control flow and descriptive names over compressed
  expressions, unnecessary nested ternaries and dense one-line branches.
- Keep functions focused. Refactor complex logic only when it improves understanding
  without unnecessary scope or risk.

## Documentation

- Add concise JSDoc to significant exported functions and complex helpers where useful.
  Describe purpose, important inputs/outputs, assumptions and invariants.
- Explain non-obvious business rules, transformations and security constraints;
  prefer why a decision exists over narrating obvious statements.
- Update comments when behavior changes. Avoid boilerplate JSDoc, excessive comments
  and decorative headings.

## Application invariants

- Keep travel dates as date-only `YYYY-MM-DD` values. Preserve arrival-inclusive,
  departure-exclusive allocation and destination/provider timezone handling.
- Preserve missing measurements versus zero, normalized units and explicit forecast
  classifications. Long-range estimates retain their provisional status.
- Keep OpenWeather requests and credentials behind the Worker API; preserve validated
  inputs, allowlisted upstream destinations and bounded request handling.
- Preserve Supabase verification, user-owned trip access and revision-based conflict
  detection. Administrative account deletion must target the verified current user;
  local session cleanup follows confirmed deletion.
- Never expose API secrets or administrative credentials in frontend code, public
  environment variables, logs or committed files. Public Supabase settings are distinct
  from administrative secrets.
- Avoid new dependencies or infrastructure unless justified by the requested work.

## Verification

- Format modified files, then run targeted Prettier checks, ESLint and Oxlint.
- Run relevant targeted tests for executable changes. Client tests use
  `npm run test:client -- <test-files>`; Worker tests use
  `npm run test:worker -- <test-files>`.
- Run `npm run build` when executable or build-related changes warrant it.
- Avoid broad test suites and builds for documentation-only changes; check the
  documentation and confirm application source remains unchanged instead.
- Report checks performed, limitations, and pre-existing failures separately from
  regressions. Do not assume a documented historical failure is still present.
