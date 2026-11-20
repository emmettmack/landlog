-- Landlog backend v2. Run AFTER supabase.sql. Safe to run again.
-- Adds: accounts + admin role, richer reviews, abuse limits, content rules, reports, helpful votes,
-- edit/delete your own review, photos (moderated), landlord claims + replies, owner/alias tables, analytics.

drop function if exists flag_review(text);

-- ---------- admin role ----------
create table if not exists admins (email text primary key);
alter table admins enable row level security;            -- no policies: not reachable through the API
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- ---------- richer reviews ----------
alter table reviews add column if not exists unit text check (unit is null or char_length(unit) <= 12);
alter table reviews add column if not exists rent int check (rent is null or rent between 100 and 30000);
alter table reviews add column if not exists beds smallint check (beds is null or beds between 0 and 12);
alter table reviews add column if not exists lease_end date;
alter table reviews add column if not exists issues text[] not null default '{}' check (cardinality(issues) <= 12);
alter table reviews add column if not exists deposit_amount int check (deposit_amount is null or deposit_amount between 0 and 100000);
alter table reviews add column if not exists deposit_days int check (deposit_days is null or deposit_days between 0 and 400);
alter table reviews add column if not exists verified boolean not null default false;
alter table reviews add column if not exists helpful int not null default 0;
alter table reviews add column if not exists owner_hash text;   -- transient: moved to review_private by trigger
alter table reviews add column if not exists device text;       -- transient: moved to review_private by trigger
alter table reviews add column if not exists edited_at timestamptz;
alter table reviews add column if not exists reply_at timestamptz;
alter table landlords add column if not exists parent text;     -- management company this entity belongs to

create table if not exists review_private (
  review_id  text primary key,
  user_id    uuid,
  owner_hash text,
  device     text,
  ip_hash    text,
  created_at timestamptz not null default now()
);
create index if not exists review_private_ip on review_private (ip_hash, created_at);
create index if not exists review_private_dev on review_private (device, created_at);
alter table review_private enable row level security;

create table if not exists banned_words (word text primary key check (char_length(word) between 2 and 40));
alter table banned_words enable row level security;

-- ---------- content rules ----------
create or replace function check_text(t text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if t is null then return; end if;
  if t ~* '(\+?1[ .-]?)?\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}' then raise exception 'Please remove phone numbers from your review.'; end if;
  if t ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then raise exception 'Please remove email addresses from your review.'; end if;
  if t ~* '(https?://|www\.)' then raise exception 'Please remove links from your review.'; end if;
  if exists (select 1 from banned_words b where t ~* ('\m' || b.word || '\M')) then raise exception 'Please remove abusive language.'; end if;
end $$;

-- ---------- insert trigger: limits, privacy, server-set fields ----------
create or replace function reviews_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare h json; ip text; iph text; n int; uid uuid; em text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := '{}'::json; end;
  ip  := trim(split_part(coalesce(h ->> 'x-forwarded-for', h ->> 'cf-connecting-ip', ''), ',', 1));
  iph := case when ip = '' then null else md5(ip || 'landlog') end;
  uid := auth.uid();
  em  := lower(coalesce(auth.jwt() ->> 'email', ''));

  perform check_text(new.text);

  select count(*) into n from review_private p
   where p.created_at > now() - interval '1 day'
     and ((new.device is not null and p.device = new.device) or (uid is not null and p.user_id = uid));
  if n >= 6 then raise exception 'You have posted a lot today. Please try again tomorrow.'; end if;
  if iph is not null then
    select count(*) into n from review_private p where p.created_at > now() - interval '1 day' and p.ip_hash = iph;
    if n >= 20 then raise exception 'Too many reviews from this network today. Please try again tomorrow.'; end if;
  end if;
  if exists (select 1 from review_private p join reviews r on r.id = p.review_id
              where r.prop = new.prop and r.ll = new.ll and coalesce(r.unit, '') = coalesce(new.unit, '')
                and p.created_at > now() - interval '30 days'
                and ((new.device is not null and p.device = new.device) or (uid is not null and p.user_id = uid))) then
    raise exception 'You already reviewed this address recently. Edit your review instead.';
  end if;

  insert into review_private (review_id, user_id, owner_hash, device, ip_hash)
  values (new.id, uid, new.owner_hash, new.device, iph);

  new.verified  := em like '%.edu';
  new.flags := 0; new.hidden := false; new.reply := null; new.helpful := 0;
  new.owner_hash := null; new.device := null; new.edited_at := null; new.reply_at := null;
  return new;
end $$;
drop trigger if exists reviews_bi on reviews;
create trigger reviews_bi before insert on reviews for each row execute function reviews_before_insert();

-- ---------- reports and helpful votes ----------
create table if not exists reports (
  review_id text not null, device text not null, ip_hash text, created_at timestamptz not null default now(),
  primary key (review_id, device)
);
create unique index if not exists reports_ip on reports (review_id, ip_hash) where ip_hash is not null;
create table if not exists votes (
  review_id text not null, voter text not null, created_at timestamptz not null default now(),
  primary key (review_id, voter)
);
alter table reports enable row level security;
alter table votes enable row level security;

create or replace function flag_review(rid text, dev text default null) returns void
language plpgsql security definer set search_path = public as $$
declare h json; ip text; iph text; d text; n int;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := '{}'::json; end;
  ip := trim(split_part(coalesce(h ->> 'x-forwarded-for', h ->> 'cf-connecting-ip', ''), ',', 1));
  iph := case when ip = '' then null else md5(ip || 'landlog') end;
  d := coalesce(auth.uid()::text, nullif(dev, ''), iph);
  if d is null then return; end if;
  insert into reports (review_id, device, ip_hash) values (rid, d, iph) on conflict do nothing;
  select count(*) into n from reports where review_id = rid;
  update reviews set flags = n, hidden = (n >= 3) where id = rid;
end $$;

create or replace function toggle_vote(rid text, dev text) returns int
language plpgsql security definer set search_path = public as $$
declare d text; n int;
begin
  d := coalesce(auth.uid()::text, nullif(dev, ''));
  if d is null then return 0; end if;
  if exists (select 1 from votes where review_id = rid and voter = d) then
    delete from votes where review_id = rid and voter = d;
  else
    insert into votes (review_id, voter) values (rid, d);
  end if;
  select count(*) into n from votes where review_id = rid;
  update reviews set helpful = n where id = rid;
  return n;
end $$;

-- ---------- edit / delete your own review (secret token kept in your browser, or signed in) ----------
create or replace function owns_review(rid text, token text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from review_private p where p.review_id = rid
    and ((token is not null and p.owner_hash = encode(sha256(convert_to(token, 'utf8')), 'hex'))
      or (p.user_id is not null and p.user_id = auth.uid())));
$$;

create or replace function update_review(rid text, token text, patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not owns_review(rid, token) then raise exception 'You can only edit your own review.'; end if;
  if patch ? 'text' then perform check_text(patch ->> 'text'); end if;
  update reviews set
    text     = case when patch ? 'text'    then coalesce(patch ->> 'text', '') else text end,
    overall  = case when patch ? 'overall' then (patch ->> 'overall')::smallint else overall end,
    resp     = case when patch ? 'resp'    then (patch ->> 'resp')::smallint else resp end,
    repairs  = case when patch ? 'repairs' then (patch ->> 'repairs')::smallint else repairs end,
    deposit  = case when patch ? 'deposit' then patch ->> 'deposit' else deposit end,
    again    = case when patch ? 'again'   then (patch ->> 'again')::boolean else again end,
    tags     = case when patch ? 'tags'    then array(select jsonb_array_elements_text(patch -> 'tags')) else tags end,
    issues   = case when patch ? 'issues'  then array(select jsonb_array_elements_text(patch -> 'issues')) else issues end,
    unit     = case when patch ? 'unit'    then nullif(patch ->> 'unit', '') else unit end,
    rent     = case when patch ? 'rent'    then nullif(patch ->> 'rent', '')::int else rent end,
    beds     = case when patch ? 'beds'    then nullif(patch ->> 'beds', '')::smallint else beds end,
    deposit_amount = case when patch ? 'deposit_amount' then nullif(patch ->> 'deposit_amount', '')::int else deposit_amount end,
    deposit_days   = case when patch ? 'deposit_days'   then nullif(patch ->> 'deposit_days', '')::int else deposit_days end,
    edited_at = now()
  where id = rid;
end $$;

create or replace function delete_review(rid text, token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not owns_review(rid, token) then raise exception 'You can only delete your own review.'; end if;
  delete from review_photos where review_id = rid;
  delete from reviews where id = rid;
  delete from review_private where review_id = rid;
end $$;

-- ---------- photos (hidden until you approve them) ----------
create table if not exists review_photos (
  id uuid primary key default gen_random_uuid(),
  review_id text not null,
  path text not null check (char_length(path) between 5 and 160),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table review_photos enable row level security;

create or replace function add_photo(rid text, token text, p text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not owns_review(rid, token) then raise exception 'You can only add photos to your own review.'; end if;
  if (select count(*) from review_photos where review_id = rid) >= 4 then raise exception 'Up to 4 photos per review.'; end if;
  insert into review_photos (review_id, path) values (rid, p);
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "photos upload" on storage.objects;
drop policy if exists "photos admin delete" on storage.objects;
create policy "photos upload" on storage.objects for insert to anon, authenticated with check (bucket_id = 'review-photos');
create policy "photos admin delete" on storage.objects for delete to authenticated using (bucket_id = 'review-photos' and is_admin());

-- ---------- landlord claims and replies ----------
create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  ll text not null check (char_length(ll) <= 100),
  name text not null check (char_length(name) between 2 and 80),
  email text not null check (char_length(email) between 5 and 120),
  role text check (role is null or char_length(role) <= 60),
  message text check (message is null or char_length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create table if not exists landlord_owners (
  ll text not null, email text not null, created_at timestamptz not null default now(),
  primary key (ll, email)
);
alter table claims enable row level security;
alter table landlord_owners enable row level security;

create or replace function reply_review(rid text, body text) returns void
language plpgsql security definer set search_path = public as $$
declare l text;
begin
  select ll into l from reviews where id = rid;
  if l is null then raise exception 'Review not found.'; end if;
  if not (is_admin() or exists (select 1 from landlord_owners o
          where o.ll = l and lower(o.email) = lower(coalesce(auth.jwt() ->> 'email', '')))) then
    raise exception 'Only the verified landlord can reply.';
  end if;
  if char_length(coalesce(body, '')) > 1000 then raise exception 'Reply is too long.'; end if;
  perform check_text(body);
  update reviews set reply = nullif(trim(body), ''), reply_at = now() where id = rid;
end $$;

-- ---------- owners, building names, analytics ----------
create table if not exists addr_owners (
  slug text primary key, owner text not null check (char_length(owner) between 2 and 120),
  source text, updated_at timestamptz not null default now()
);
create table if not exists aliases (
  name text primary key check (char_length(name) between 2 and 80),
  slug text not null, note text
);
create table if not exists events (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) <= 20),
  path text check (path is null or char_length(path) <= 120),
  q text check (q is null or char_length(q) <= 80),
  created_at timestamptz not null default now()
);
create index if not exists events_t on events (created_at);
alter table addr_owners enable row level security;
alter table aliases enable row level security;
alter table events enable row level security;

-- ---------- policies ----------
do $$ declare t text; begin
  for t in select unnest(array['landlords','ll_props','reviews','review_private','banned_words','reports','votes','review_photos',
                               'claims','landlord_owners','addr_owners','aliases','events']) loop
    execute format('drop policy if exists "admin all" on %I', t);
    execute format('create policy "admin all" on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

create or replace function is_my_review(rid text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from review_private p where p.review_id = rid and p.user_id = auth.uid());
$$;
grant execute on function is_my_review(text) to anon, authenticated;
drop policy if exists "read reviews" on reviews;
create policy "read reviews" on reviews for select using (not hidden or is_my_review(id));

drop policy if exists "own private" on review_private;
create policy "own private" on review_private for select to authenticated using (user_id = auth.uid());

drop policy if exists "read photos" on review_photos;
create policy "read photos" on review_photos for select using (approved);

drop policy if exists "add claims" on claims;
create policy "add claims" on claims for insert with check (status = 'pending');

drop policy if exists "own landlord rows" on landlord_owners;
create policy "own landlord rows" on landlord_owners for select to authenticated using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "read owners" on addr_owners;
create policy "read owners" on addr_owners for select using (true);
drop policy if exists "read aliases" on aliases;
create policy "read aliases" on aliases for select using (true);

drop policy if exists "add events" on events;
create policy "add events" on events for insert with check (true);

-- ---------- privileges ----------
grant usage on schema public to anon, authenticated;
grant select, insert on landlords, ll_props, reviews to anon, authenticated;
grant select on review_photos, addr_owners, aliases to anon, authenticated;
grant insert on claims, events to anon, authenticated;
grant select on review_private, landlord_owners to authenticated;
grant update, delete on landlords, ll_props, reviews, review_photos, claims, landlord_owners, addr_owners, aliases, banned_words, events to authenticated;
grant select, insert on claims, landlord_owners, addr_owners, aliases, banned_words, events, reports, votes to authenticated;
grant insert, update, delete on addr_owners, aliases to authenticated;
grant delete on reports, votes, review_private to authenticated;
grant usage on all sequences in schema public to anon, authenticated;

revoke all on function flag_review(text, text), toggle_vote(text, text), update_review(text, text, jsonb),
  delete_review(text, text), add_photo(text, text, text), reply_review(text, text) from public;
grant execute on function flag_review(text, text), toggle_vote(text, text), update_review(text, text, jsonb),
  delete_review(text, text), add_photo(text, text, text), reply_review(text, text) to anon, authenticated;
grant execute on function is_admin() to anon, authenticated;
