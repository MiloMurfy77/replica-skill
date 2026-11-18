-- Clipper: esquema inicial (MVP long-to-shorts)
create extension if not exists pgcrypto;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  name text,
  plan text not null default 'free' check (plan in ('free','starter','pro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on sessions (user_id);

-- Vídeo largo original
create table sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  origin text not null check (origin in ('upload','url')),
  origin_url text,
  filename text not null,
  storage_path text,
  size_bytes bigint,
  duration_s double precision,
  width int,
  height int,
  fps double precision,
  language text,
  status text not null default 'uploading'
    check (status in ('uploading','importing','probing','ready','failed')),
  error text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sources (user_id, created_at desc);

-- Una transcripción por fuente (se reutiliza en reprompts)
create table transcripts (
  source_id uuid primary key references sources(id) on delete cascade,
  language text,
  provider text not null,
  words jsonb not null,          -- [{w, s, e, sp}]  palabra, inicio, fin, hablante
  created_at timestamptz not null default now()
);

-- Un análisis = una generación de clips con unos ajustes
create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source_id uuid not null references sources(id) on delete cascade,
  settings jsonb not null,       -- {target_len, aspect, caption_style, prompt, range:[a,b]}
  status text not null default 'queued'
    check (status in ('queued','transcribing','selecting','framing','rendering','done','failed')),
  progress real not null default 0 check (progress between 0 and 1),
  minutes_charged int not null default 0,
  selector text,                 -- 'claude' | 'heuristic'
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on jobs (user_id, created_at desc);
create index on jobs (source_id);

create table clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  source_id uuid not null references sources(id) on delete cascade,
  rank int not null,
  start_s double precision not null,
  end_s double precision not null,
  title text not null,
  description text not null default '',
  hashtags text[] not null default '{}',
  hook text not null default '',
  score int not null check (score between 0 and 99),
  sub_scores jsonb not null default '{}',   -- {hook, flow, value, trend}
  reason text not null default '',
  feedback text check (feedback in ('like','dislike')),
  starred boolean not null default false,
  edit jsonb not null default '{}',          -- {aspect, layout, caption_style, crop:[{t,x}], words_override}
  version int not null default 1,
  preview_path text,
  thumb_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clip_positive_len check (end_s > start_s)
);
create index on clips (job_id, score desc);
create index on clips (user_id);

create table renders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  clip_id uuid not null references clips(id) on delete cascade,
  clip_version int not null,
  purpose text not null default 'download' check (purpose in ('preview','download')),
  format text not null default 'mp4' check (format in ('mp4','srt')),
  height int not null default 1920,
  status text not null default 'queued' check (status in ('queued','rendering','done','failed')),
  progress real not null default 0,
  output_path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on renders (clip_id, created_at desc);
create index on renders (user_id);

-- Minutos: saldo = suma de delta_min
create table usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  delta_min int not null,
  reason text not null check (reason in ('grant','analysis','refund','purchase')),
  created_at timestamptz not null default now(),
  unique (job_id, reason)
);
create index on usage_ledger (user_id);

-- Cola de trabajos en Postgres
create table tasks (
  id bigserial primary key,
  kind text not null check (kind in ('ingest','analyze','render')),
  ref_id uuid not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_pick on tasks (run_after) where status in ('queued','running');

create trigger t_users before update on users for each row execute function touch_updated_at();
create trigger t_sources before update on sources for each row execute function touch_updated_at();
create trigger t_jobs before update on jobs for each row execute function touch_updated_at();
create trigger t_clips before update on clips for each row execute function touch_updated_at();
create trigger t_renders before update on renders for each row execute function touch_updated_at();
create trigger t_tasks before update on tasks for each row execute function touch_updated_at();

-- avisa al worker al instante
create or replace function notify_task() returns trigger language plpgsql as $$
begin perform pg_notify('tasks', new.kind); return new; end $$;
create trigger t_tasks_notify after insert on tasks for each row execute function notify_task();
