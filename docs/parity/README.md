# Parity Acceptance Suite

This suite operationalizes the parity evaluation matrix into owned checks, automated gates, and weekly reporting.

## Inputs
- Evaluation matrix: `docs/parity/parity-evaluation-matrix.json`
- Manual checklist with owners: `docs/parity/manual-parity-checklist.md`

## Automated critical flows
- Message lifecycle, permissions, moderation: `npm run test:parity:critical --workspace=apps/web`
- Accessibility + focus order + high-risk visual/navigation regressions: `npm run test:a11y:focus --workspace=apps/web`
- Voice join/reconnect lifecycle: `npm test --workspace=apps/signal`

## CI gates
- PR gate job: `.github/workflows/ci.yml` → `parity-gates`

## Weekly trend report
- Workflow: `.github/workflows/parity-weekly-report.yml`
- Report generator: `npm run parity:report`
- Outputs:
  - `docs/parity/reports/weekly-parity-report.md`
  - `docs/parity/reports/parity-trend.json`
