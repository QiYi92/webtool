-- AI Workflow table hardening + Dify sync fields
-- Run in Supabase SQL Editor.
-- This script is idempotent (safe to rerun in most cases).

begin;

-- 1) Ensure extension for UUID default
create extension if not exists pgcrypto;

-- 2) Ensure base table exists (for fresh environments)
create table if not exists public.ai_workflow (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  visible_role_groups text[] not null default array['admin']::text[],
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) Add/align columns required by current backend + future Dify pull sync
alter table public.ai_workflow
  add column if not exists dify_base_url text,
  add column if not exists dify_api_key text,
  add column if not exists dify_user_prefix text not null default 'gcw',
  add column if not exists dify_fixed_user text,
  add column if not exists enable_session_sync boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists last_synced_at timestamptz;

-- 4) Backfill null values before tightening constraints/defaults
update public.ai_workflow
set sort_order = 0
where sort_order is null;

update public.ai_workflow
set is_active = true
where is_active is null;

update public.ai_workflow
set visible_role_groups = array['admin']::text[]
where visible_role_groups is null or cardinality(visible_role_groups) = 0;

update public.ai_workflow
set dify_user_prefix = 'gcw'
where dify_user_prefix is null or btrim(dify_user_prefix) = '';

update public.ai_workflow
set metadata = '{}'::jsonb
where metadata is null;

update public.ai_workflow
set created_at = now()
where created_at is null;

update public.ai_workflow
set updated_at = now()
where updated_at is null;

-- 5) Set not-null/default constraints for stable behavior
alter table public.ai_workflow
  alter column name set not null,
  alter column url set not null,
  alter column visible_role_groups set not null,
  alter column is_active set not null,
  alter column sort_order set not null,
  alter column created_at set not null,
  alter column updated_at set not null,
  alter column visible_role_groups set default array['admin']::text[],
  alter column is_active set default true,
  alter column sort_order set default 0,
  alter column created_at set default now(),
  alter column updated_at set default now(),
  alter column dify_user_prefix set not null,
  alter column dify_user_prefix set default 'gcw',
  alter column enable_session_sync set not null,
  alter column enable_session_sync set default false,
  alter column metadata set not null,
  alter column metadata set default '{}'::jsonb;

-- 6) Replace checks to guarantee data quality
alter table public.ai_workflow
  drop constraint if exists ai_workflow_name_nonempty_chk,
  drop constraint if exists ai_workflow_url_http_chk,
  drop constraint if exists ai_workflow_visible_groups_nonempty_chk,
  drop constraint if exists ai_workflow_dify_base_url_http_chk,
  drop constraint if exists ai_workflow_dify_user_prefix_nonempty_chk,
  drop constraint if exists ai_workflow_dify_fixed_user_nonempty_chk;

alter table public.ai_workflow
  add constraint ai_workflow_name_nonempty_chk
    check (char_length(btrim(name)) > 0),
  add constraint ai_workflow_url_http_chk
    check (url ~* '^https?://'),
  add constraint ai_workflow_visible_groups_nonempty_chk
    check (cardinality(visible_role_groups) > 0),
  add constraint ai_workflow_dify_base_url_http_chk
    check (dify_base_url is null or dify_base_url ~* '^https?://'),
  add constraint ai_workflow_dify_user_prefix_nonempty_chk
    check (char_length(btrim(dify_user_prefix)) > 0),
  add constraint ai_workflow_dify_fixed_user_nonempty_chk
    check (dify_fixed_user is null or char_length(btrim(dify_fixed_user)) > 0);

-- 7) updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ai_workflow_set_updated_at on public.ai_workflow;
create trigger trg_ai_workflow_set_updated_at
before update on public.ai_workflow
for each row
execute function public.set_updated_at();

-- 8) Query-performance indexes
create index if not exists idx_ai_workflow_active_sort
  on public.ai_workflow (is_active, sort_order, created_at desc);

create index if not exists idx_ai_workflow_visible_groups_gin
  on public.ai_workflow using gin (visible_role_groups);

create index if not exists idx_ai_workflow_enable_sync
  on public.ai_workflow (enable_session_sync, updated_at desc);

comment on table public.ai_workflow is 'AI workflow cards and Dify integration settings';
comment on column public.ai_workflow.url is 'Iframe URL for workflow entry';
comment on column public.ai_workflow.visible_role_groups is 'Role groups allowed to view this workflow';
comment on column public.ai_workflow.dify_base_url is 'Dify API base URL, e.g. https://xxx/v1';
comment on column public.ai_workflow.dify_api_key is 'Dify app API key (store securely, limit DB exposure)';
comment on column public.ai_workflow.dify_user_prefix is 'Prefix used when mapping local user id to Dify user field';
comment on column public.ai_workflow.dify_fixed_user is 'Fixed Dify user; if set, it overrides prefix mapping';
comment on column public.ai_workflow.enable_session_sync is 'Whether this workflow allows backend session sync';
comment on column public.ai_workflow.metadata is 'Extended config payload (jsonb)';

commit;
