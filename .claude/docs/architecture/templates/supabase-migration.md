# Architecture Template: Supabase Migration

## When to Use

Use this template when the slice requires database schema changes — new tables, columns, indexes, RLS policies, or functions.

## Architecture Fragment

### Migration File

File naming: `YYYYMMDDHHMMSS_description.sql` (e.g., `20260316120000_create_projects_table.sql`)

Apply via Supabase MCP `apply_migration` tool.

### Table Creation Pattern

```sql
-- Create table with RLS enabled by default
create table public.table_name (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- domain columns here
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS (always)
alter table public.table_name enable row level security;

-- RLS policies
create policy "Users can read own rows"
  on public.table_name for select
  using (auth.uid() = user_id);

create policy "Users can insert own rows"
  on public.table_name for insert
  with check (auth.uid() = user_id);

create policy "Users can update own rows"
  on public.table_name for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own rows"
  on public.table_name for delete
  using (auth.uid() = user_id);

-- Indexes
create index idx_table_name_user_id on public.table_name(user_id);
```

### RLS Policy Patterns

| Pattern | `using` clause | Use case |
|---------|---------------|----------|
| Owner-only | `auth.uid() = user_id` | User's own data |
| Authenticated read | `auth.role() = 'authenticated'` | Any logged-in user can read |
| Admin-only | `auth.uid() in (select user_id from public.admins)` | Admin access |
| Public read | `true` | Public-facing data |

### Post-Migration Steps

1. Verify migration applied: `list_migrations` via MCP
2. Verify table exists: `list_tables` via MCP
3. Verify with test query: `execute_sql` via MCP
4. Regenerate TypeScript types: `generate_typescript_types` via MCP

### Rollback Considerations

- Document the rollback SQL in a comment block at the top of the migration
- For destructive changes (drop column, drop table), consider a two-phase migration

## Acceptance Criteria Template

- AC-1: Migration applies without error
- AC-2: Table `[name]` exists with all specified columns and correct types
- AC-3: RLS is enabled on `[table]`
- AC-4: RLS policies enforce [access pattern] correctly
- AC-5: Indexes exist for [columns]
- AC-6: TypeScript types regenerated and reflect new schema

## Trust Surfaces

- **RLS policies** are a trust surface — every table must have RLS enabled, every policy must be reviewed
- **Foreign key references to auth.users** — verify cascade behavior
- **Public-facing tables** (RLS `using (true)`) — verify intentional exposure
