Run a full production readiness check before deploying.

Target project context: $ARGUMENTS

---

## Pre-Deploy Verification Protocol

Execute ALL checks below before approving a push or deploy. Report all findings to the principal before proceeding.

### Step 1 — Type Safety

Run `npx tsc --noEmit --strict` in the target project directory. This catches:
- Nullable type narrowing issues that Vercel's stricter TypeScript checks will find
- Missing enum values
- Type mismatches between modules
- React hooks ordering problems

**Zero errors required.** Fix any issues before continuing.

### Step 2 — Build Verification

Run `npm run build` with `NODE_ENV=production` (or the project's build command). The build must pass clean. Watch for:
- Import resolution failures
- Missing modules
- CSS/Tailwind purge issues
- Environment variable references that differ between dev and production

### Step 3 — Route and Page Verification

Verify all pages referenced in the router/navigation actually exist as files:
- Grep for all route definitions (Next.js pages, API routes)
- Confirm each referenced path has a corresponding file
- Flag any dead routes or orphaned pages

### Step 4 — Schema Consistency

Grep for all Zod schemas and validation rules in the codebase:
- Compare frontend validation rules with backend validation rules
- Check password min lengths, required vs optional fields, enum values
- Flag any mismatches between client-side and server-side validation

### Step 5 — Async Safety

Grep for fire-and-forget async calls in API routes and serverless functions:
- Search for `async` functions without `await` on critical operations
- Flag any unhandled promise rejections in server-side code
- Check for operations that may exceed serverless timeout limits

### Step 6 — Environment Variables

List all environment variables referenced in the codebase:
- `grep -r "process.env\." --include="*.ts" --include="*.tsx"`
- Compare against `.env`, `.env.local`, and `.env.production`
- Flag any variables referenced in code but missing from env files
- Do NOT display actual secret values — just confirm presence/absence

### Step 7 — Report

Output a structured pre-deploy report:

```
## Pre-Deploy Report — [project name]

### Type Safety: [PASS / FAIL]
[Details if FAIL]

### Build: [PASS / FAIL]
[Details if FAIL]

### Routes: [PASS / FAIL — X routes verified]
[Details if issues found]

### Schema Consistency: [PASS / FAIL]
[Details if mismatches found]

### Async Safety: [PASS / WARN — X fire-and-forget calls found]
[Details if issues found]

### Environment Variables: [PASS / WARN — X vars checked, Y missing]
[Details if missing]

### Overall: [READY TO DEPLOY / NOT READY — fix X issues first]
```

Do not push or deploy until all checks pass or the principal explicitly accepts the risks.
