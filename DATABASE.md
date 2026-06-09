# SlateSignal Database Plan

The local app uses `pick-log.json`. A production app should move these records into a database.

Recommended first database: Supabase Postgres.

## Tables

```sql
create table users (
  id uuid primary key,
  email text unique not null,
  created_at timestamptz default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'free',
  current_period_end timestamptz
);

create table model_runs (
  id uuid primary key default gen_random_uuid(),
  model_version text not null,
  run_date date not null,
  created_at timestamptz default now()
);

create table model_picks (
  id uuid primary key default gen_random_uuid(),
  model_run_id uuid references model_runs(id),
  game_pk bigint not null,
  matchup text not null,
  pick_team_id integer not null,
  pick_team_name text not null,
  edge numeric,
  signal numeric,
  fair_line text,
  factors jsonb,
  reasons jsonb,
  result text default 'pending',
  final_score text,
  created_at timestamptz default now()
);
```

## Scheduled Jobs

- Morning: call `/api/jobs/daily` to save the day's picks.
- During games: call `/api/mlb/summary` every few minutes if you want warm cache/live scores.
- Late night and next morning: call `/api/jobs/settle` to settle final scores.

## Production Storage

Replace the local `pick-log.json` functions in `server.js` with database queries against these tables.
