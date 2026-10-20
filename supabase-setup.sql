-- ==============================================================================
-- STOCKLY SUPABASE SETUP: MULTI-ADMIN, RBAC & STRICT MULTI-TENANT USER SCOPING
-- Jalankan skrip ini di SQL Editor dashboard Supabase Anda (Database > SQL Editor).
-- ==============================================================================

-- 1. Tabel State JSON Stockly (Terisolasi per Pengguna)
create table if not exists public.stockly_state (
  id text primary key, -- user_id atau 'main'
  user_id uuid references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.stockly_state enable row level security;

-- RLS: Pengguna HANYA dapat membaca state miliknya sendiri
drop policy if exists "Users can only read own state" on public.stockly_state;
create policy "Users can only read own state"
  on public.stockly_state for select
  to authenticated
  using (user_id = auth.uid() or id = auth.uid()::text);

-- RLS: Pengguna HANYA dapat memodifikasi state miliknya sendiri
drop policy if exists "Users can only modify own state" on public.stockly_state;
create policy "Users can only modify own state"
  on public.stockly_state for all
  to authenticated
  using (user_id = auth.uid() or id = auth.uid()::text)
  with check (user_id = auth.uid() or id = auth.uid()::text);


-- 2. Tabel Role (RBAC)
create table if not exists public.roles (
  id text primary key,
  description text not null
);

insert into public.roles (id, description)
values 
  ('admin', 'Administrator dengan akses penuh sistem dan manajemen peran'),
  ('manager', 'Manajer gudang dengan hak persetujuan opname dan laporan'),
  ('staff', 'Staf operasional pencatatan stok dan scan barcode'),
  ('user', 'Pengguna standar inventaris')
on conflict (id) do update set description = excluded.description;


-- 3. Tabel Profil Pengguna Terhubung ke auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null default 'user' references public.roles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 4. Fungsi Pembantu untuk Pengecekan Hak Akses Admin (Security Definer)
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.get_my_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles
  where id = auth.uid();
$$;

-- 5. Trigger Otomatis: Buat Profil Saat Pengguna Baru Terdaftar di auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_count int;
  assigned_role text;
  raw_role text;
begin
  select count(*) into user_count from public.profiles;
  raw_role := lower(coalesce(new.raw_app_meta_data->>'role', new.raw_user_meta_data->>'role', ''));
  
  if user_count = 0 or raw_role = 'admin' then
    assigned_role := 'admin';
  elsif raw_role in ('manager', 'staff') then
    assigned_role := raw_role;
  else
    assigned_role := 'user';
  end if;

  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    assigned_role
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(excluded.name, profiles.name),
    role = case when profiles.role = 'admin' then 'admin' else excluded.role end,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6. Kebijakan Row Level Security (RLS) untuk public.profiles
drop policy if exists "Profiles are viewable by owner and admins" on public.profiles;
create policy "Profiles are viewable by owner and admins"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "Users can update own name" on public.profiles;
create policy "Users can update own name"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

drop policy if exists "Admins can update all profiles and roles" on public.profiles;
create policy "Admins can update all profiles and roles"
  on public.profiles for update
  using (public.is_admin());


-- ==============================================================================
-- 7. TABEL RELASIONAL DENGAN ISOLASI USER PENUH (MULTI-TENANT USER SCOPING)
-- ==============================================================================

-- A. TABEL PRODUK (PRODUCTS)
create table if not exists public.products (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  category text default 'Lainnya',
  sku text not null,
  location text default 'Belum diatur',
  stock integer default 0,
  min_stock integer default 10,
  unit text default 'pcs',
  cost numeric default 0,
  expiry_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.products enable row level security;

drop policy if exists "Users can only select own products" on public.products;
create policy "Users can only select own products"
  on public.products for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can only insert own products" on public.products;
create policy "Users can only insert own products"
  on public.products for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can only update own products" on public.products;
create policy "Users can only update own products"
  on public.products for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can only delete own products" on public.products;
create policy "Users can only delete own products"
  on public.products for delete to authenticated
  using (user_id = auth.uid());


-- B. TABEL LOG AKTIVITAS (ACTIVITIES / AUDIT TRAIL)
create table if not exists public.activities (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null,
  user_name text not null,
  time timestamptz default now(),
  type text default 'edit'
);
alter table public.activities enable row level security;

drop policy if exists "Users can only select own activities" on public.activities;
create policy "Users can only select own activities"
  on public.activities for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can only insert own activities" on public.activities;
create policy "Users can only insert own activities"
  on public.activities for insert to authenticated
  with check (user_id = auth.uid());


-- C. TABEL SESI STOCK OPNAME (SESSIONS)
create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  location text default 'Gudang Utama',
  date date default current_date,
  status text default 'Berlangsung',
  items_checked integer default 0,
  total_items integer default 0,
  discrepancies integer default 0,
  created_by text,
  created_at timestamptz default now(),
  completed_at timestamptz
);
alter table public.sessions enable row level security;

drop policy if exists "Users can only select own sessions" on public.sessions;
create policy "Users can only select own sessions"
  on public.sessions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can only modify own sessions" on public.sessions;
create policy "Users can only modify own sessions"
  on public.sessions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- D. TABEL PERSETUJUAN (APPROVALS)
create table if not exists public.approvals (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text default 'transfer',
  title text not null,
  requester text not null,
  sku text,
  product_name text,
  quantity integer default 0,
  from_location text,
  to_location text,
  status text default 'pending',
  created_at timestamptz default now(),
  resolved_by text,
  resolved_at timestamptz
);
alter table public.approvals enable row level security;

drop policy if exists "Users can only select own approvals" on public.approvals;
create policy "Users can only select own approvals"
  on public.approvals for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can only modify own approvals" on public.approvals;
create policy "Users can only modify own approvals"
  on public.approvals for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- E. TABEL MUTASI STOK (MOVEMENTS)
create table if not exists public.movements (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id text references public.products(id) on delete cascade,
  product_name text not null,
  sku text not null,
  delta integer not null,
  previous integer not null,
  next integer not null,
  reason text default 'Penyesuaian stok',
  user_name text not null,
  created_at timestamptz default now()
);
alter table public.movements enable row level security;

drop policy if exists "Users can only select own movements" on public.movements;
create policy "Users can only select own movements"
  on public.movements for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can only insert own movements" on public.movements;
create policy "Users can only insert own movements"
  on public.movements for insert to authenticated
  with check (user_id = auth.uid());
