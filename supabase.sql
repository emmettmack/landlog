-- Landlog shared database. Paste this whole file into Supabase > SQL Editor > Run.
-- Anyone can read and add; nobody can edit or delete through the public key.
-- Moderate (hide, restore, delete, add landlord replies) from the Supabase Table Editor.

create table if not exists landlords (
  id         text primary key check (id ~ '^u-[a-z0-9-]{1,80}$'),
  name       text not null check (char_length(name) between 2 and 80),
  type       text not null default 'Added by a tenant' check (char_length(type) <= 40),
  city       text not null check (char_length(city) between 1 and 60),
  state      text not null default '' check (char_length(state) <= 20),
  created_at timestamptz not null default now()
);

create table if not exists ll_props (
  ll         text not null,
  prop       text not null check (char_length(prop) between 3 and 100),
  created_at timestamptz not null default now(),
  primary key (ll, prop)
);

create table if not exists reviews (
  id         text primary key check (id ~ '^u[a-z0-9]{3,20}$'),
  ll         text not null,
  prop       text not null check (char_length(prop) between 3 and 100),
  year       text check (year is null or char_length(year) <= 4),
  overall    smallint not null check (overall between 1 and 5),
  resp       smallint not null check (resp between 1 and 5),
  repairs    smallint not null check (repairs between 1 and 5),
  deposit    text not null check (deposit in ('full','partial','withheld','living','na')),
  again      boolean not null,
  tags       text[] not null default '{}' check (cardinality(tags) <= 3),
  text       text not null default '' check (char_length(text) <= 1000),
  reply      text check (reply is null or char_length(reply) <= 1000),
  flags      int not null default 0,
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists reviews_ll_idx on reviews (ll);

alter table landlords enable row level security;
alter table ll_props  enable row level security;
alter table reviews   enable row level security;

drop policy if exists "read landlords" on landlords;
drop policy if exists "add landlords"  on landlords;
drop policy if exists "read props"     on ll_props;
drop policy if exists "add props"      on ll_props;
drop policy if exists "read reviews"   on reviews;
drop policy if exists "add reviews"    on reviews;

create policy "read landlords" on landlords for select using (true);
create policy "add landlords"  on landlords for insert with check (true);
create policy "read props"     on ll_props  for select using (true);
create policy "add props"      on ll_props  for insert with check (true);
create policy "read reviews"   on reviews   for select using (not hidden);
create policy "add reviews"    on reviews   for insert with check (flags = 0 and hidden = false and reply is null);

-- Public key may only read and add (never update or delete).
grant usage on schema public to anon;
grant select, insert on landlords, ll_props, reviews to anon;

-- Reporting: 3 reports hides a review until you look at it.
create or replace function flag_review(rid text) returns void
language sql security definer set search_path = public as $$
  update reviews set flags = flags + 1, hidden = (flags + 1 >= 3) where id = rid;
$$;
revoke all on function flag_review(text) from public;
grant execute on function flag_review(text) to anon;
