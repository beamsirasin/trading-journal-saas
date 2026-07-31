# Phase 12 — Hardening & Launch Readiness

**Depends on:** all · **Blocks:** public launch

## Goal

Cross-cutting audits that only make sense once the whole surface exists, plus a deployment with a rehearsed rollback path.

Nothing here is new product surface. If this phase produces features, scope has slipped.

## Scope

### Security audit

- **Cross-tenant isolation sweep.** Enumerate every server action and query helper; assert each is workspace-scoped. Re-run Phase 01 isolation tests against the full schema — every table added since then.
- Every mutation: authenticated → member → role → ownership → entitlement
- Confirm no client-supplied workspace/user ID reaches a query
- Rate limiting on auth, magic-link send, and mutation endpoints
- Security headers: CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`
- Verify no secrets in the client bundle, no secrets in git history
- Dependency audit; resolve high and critical
- Confirm error responses leak no internals in production

### Accessibility audit

- Keyboard-only traversal of every flow, including charts and dialogs
- Screen reader pass on core flows; charts expose an accessible data table alternative
- WCAG AA contrast in both themes, including chart colors
- Visible focus everywhere; focus trapped in dialogs and returned on close
- Form errors programmatically associated with their inputs
- `prefers-reduced-motion` verified globally
- Automated `axe` pass plus manual review — automation catches perhaps half

### Responsive audit

320 / 375 / 768 / 1024 / 1440 / 1920. No horizontal page overflow anywhere; wide content scrolls inside its own container. Charts readable at every size. Touch targets ≥ 44px. Verify on real iOS Safari and Android Chrome, not only devtools emulation.

### State completeness sweep

Every data surface has loading, empty, error, and success states. Empty states teach the next action. Errors are recoverable and human-readable — no raw stack traces, no bare "Something went wrong".

### Performance

- Lighthouse ≥ 90 on app routes, ≥ 95 on marketing
- Bundle analysis; code-split heavy chart code
- Dashboard < 500ms at 5,000 trades
- N+1 query check on list and dashboard routes
- Verify indexes are actually used (`EXPLAIN ANALYZE`, not assumption)

### E2E tests (Playwright)

Signup → onboarding → create account → create strategy → log trade → view dashboard. Plus: trial expiry → read-only; entitlement limit blocking; **cross-tenant access denial**.

### Deployment

- Neon production database provisioned; `DATABASE_URL` via environment only
- Migrations run as an explicit, reviewed step — never automatically on boot
- Staging environment mirroring production
- Health check endpoint; error tracking (Sentry or equivalent) behind an adapter
- Backups verified by performing an actual **restore**, not by trusting that backups exist
- **Rollback path documented and rehearsed**, including the migration-reversal procedure

### Documentation

`README` (setup, scripts, architecture), `docs/formulas.md` final, `docs/deployment.md`, `docs/runbook.md` (restore, rollback, common incidents), `CLAUDE.md` updated with every decision made along the way.

## Out of scope

New features. Anything not listed belongs to a post-MVP phase.

## Definition of Done

- [ ] Cross-tenant isolation verified across every table and action
- [ ] No client-supplied tenant ID reaches any query
- [ ] Rate limiting active on auth and mutations
- [ ] Security headers present; dependency audit clean of high/critical
- [ ] No secrets in bundle or git history
- [ ] `axe` clean; manual keyboard and screen-reader pass complete
- [ ] WCAG AA contrast in both themes including charts
- [ ] No horizontal overflow at any tested width; verified on real devices
- [ ] All four states present on every data surface
- [ ] Lighthouse targets met; dashboard performance target met
- [ ] E2E suite green, including cross-tenant denial
- [ ] Backup **restore** performed successfully
- [ ] Rollback rehearsed, not just written down
- [ ] Full check suite green: format, lint, typecheck, unit, integration, e2e, build

## Risks

- **Audits find architectural problems, not typos.** Budget real time; a tenancy gap found here may require schema work.
- **"Backups exist" is not "backups restore."** Only a completed restore counts.
- **Migration rollback on Postgres is not automatic.** Forward-only migrations need an explicit reversal procedure written _before_ the first production deploy.
