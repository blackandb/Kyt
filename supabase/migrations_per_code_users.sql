-- KYT Monitor — each access code becomes a separate user.
-- Run ONCE in Supabase → SQL Editor, BEFORE merging branch "per-code-users".
-- Deletes all history (transfers, checks, screened addresses). Access codes are kept.

-- 1. Wipe history
delete from public.transfers;
delete from public.manual_checks;
drop table if exists public.address_checks;

-- 2. Code 1 administers access codes
alter table public.access_codes add column if not exists is_admin boolean not null default false;
update public.access_codes set is_admin = true where label = 'Code 1';

-- 3. Per-code screening cache
create table public.address_checks (
  owner_id uuid not null references public.access_codes(id) on delete cascade,
  address text not null,
  network text not null default 'TRON',
  signals jsonb not null default '{}'::jsonb,
  deep jsonb,
  deep_checked_at timestamptz,
  checked_at timestamptz not null default now(),
  primary key (owner_id, address)
);
alter table public.address_checks enable row level security;

-- 4. Wallets belong to a code (existing wallet -> Code 1)
alter table public.wallets add column if not exists owner_id uuid references public.access_codes(id) on delete cascade;
update public.wallets set owner_id = (select id from public.access_codes where label = 'Code 1') where owner_id is null;
alter table public.wallets alter column owner_id set not null;
alter table public.wallets drop constraint if exists wallets_address_key;
alter table public.wallets add constraint wallets_owner_address_key unique (owner_id, address);
create index if not exists wallets_owner_idx on public.wallets (owner_id);

-- 5. Transfers
alter table public.transfers add column owner_id uuid not null references public.access_codes(id) on delete cascade;
alter table public.transfers drop constraint if exists transfers_event_key_key;
alter table public.transfers add constraint transfers_wallet_event_key unique (wallet_id, event_key);
create index if not exists transfers_owner_ts_idx on public.transfers (owner_id, block_ts desc);

-- 6. Manual checks
alter table public.manual_checks add column owner_id uuid not null references public.access_codes(id) on delete cascade;
create index if not exists manual_checks_owner_idx on public.manual_checks (owner_id, created_at desc);

-- 7. Personal flags (sanctions list stays global)
delete from public.flagged_addresses where source = 'manual';
create table if not exists public.user_flags (
  owner_id uuid not null references public.access_codes(id) on delete cascade,
  address text not null,
  label text,
  severity int not null default 80 check (severity between 0 and 100),
  created_at timestamptz not null default now(),
  primary key (owner_id, address)
);
alter table public.user_flags enable row level security;

-- 8. Personal settings
create table if not exists public.user_settings (
  owner_id uuid primary key references public.access_codes(id) on delete cascade,
  alert_mode text not null default 'all' check (alert_mode in ('all', 'risk', 'off')),
  alert_min_level text not null default 'medium' check (alert_min_level in ('low', 'medium', 'high', 'severe')),
  deep_check_enabled boolean not null default false,
  deep_check_threshold numeric not null default 1000,
  min_amount numeric not null default 1,
  cache_hours int not null default 24,
  alert_email text,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
insert into public.user_settings (owner_id, alert_mode, alert_min_level, deep_check_enabled, deep_check_threshold, min_amount, cache_hours)
select c.id, s.alert_mode, s.alert_min_level, s.deep_check_enabled, s.deep_check_threshold, s.min_amount, s.cache_hours
from public.access_codes c cross join public.settings s where s.id = 1
on conflict (owner_id) do nothing;
