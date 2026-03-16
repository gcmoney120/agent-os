# Architecture Template: Supabase Edge Function

## When to Use

Use this template when the slice requires a serverless function running on Supabase's Deno edge runtime — webhooks, scheduled jobs, custom API endpoints, or third-party integrations.

## Architecture Fragment

### Function Structure

```
supabase/functions/[function-name]/
└── index.ts
```

### Basic Pattern

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Auth verification
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // Verify the user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Request validation
    const body = await req.json()
    // ... validate body

    // Business logic here

    return new Response(
      JSON.stringify({ data: result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
```

### Shared CORS Helper

```typescript
// supabase/functions/_shared/cors.ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
```

### Deployment

Deploy via Supabase MCP `deploy_edge_function` tool. Verify deployment with `get_edge_function`.

### Environment Variables

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are available by default
- Additional secrets set via Supabase dashboard or CLI

## Acceptance Criteria Template

- AC-1: Function deploys without error via `deploy_edge_function`
- AC-2: Function returns 401 for requests without valid Authorization header
- AC-3: Function validates request body and returns 400 for invalid input
- AC-4: Function performs [business logic] correctly for valid requests
- AC-5: CORS headers are present on all responses (including errors)
- AC-6: Function uses user-scoped Supabase client (not service role) for data access

## Trust Surfaces

- **Authentication:** JWT verification is a trust surface — must verify via `supabase.auth.getUser()`, not just decode
- **Authorization:** If function performs actions on behalf of a user, verify the user has permission
- **Input validation:** All request body fields must be validated before use
- **Service role key:** Never use in edge functions unless explicitly required and reviewed by Sentinel
