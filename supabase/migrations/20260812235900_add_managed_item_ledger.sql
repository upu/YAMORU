-- Issue #33: 技術スパイク用managed_itemsをMVP台帳へ更新し、任意リンクと
-- 家庭IDを受け取らない原子的な作成RPCを追加する。

alter table public.managed_items
  add column kind text;

update public.managed_items
   set kind = 'other';

alter table public.managed_items
  alter column kind set not null,
  add constraint managed_items_name_length_check
    check (
      name = pg_catalog.btrim(name)
      and pg_catalog.char_length(name) between 1 and 100
    ),
  add constraint managed_items_kind_check
    check (kind in (
      'pet_supplies',
      'appliance',
      'housing_equipment',
      'contract',
      'other'
    )),
  add constraint managed_items_id_household_key unique (id, household_id);

comment on table public.managed_items is
  '家庭内で管理する対象。MVPでは名前と種類だけを持ち、外部リンクはexternal_linksへ分離する(YDR-002)。';
comment on column public.managed_items.kind is
  'Phase 1の固定カテゴリ。拡張時に行移行を要するenumを避け、text + CHECKで境界を固定する。';

create table public.external_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  managed_item_id uuid not null,
  url text not null,
  created_at timestamptz not null default now(),
  constraint external_links_http_url_check check (
    pg_catalog.char_length(url) between 1 and 2048
    and url = pg_catalog.btrim(url)
    and url ~* '^https?://([[:alnum:]]([[:alnum:]-]*[[:alnum:]])?)(\.([[:alnum:]]([[:alnum:]-]*[[:alnum:]])?))*(:[0-9]+)?([/?#][^[:space:]]*)?$'
  ),
  constraint external_links_item_household_fkey
    foreign key (managed_item_id, household_id)
    references public.managed_items (id, household_id)
    on delete cascade
);

comment on table public.external_links is
  'ManagedItemの商品・説明書等への外部リンク。複合外部キーでManagedItemと家庭を一致させる。';

create index external_links_household_id_idx
  on public.external_links (household_id);
create index external_links_managed_item_id_idx
  on public.external_links (managed_item_id);

alter table public.external_links enable row level security;
alter table public.external_links force row level security;

grant select, update, delete on public.external_links to authenticated;

create policy external_links_select_member
  on public.external_links
  for select
  to authenticated
  using (public.is_household_member(household_id));

create policy external_links_update_member
  on public.external_links
  for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy external_links_delete_member
  on public.external_links
  for delete
  to authenticated
  using (public.is_household_member(household_id));

-- 本体とリンクの部分更新を避けるため、新規作成はこのRPCだけへ限定する。
revoke insert on table public.managed_items from authenticated;
drop policy managed_items_insert_member on public.managed_items;

create or replace function public.create_managed_item(
  item_name text,
  item_kind text,
  external_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  creating_user_id uuid := auth.uid();
  current_household_id uuid;
  normalized_name text := pg_catalog.btrim(item_name);
  normalized_external_url text := nullif(
    pg_catalog.btrim(external_url),
    ''
  );
  new_managed_item_id uuid;
begin
  if creating_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  if normalized_name is null
     or pg_catalog.char_length(normalized_name) not between 1 and 100 then
    raise exception using
      errcode = 'P0001',
      message = 'Managed item name must be between 1 and 100 characters';
  end if;

  if item_kind is null or item_kind not in (
    'pet_supplies',
    'appliance',
    'housing_equipment',
    'contract',
    'other'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Invalid managed item kind';
  end if;

  if normalized_external_url is not null and (
    pg_catalog.char_length(normalized_external_url) > 2048
    or normalized_external_url !~* '^https?://([[:alnum:]]([[:alnum:]-]*[[:alnum:]])?)(\.([[:alnum:]]([[:alnum:]-]*[[:alnum:]])?))*(:[0-9]+)?([/?#][^[:space:]]*)?$'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'External URL must be an absolute HTTP or HTTPS URL';
  end if;

  select member.household_id
    into current_household_id
    from public.household_members member
   where member.user_id = creating_user_id;

  if current_household_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Household membership required';
  end if;

  insert into public.managed_items (household_id, name, kind)
  values (current_household_id, normalized_name, item_kind)
  returning id into new_managed_item_id;

  if normalized_external_url is not null then
    insert into public.external_links (household_id, managed_item_id, url)
    values (
      current_household_id,
      new_managed_item_id,
      normalized_external_url
    );
  end if;

  return new_managed_item_id;
end;
$$;

alter function public.create_managed_item(text, text, text) owner to postgres;
revoke all on function public.create_managed_item(text, text, text)
  from public, anon, service_role;
grant execute on function public.create_managed_item(text, text, text)
  to authenticated;

comment on function public.create_managed_item(text, text, text) is
  'auth.uid()の家庭へManagedItemと任意リンクを一つのトランザクションで作成する。';
