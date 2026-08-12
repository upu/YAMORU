-- Issue #28: 認証済み利用者が最初の家庭と自分のmembershipを一度だけ作成する。
--
-- クライアントから受け取るのは家庭名だけとし、利用者IDはauth.uid()から決定する。
-- households / household_membersへの通常INSERT権限は開けず、この限定RPC内だけで
-- 二つの行を同一トランザクションとして作成する。

alter table public.households
  add constraint households_name_length_check
  check (
    pg_catalog.char_length(
      pg_catalog.regexp_replace(
        name,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
      )
    ) between 1 and 100
  );

-- MVPでは一人が所属できる家庭を一つに限定する。複数家庭を導入する場合は、
-- 切り替え操作と権限境界を設計した新しいマイグレーションで制約を外す。
drop index public.household_members_user_id_idx;
alter table public.household_members
  add constraint household_members_user_id_key unique (user_id);

revoke insert on table public.households
  from public, anon, authenticated, service_role;
revoke insert on table public.household_members
  from public, anon, authenticated, service_role;

create or replace function public.create_first_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  creating_user_id uuid := auth.uid();
  normalized_name text := pg_catalog.regexp_replace(
    household_name,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  existing_household_id uuid;
  new_household_id uuid;
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
      message = 'Household name must be between 1 and 100 characters';
  end if;

  -- 同じAuth利用者の行をロックし、同時実行も「所属確認→作成」の順で直列化する。
  -- 後から到着した要求は、先行要求が作成したmembershipを確認して同じ家庭IDを返す。
  perform 1
    from auth.users auth_user
   where auth_user.id = creating_user_id
   for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  select member.household_id
    into existing_household_id
    from public.household_members member
   where member.user_id = creating_user_id
   order by member.created_at, member.id
   limit 1;

  if found then
    return existing_household_id;
  end if;

  insert into public.households (name)
  values (normalized_name)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id)
  values (new_household_id, creating_user_id);

  return new_household_id;
end;
$$;

alter function public.create_first_household(text) owner to postgres;
revoke all on function public.create_first_household(text)
  from public, anon, service_role;
grant execute on function public.create_first_household(text) to authenticated;

comment on function public.create_first_household(text) is
  '家庭未所属の認証済み利用者が、最初の家庭と自分のmembershipを原子的かつ一度だけ作成する。';
