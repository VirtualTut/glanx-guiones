-- Glanx Guiones: tablas para trabajar en equipo.
-- Pegar entero en Supabase › SQL Editor › New query › Run. Se puede volver a ejecutar sin romper nada.

create table if not exists public.projects (
  id text primary key,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  owner_email text,
  title text not null default '',
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  lock_user uuid,
  lock_name text,
  lock_at timestamptz
);

create table if not exists public.project_members (
  project_id text not null references public.projects on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (project_id, email)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects on delete cascade,
  parent_id uuid references public.comments on delete cascade,
  view text, sid text, block text, quote text,
  body text not null,
  author uuid not null default auth.uid(),
  author_name text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_project on public.comments (project_id);

-- Quién es cada uno en un proyecto: 'owner', 'editor', 'viewer' o nada
create or replace function public.my_email() returns text language sql stable as
$$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.project_role(pid text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from projects where id = pid and owner = auth.uid()) then 'owner'
    else (select role from project_members where project_id = pid and email = public.my_email())
  end
$$;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.comments enable row level security;

drop policy if exists p_sel on public.projects;
drop policy if exists p_ins on public.projects;
drop policy if exists p_upd on public.projects;
drop policy if exists p_del on public.projects;
create policy p_sel on public.projects for select using (public.project_role(id) is not null);
create policy p_ins on public.projects for insert with check (owner = auth.uid());
-- solo guarda quien tiene el turno de edición
create policy p_upd on public.projects for update
  using (public.project_role(id) in ('owner', 'editor') and lock_user = auth.uid())
  with check (public.project_role(id) in ('owner', 'editor') and lock_user = auth.uid());
create policy p_del on public.projects for delete using (owner = auth.uid());

drop policy if exists m_sel on public.project_members;
drop policy if exists m_all on public.project_members;
create policy m_sel on public.project_members for select using (public.project_role(project_id) is not null);
create policy m_all on public.project_members for all
  using (public.project_role(project_id) = 'owner') with check (public.project_role(project_id) = 'owner');

drop policy if exists c_sel on public.comments;
drop policy if exists c_ins on public.comments;
drop policy if exists c_upd on public.comments;
drop policy if exists c_del on public.comments;
create policy c_sel on public.comments for select using (public.project_role(project_id) is not null);
create policy c_ins on public.comments for insert with check (public.project_role(project_id) is not null and author = auth.uid());
create policy c_upd on public.comments for update using (author = auth.uid() or public.project_role(project_id) in ('owner', 'editor'));
create policy c_del on public.comments for delete using (author = auth.uid() or public.project_role(project_id) = 'owner');

-- Turno de edición: una sola persona edita; si deja de dar señales 90 s, el turno queda libre
create or replace function public.acquire_lock(pid text, nm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if coalesce(public.project_role(pid), '') not in ('owner', 'editor') then
    return jsonb_build_object('error', 'sin permiso');
  end if;
  update projects set lock_user = auth.uid(), lock_name = nm, lock_at = now()
   where id = pid and (lock_user is null or lock_user = auth.uid() or lock_at < now() - interval '90 seconds');
  select jsonb_build_object('lock_user', lock_user, 'lock_name', lock_name, 'lock_at', lock_at) into r from projects where id = pid;
  return r;
end $$;

create or replace function public.release_lock(pid text) returns void
language sql security definer set search_path = public as $$
  update projects set lock_user = null, lock_name = null, lock_at = null where id = pid and lock_user = auth.uid();
$$;

grant execute on function public.acquire_lock(text, text) to authenticated;
grant execute on function public.release_lock(text) to authenticated;
grant execute on function public.project_role(text) to authenticated;

-- Avisos en vivo
do $$ begin
  begin alter publication supabase_realtime add table public.projects; exception when others then null; end;
  begin alter publication supabase_realtime add table public.comments; exception when others then null; end;
end $$;

-- Imágenes (planos y moodboard): carpeta por proyecto
insert into storage.buckets (id, name, public) values ('img', 'img', false) on conflict (id) do nothing;
drop policy if exists img_sel on storage.objects;
drop policy if exists img_ins on storage.objects;
create policy img_sel on storage.objects for select
  using (bucket_id = 'img' and public.project_role((storage.foldername(name))[1]) is not null);
create policy img_ins on storage.objects for insert
  with check (bucket_id = 'img' and public.project_role((storage.foldername(name))[1]) in ('owner', 'editor'));

-- ===== v2: menciones (@persona) y nombres =====
alter table public.comments add column if not exists mentions text[] not null default '{}';
create index if not exists comments_mentions on public.comments using gin (mentions);

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  name text,
  mentions_seen_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists pr_self on public.profiles;
drop policy if exists pr_sel on public.profiles;
create policy pr_self on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
-- ves el nombre de quien comparte algún proyecto contigo
create policy pr_sel on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from public.projects p
    where public.project_role(p.id) is not null
      and (p.owner = profiles.id or exists (select 1 from public.project_members m where m.project_id = p.id and m.email = lower(profiles.email)))
  )
);
