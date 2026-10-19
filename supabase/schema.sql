-- KYT Monitor — run once in Supabase SQL Editor

create extension if not exists pgcrypto;

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  address text not null unique,
  network text not null default 'TRON',
  active boolean not null default true,
  last_seen_ts bigint not null default 0,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  network text not null default 'TRON',
  event_key text not null unique,
  tx_hash text not null,
  token text not null,
  token_contract text not null,
  amount numeric not null,
  from_address text not null,
  to_address text not null,
  block_ts timestamptz not null,
  risk_score int not null default 0,
  risk_level text not null default 'low',
  kyt_passed boolean not null default true,
  reasons jsonb not null default '[]'::jsonb,
  signals jsonb not null default '{}'::jsonb,
  deep_checked boolean not null default false,
  alerted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists transfers_block_ts_idx on public.transfers (block_ts desc);
create index if not exists transfers_from_idx on public.transfers (from_address);
create index if not exists transfers_level_idx on public.transfers (risk_level);

create table if not exists public.address_checks (
  address text primary key,
  network text not null default 'TRON',
  signals jsonb not null default '{}'::jsonb,
  deep jsonb,
  deep_checked_at timestamptz,
  checked_at timestamptz not null default now()
);

create table if not exists public.flagged_addresses (
  address text primary key,
  network text not null default 'TRON',
  source text not null check (source in ('manual', 'sanctions')),
  label text,
  severity int not null default 80 check (severity between 0 and 100),
  created_at timestamptz not null default now()
);

create index if not exists flagged_source_idx on public.flagged_addresses (source);

create table if not exists public.manual_checks (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  kind text not null check (kind in ('address', 'transaction')),
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  alert_mode text not null default 'all' check (alert_mode in ('all', 'risk', 'off')),
  alert_min_level text not null default 'medium' check (alert_min_level in ('low', 'medium', 'high', 'severe')),
  deep_check_enabled boolean not null default false,
  deep_check_threshold numeric not null default 1000,
  min_amount numeric not null default 1,
  cache_hours int not null default 24,
  sanctions_synced_at timestamptz,
  access_code_hash text,
  access_failed int not null default 0,
  access_locked_until timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Server-only access (service role). No public policies.
alter table public.wallets enable row level security;
alter table public.transfers enable row level security;
alter table public.address_checks enable row level security;
alter table public.flagged_addresses enable row level security;
alter table public.manual_checks enable row level security;
create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.settings enable row level security;
alter table public.access_codes enable row level security;
