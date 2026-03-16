# Architecture Template: Next.js + Supabase Page

## When to Use

Use this template when the slice requires a new page in a Next.js App Router application that fetches data from Supabase. Covers authenticated and public pages.

## Architecture Fragment

### File Structure

```
app/[route]/
├── page.tsx          # Server component — data fetching, auth check
├── loading.tsx       # Suspense fallback
├── error.tsx         # Error boundary (client component)
└── components/
    ├── [Feature].tsx  # Client components for interactivity
    └── [Feature].types.ts  # Component-specific types (if needed)
```

### Server Component Pattern (page.tsx)

```typescript
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function Page() {
  const supabase = await createClient()

  // Auth check (if authenticated route)
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Data fetching — RLS enforces row-level access
  const { data, error } = await supabase
    .from('table_name')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error

  return <FeatureComponent data={data} />
}
```

### Supabase Client Initialization

- **Server-side:** `createClient()` from `@/lib/supabase/server` — uses cookies for auth
- **Client-side:** `createBrowserClient()` from `@/lib/supabase/client` — for real-time subscriptions or client mutations
- Never expose service role key on the client

### Type Safety

```typescript
import { Database } from '@/lib/database.types'
type Row = Database['public']['Tables']['table_name']['Row']
```

Run `generate_typescript_types` via Supabase MCP after any migration to keep types current.

## Acceptance Criteria Template

- AC-1: Page renders at `/[route]` and displays data from `[table]`
- AC-2: Unauthenticated users are redirected to `/login` (if authenticated route)
- AC-3: Data fetching respects RLS policies — users see only authorized rows
- AC-4: Loading state displays while data is being fetched
- AC-5: Error boundary catches and displays fetch errors gracefully
- AC-6: TypeScript types match the current database schema (generated types)

## Trust Surfaces

- **Authentication:** If the page is behind auth, the auth check is a trust surface → Sentinel review recommended
- **RLS policies:** Data access relies on RLS enforcement — verify policies exist and are correct
- **Client-side Supabase client:** If used, ensure no service role key exposure
