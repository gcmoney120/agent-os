# Architecture Template: Vercel Deployment

## When to Use

Use this template when the slice includes deploying an application to Vercel — initial setup, production deployments, or domain configuration.

## Architecture Fragment

### Pre-Deployment Checklist

1. **Build passes locally** — `npm run build` (or project build command) completes without errors
2. **Tests pass** — `npm test` (or project test command) completes without failures
3. **Lint passes** — `npm run lint` (or project lint command) completes without errors
4. **Environment variables configured** — all required env vars are set in Vercel project settings
5. **No secrets in code** — verify no API keys, tokens, or credentials committed to source

### Deployment via MCP

```
# Deploy current state
deploy_to_vercel

# Verify deployment
get_deployment → check status, URL, build output
get_deployment_build_logs → verify no warnings or errors
```

### Domain Configuration

```
# Check availability
check_domain_availability_and_price → verify domain and cost

# Configure via Vercel dashboard or CLI
# DNS records configured at registrar
```

### Environment Variable Management

Environment variables are managed per-environment in Vercel:
- **Production:** Variables applied to production deployments
- **Preview:** Variables applied to preview deployments (PRs)
- **Development:** Variables for local development (pulled via `vercel env pull`)

Sensitive values (API keys, secrets) must be set as "Sensitive" type in Vercel.

### Post-Deployment Verification

1. **Check deployment status:** `get_deployment` — verify "READY" state
2. **Review build logs:** `get_deployment_build_logs` — verify no errors or unexpected warnings
3. **Check runtime logs:** `get_runtime_logs` — verify no startup errors
4. **Smoke test:** Visit the deployed URL and verify core functionality
5. **Check domain:** Verify custom domain resolves correctly (if configured)

### Rollback Procedure

If a deployment has issues:
1. Identify the last known good deployment via `list_deployments`
2. Promote the previous deployment to production via Vercel dashboard
3. Investigate and fix the issue in a new deployment

## Acceptance Criteria Template

- AC-1: Application builds without errors
- AC-2: All tests pass before deployment
- AC-3: Deployment completes with "READY" status
- AC-4: Build logs show no errors or unexpected warnings
- AC-5: Application is accessible at the deployment URL
- AC-6: [Feature-specific smoke test passes]
- AC-7: Environment variables are configured for the target environment

## Trust Surfaces

- **Environment variables:** Secrets must not be logged or exposed in build output
- **Deployment access:** Verify team/project access controls are appropriate
- **Domain configuration:** DNS changes affect availability — verify before applying
- **Preview deployments:** May be publicly accessible — verify no sensitive data in preview environments
