-- Co2lab schema for Tiger Data (Postgres + TimescaleDB). SPEC §6.
-- Idempotent: the hub applies this file on every start (hub/src/db/pg.ts).
-- IDs are ULIDs (text). Times are timestamptz. (ts) = Timescale hypertable.

create extension if not exists timescaledb;

-- ---------- Devices and auth ----------

create table if not exists device (
  id           text primary key,
  name         text not null,
  kind         text not null,
  capabilities text[] not null default '{}',
  token_hash   text not null,
  created_at   timestamptz not null,
  revoked_at   timestamptz
);
-- Re-created on every start so new device kinds (e.g. desktop) reach existing databases.
alter table device drop constraint if exists device_kind_check;
alter table device add constraint device_kind_check check (kind in ('android', 'laptop', 'desktop', 'cloud'));

create table if not exists viewer_link (
  token_hash text primary key,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

-- (ts) one row per device every ~10 s, plus every online/offline change
create table if not exists telemetry (
  time        timestamptz not null,
  device_id   text not null,
  battery_pct real,
  charging    boolean,
  temp_c      real,
  cpu_pct     real,
  online      boolean not null
);
select create_hypertable('telemetry', by_range('time', interval '1 day'), if_not_exists => true);
create index if not exists telemetry_device_time on telemetry (device_id, time desc);

-- ---------- Agent configs (T7 trials reference these) ----------

create table if not exists config (
  id               text primary key,
  model            text not null,
  screenshot_scale real not null,
  mode             text not null check (mode in ('recipe', 'vision')),
  created_at       timestamptz not null default now()
);

-- ---------- Runs ----------

create table if not exists run (
  id            text primary key,
  client_run_id text not null unique,
  prompt        text not null,
  status        text not null check (status in ('planning', 'running', 'merging', 'done', 'failed')),
  config        jsonb not null,
  config_id     text references config (id),
  ranked        jsonb,
  burn          jsonb not null,
  error         text,
  created_at    timestamptz not null,
  finished_at   timestamptz
);
create index if not exists run_created on run (created_at desc);

create table if not exists subtask (
  id          text primary key,
  run_id      text not null references run (id) on delete cascade,
  capability  text not null,
  source      text not null,
  label       text not null,
  goal        text not null,
  status      text not null check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  device_id   text,
  attempt     integer not null default 0,
  error       text,
  deal_count  integer not null default 0,
  created_at  timestamptz not null,
  started_at  timestamptz,
  finished_at timestamptz
);
create index if not exists subtask_run on subtask (run_id);

-- (ts) every agent action and Gemini call, with token usage
create table if not exists agent_step (
  time       timestamptz not null,
  run_id     text,
  subtask_id text,
  device_id  text,
  kind       text not null,
  detail     jsonb not null default '{}',
  tokens_in  integer not null default 0,
  tokens_out integer not null default 0,
  model      text
);
select create_hypertable('agent_step', by_range('time', interval '1 day'), if_not_exists => true);
create index if not exists agent_step_run_time on agent_step (run_id, time desc);

create table if not exists deal (
  id            text primary key,
  run_id        text not null references run (id) on delete cascade,
  subtask_id    text not null,
  device_id     text,
  source        text not null check (source in ('tims', 'mcdonalds', 'popeyes', 'redflagdeals')),
  title         text not null,
  price_text    text,
  conditions    text,
  expires_text  text,
  url           text,
  screenshot_ref text,
  confidence    double precision not null
);
create index if not exists deal_run on deal (run_id);

-- ---------- Research Mode (T7) ----------

create table if not exists capture (
  id         text primary key,
  app        text not null,
  created_at timestamptz not null default now(),
  frames     text[] not null default '{}'
);

create table if not exists ground_truth (
  capture_id text primary key references capture (id) on delete cascade,
  deals      jsonb not null,
  labeled_by text,
  labeled_at timestamptz not null default now()
);

create table if not exists experiment (
  id                 text primary key,
  hypothesis         text not null,
  status             text not null check (status in ('proposed', 'approved', 'running', 'analyzed')),
  parent_id          text references experiment (id),
  cites_feedback_ids text[] not null default '{}',
  created_at         timestamptz not null default now()
);

-- (ts) one row per config x capture evaluation
create table if not exists trial (
  time            timestamptz not null,
  experiment_id   text not null,
  config_id       text not null,
  capture_id      text not null,
  precision       real,
  recall          real,
  price_exact_pct real,
  tokens          integer,
  latency_ms      integer,
  cost_usd        double precision
);
select create_hypertable('trial', by_range('time', interval '7 days'), if_not_exists => true);
create index if not exists trial_experiment on trial (experiment_id, time desc);

create table if not exists feedback (
  id            text primary key,
  experiment_id text not null references experiment (id) on delete cascade,
  kind          text not null check (kind in ('flag', 'approve', 'redirect')),
  text          text not null,
  created_at    timestamptz not null default now()
);

create table if not exists finding (
  id            text primary key,
  experiment_id text not null references experiment (id) on delete cascade,
  summary       text not null,
  papiers_ref   text,
  created_at    timestamptz not null default now()
);

-- T7 detail columns (hub/src/db/research-pg.ts). Added with "if not exists" so older databases upgrade in place.
alter table capture add column if not exists status text not null default 'ready';
alter table capture add column if not exists error text;
alter table capture add column if not exists run_id text;
alter table capture add column if not exists subtask_id text;
alter table capture add column if not exists device_name text;
alter table capture add column if not exists evidence_text text;
alter table capture add column if not exists candidates jsonb not null default '[]';

alter table ground_truth add column if not exists labels jsonb not null default '[]';

alter table experiment add column if not exists title text;
alter table experiment add column if not exists configs jsonb not null default '[]';
alter table experiment add column if not exists capture_ids text[] not null default '{}';
alter table experiment add column if not exists papiers jsonb not null default '[]';
alter table experiment add column if not exists papiers_error text;
alter table experiment add column if not exists analysis text;
alter table experiment add column if not exists next_proposal text;
alter table experiment add column if not exists error text;

alter table trial add column if not exists config jsonb;
alter table trial add column if not exists deals jsonb;
alter table trial add column if not exists misreads jsonb not null default '[]';
alter table trial add column if not exists error text;

alter table finding add column if not exists markdown text;

-- General agent (P4): composed answer for non-deal requests.
alter table run add column if not exists answer jsonb;
