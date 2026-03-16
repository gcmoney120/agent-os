# Architecture Template: Next.js API Route

## When to Use

Use this template when the slice requires a server-side API endpoint in a Next.js App Router application — form handlers, webhook receivers, or backend-for-frontend endpoints.

## Architecture Fragment

### File Structure

```
app/api/[resource]/
└── route.ts          # Route handler (GET, POST, PUT, DELETE)
```

### Route Handler Pattern

```typescript
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// Request validation schema
const CreateSchema = z.object({
  name: z.string().min(1).max(255),
  // ... other fields
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Auth check
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Request validation
  const body = await request.json()
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  // Business logic
  const { data, error } = await supabase
    .from('table_name')
    .insert({ ...parsed.data, user_id: user.id })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to create resource' }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('table_name')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 })
  }

  return NextResponse.json({ data })
}
```

### Error Response Format

All error responses follow a consistent shape:

```typescript
{ error: string, details?: unknown }
```

### Route Segment Config (optional)

```typescript
export const runtime = 'edge' // or 'nodejs'
export const dynamic = 'force-dynamic'
```

## Acceptance Criteria Template

- AC-1: Route handler responds at `/api/[resource]` for specified HTTP methods
- AC-2: Unauthenticated requests return 401
- AC-3: Invalid request bodies return 400 with validation details
- AC-4: Successful requests return correct status code and response shape
- AC-5: Database operations use Supabase server client with user context (RLS enforced)
- AC-6: Unhandled errors return 500 without leaking internal details

## Trust Surfaces

- **Authentication:** Auth check on every mutating endpoint is a trust surface
- **Input validation:** All user input validated via zod schema before use
- **Error messages:** Must not leak internal state, stack traces, or database details
- **Rate limiting:** Consider for public-facing or resource-intensive endpoints
