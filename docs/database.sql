create table merchants (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  name text not null,
  reward_rule text not null,
  target integer not null check (target > 0),
  stamp_value integer not null default 1 check (stamp_value > 0),
  brand_color text not null default '#126149',
  accent_color text not null default '#f2c14e',
  apple_pass_type_id text,
  google_issuer_id text,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references loyalty_programs(id) on delete cascade,
  member_id text not null unique,
  name text not null,
  phone text not null,
  email text,
  consent_marketing boolean not null default false,
  created_at timestamptz not null default now()
);

create table wallet_passes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  platform text not null check (platform in ('apple', 'google')),
  external_object_id text,
  serial_number text not null,
  auth_token text not null,
  status text not null default 'active',
  last_pushed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, serial_number)
);

create table loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  points_delta integer not null,
  reason text not null check (reason in ('earn', 'redeem', 'adjust')),
  source text not null default 'dashboard',
  created_by uuid references merchants(id),
  created_at timestamptz not null default now()
);

create table rewards (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  title text not null,
  status text not null default 'available' check (status in ('available', 'redeemed', 'expired')),
  earned_at timestamptz not null default now(),
  redeemed_at timestamptz
);

create view customer_balances as
select
  c.id as customer_id,
  c.member_id,
  c.name,
  c.phone,
  p.target,
  coalesce(sum(t.points_delta), 0) as points_total,
  mod(coalesce(sum(t.points_delta), 0), p.target) as points_current_cycle,
  floor(coalesce(sum(t.points_delta), 0)::numeric / p.target)::integer as rewards_earned
from customers c
join loyalty_programs p on p.id = c.program_id
left join loyalty_transactions t on t.customer_id = c.id
group by c.id, c.member_id, c.name, c.phone, p.target;
