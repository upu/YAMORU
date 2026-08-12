-- Issue #33: ManagedItem台帳のスキーマ、限定RPC、家庭間分離を検証する。
-- fixtureはsupabase/seed.sqlの架空データだけを使う。

create extension if not exists pgtap with schema extensions;

begin;

select plan(34);

select has_function(
  'public',
  'create_managed_item',
  array['text', 'text', 'text'],
  'ManagedItemと任意リンクを原子的に作成するRPCが存在する'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_managed_item(text,text,text)',
    'execute'
  ),
  'authenticatedだけが作成RPCを実行できる'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_managed_item(text,text,text)',
    'execute'
  ),
  'anonは作成RPCを実行できない'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.create_managed_item(text,text,text)',
    'execute'
  ),
  'Service Roleにも作成RPCを公開しない'
);

select is(
  (
    select procedure_definition.prosecdef
      from pg_catalog.pg_proc procedure_definition
      join pg_catalog.pg_namespace namespace_definition
        on namespace_definition.oid = procedure_definition.pronamespace
     where namespace_definition.nspname = 'public'
       and procedure_definition.proname = 'create_managed_item'
  ),
  true,
  '作成RPCはSECURITY DEFINERである'
);

select is(
  (
    select pg_catalog.pg_get_userbyid(procedure_definition.proowner)
      from pg_catalog.pg_proc procedure_definition
      join pg_catalog.pg_namespace namespace_definition
        on namespace_definition.oid = procedure_definition.pronamespace
     where namespace_definition.nspname = 'public'
       and procedure_definition.proname = 'create_managed_item'
  ),
  'postgres',
  '作成RPCの所有者をpostgresへ固定する'
);

select is(
  (
    select procedure_definition.proconfig
      from pg_catalog.pg_proc procedure_definition
      join pg_catalog.pg_namespace namespace_definition
        on namespace_definition.oid = procedure_definition.pronamespace
     where namespace_definition.nspname = 'public'
       and procedure_definition.proname = 'create_managed_item'
  ),
  array['search_path=""']::text[],
  '作成RPCのsearch_pathは空である'
);

select ok(
  not has_table_privilege('authenticated', 'public.managed_items', 'insert'),
  'ManagedItemの直接INSERTを許可せず作成をRPCへ限定する'
);

select ok(
  not has_table_privilege('authenticated', 'public.external_links', 'insert'),
  '外部リンクの直接INSERTを許可せず作成をRPCへ限定する'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_constraint constraint_definition
     where constraint_definition.conrelid = 'public.managed_items'::regclass
       and constraint_definition.conname = 'managed_items_kind_check'
       and constraint_definition.contype = 'c'
  ),
  'ManagedItemの種類をCHECK制約で限定する'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_constraint constraint_definition
     where constraint_definition.conrelid = 'public.external_links'::regclass
       and constraint_definition.conname = 'external_links_http_url_check'
       and constraint_definition.contype = 'c'
  ),
  '外部URLをhttp/httpsの絶対URLへ限定するCHECK制約がある'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_constraint constraint_definition
     where constraint_definition.conrelid = 'public.external_links'::regclass
       and constraint_definition.conname = 'external_links_item_household_fkey'
       and constraint_definition.contype = 'f'
  ),
  'ManagedItemと外部リンクの家庭IDを複合外部キーで一致させる'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_managed_item(
       '  猫の給水器  ',
       'pet_supplies',
       '  https://example.com/product  '
     ) $$,
  '家庭Aのメンバーは名前・種類・httpsリンクを登録できる'
);

select results_eq(
  $$ select name, kind
       from public.managed_items
      where name = '猫の給水器' $$,
  $$ values ('猫の給水器'::text, 'pet_supplies'::text) $$,
  '名前の前後空白を除き種類とともに保存する'
);

select results_eq(
  $$ select external_link.url
       from public.external_links external_link
       join public.managed_items item on item.id = external_link.managed_item_id
      where item.name = '猫の給水器' $$,
  $$ values ('https://example.com/product'::text) $$,
  'httpsリンクを同じ家庭のManagedItemへ保存する'
);

select isnt_empty(
  $$ select public.create_managed_item('リンクなし', 'other', '   ') $$,
  '空白だけの任意リンクはリンクなしとして登録できる'
);

select is(
  (
    select count(*)
      from public.external_links external_link
      join public.managed_items item on item.id = external_link.managed_item_id
     where item.name = 'リンクなし'
  ),
  0::bigint,
  '任意リンクが空ならexternal_links行を作らない'
);

select isnt_empty(
  $$ select public.create_managed_item(
       'HTTPリンク',
       'other',
       'http://example.com/manual'
     ) $$,
  'httpリンクも登録できる'
);

select results_eq(
  $$ select external_link.url
       from public.external_links external_link
       join public.managed_items item on item.id = external_link.managed_item_id
      where item.name = 'HTTPリンク' $$,
  $$ values ('http://example.com/manual'::text) $$,
  'httpリンクを保存する'
);

select throws_ok(
  $$ select public.create_managed_item('未定義の種類', 'secret_kind', null) $$,
  'P0001',
  'Invalid managed item kind',
  '未定義の種類を拒否する'
);

select throws_ok(
  $$ select public.create_managed_item('   ', 'other', null) $$,
  'P0001',
  'Managed item name must be between 1 and 100 characters',
  '空白だけの名前を拒否する'
);

select throws_ok(
  $$ select public.create_managed_item('危険なURL', 'other', 'javascript:alert(1)') $$,
  'P0001',
  'External URL must be an absolute HTTP or HTTPS URL',
  'javascript URLを拒否する'
);

select throws_ok(
  $$ select public.create_managed_item('FTP URL', 'other', 'ftp://example.com/file') $$,
  'P0001',
  'External URL must be an absolute HTTP or HTTPS URL',
  'ftp URLを拒否する'
);

select throws_ok(
  $$ select public.create_managed_item('相対URL', 'other', '/manual') $$,
  'P0001',
  'External URL must be an absolute HTTP or HTTPS URL',
  '相対URLを拒否する'
);

select throws_ok(
  $$ select public.create_managed_item('不完全URL', 'other', 'https://') $$,
  'P0001',
  'External URL must be an absolute HTTP or HTTPS URL',
  'ホスト名のないURLを拒否する'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_managed_item('家庭未所属', 'other', null) $$,
  'P0001',
  'Household membership required',
  '家庭未所属の利用者はManagedItemを作成できない'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_managed_item(
       '家庭Bのリンク付き対象',
       'other',
       'https://example.com/household-b'
     ) $$,
  '家庭Bにも比較用ManagedItemとリンクを作成できる'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select is_empty(
  $$ select id from public.managed_items where name = '家庭Bのリンク付き対象' $$,
  '家庭Aの利用者は家庭BのManagedItemを参照できない'
);

select is_empty(
  $$ select external_link.id
       from public.external_links external_link
      where external_link.url = 'https://example.com/household-b' $$,
  '家庭Aの利用者は家庭Bの外部リンクを参照できない'
);

select is_empty(
  $$ update public.managed_items
        set name = '家庭Aから変更'
      where name = '家庭Bのリンク付き対象'
      returning id $$,
  '家庭Aの利用者は家庭BのManagedItemを変更できない'
);

select is_empty(
  $$ update public.external_links
        set url = 'https://example.com/changed'
      where url = 'https://example.com/household-b'
      returning id $$,
  '家庭Aの利用者は家庭Bの外部リンクを変更できない'
);

reset role;

create function public.reject_atomicity_test_link()
returns trigger
language plpgsql
as $$
begin
  if new.url = 'https://atomicity.example.test' then
    raise exception 'atomicity test failure';
  end if;
  return new;
end;
$$;

create trigger reject_atomicity_test_link
before insert on public.external_links
for each row execute function public.reject_atomicity_test_link();

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_managed_item(
       '原子性テスト対象',
       'other',
       'https://atomicity.example.test'
     ) $$,
  'P0001',
  'atomicity test failure',
  '外部リンク作成失敗時はRPC全体が失敗する'
);

reset role;

select is(
  (select count(*) from public.managed_items where name = '原子性テスト対象'),
  0::bigint,
  'リンク作成失敗時にManagedItemだけを残さない'
);

select throws_ok(
  $$ insert into public.external_links (household_id, managed_item_id, url)
     select
       '00000000-0000-0000-0000-00000000a001',
       item.id,
       'https://example.com/mismatched-household'
       from public.managed_items item
      where item.name = '家庭Bのリンク付き対象' $$,
  '23503',
  null,
  '異なる家庭のManagedItemと外部リンクを関連付けられない'
);

select * from finish();

rollback;
