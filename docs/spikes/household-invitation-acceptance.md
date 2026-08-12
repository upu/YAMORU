---
type: Spike Report
title: 招待トークン受諾とRLSによる家庭間分離の技術スパイク
description: 非メンバーが期限付き一回限りの招待を安全に受諾し、受諾後も家庭間分離を維持できるかを検証した
tags: [yamoru, spike, supabase, invitations, rls, security]
status: stable
---

# 招待トークン受諾とRLSによる家庭間分離の技術スパイク

Issue: [#20](https://github.com/upu/YAMORU/issues/20)

前提: [Supabase RLSによる家庭間データ分離の技術スパイク](supabase-rls-household-isolation.md)

関連: [YDR-005](../decisions/ydr-005-no-realtime-no-fine-grained-permissions.md)

## 背景

通常のRLSでは、まだ招待先家庭のメンバーではない利用者を`household_members`へ追加できない。一方で、authenticatedへmembershipの直接INSERTを許可すると、任意の家庭IDを指定して参加できる権限昇格になる。Phase 2の本実装前に、期限付き・一回限りの招待受諾と家庭間分離を両立できるか検証した。

## 比較した方式

| 方式 | 長所 | 短所・リスク | 評価 |
|---|---|---|---|
| 認証済み利用者だけが呼べる限定DB関数(RPC) | 招待のロック、membership追加、使用済み化を同一DBトランザクションにできる。入力を生トークンだけに限定し、`auth.uid()`を受諾者として使える | `SECURITY DEFINER`の所有者・検索パス・実行権限・処理範囲を厳密に管理する必要がある | 採用 |
| Next.jsなど信頼できるサーバー側の非公開処理 | 招待発行、レート制限、監査などWeb層の制御を集約しやすい。Service Roleキーをブラウザへ渡さずに済む | Service Roleは権限が広く、複数のData API呼び出しだけでは受諾全体を同一トランザクションにできない。結局、原子的なDB処理が別途必要になる | 受諾の中核には不採用。招待発行や追加防御で併用を検討 |

## 採用案

authenticatedだけが実行できる`public.accept_household_invitation(text)`を採用した。クライアントが渡せるのは生トークンだけで、`household_id`はハッシュが一致した招待レコード、`user_id`は`auth.uid()`から決定する。

処理は次の順序で一つの関数呼び出しにまとめた。

1. `auth.uid()`が存在することを確認する。
2. 生トークンをSHA-256でハッシュし、未使用かつ期限内の招待を`FOR UPDATE`でロックする。
3. `(household_id, user_id)`の一意制約を使い、membershipを重複なく追加する。
4. 同じトランザクション内で、招待へ`accepted_at`と`accepted_by`を記録する。

既に同じ家庭のメンバーである場合も招待は正常に使用済みとなり、戻り値`membership_created = false`で重複を作らなかったことを示す。無効・期限切れ・使用済みトークンは同じエラーにまとめ、招待の存在や状態を判別しにくくした。

## `SECURITY DEFINER`が必要な理由と制限

受諾前の利用者には、招待テーブルの参照権限もmembershipの追加権限もない。その境界を限定的に越えて、招待の検証・membership追加・使用済み化を原子的に行うため、RPCに`SECURITY DEFINER`が必要となる。

権限昇格範囲は次の対策で限定した。

- 所有者を`postgres`へ明示的に固定する。
- `search_path = ''`とし、関数内のオブジェクトを完全修飾する。
- 関数の`EXECUTE`を`public`、`anon`、`service_role`から剥奪し、`authenticated`だけへ付与する。
- 招待テーブルにはauthenticated/anonの通常操作権限を与えず、RLSを有効化・強制する。通常操作用のポリシーも作らない。
- `household_members`のINSERT/UPDATE/DELETEをauthenticated/anonへ許可しない。
- 任意SQL、任意の家庭ID、任意の利用者IDを入力として受け取らない。
- `FOR UPDATE`で同じ招待への受諾を直列化し、後続処理の例外時は関数呼び出し全体をロールバックする。

クライアントへService Roleキーを渡す方式は採用していない。

## 検証結果

実装は次を参照する。

- マイグレーション: `supabase/migrations/20260812120000_add_household_invitation_acceptance_spike.sql`
- ローカルfixture: `supabase/seed.sql`
- pgTAP: `supabase/tests/database/invitation_acceptance.sql`

`npm run db:reset`で既存スキーマから招待スキーマまで再構築し、`npm run db:test`で既存の家庭間分離16件と招待受諾41件、合計57件が成功した。

自動テストでは次の境界を確認した。

- 受諾前は招待先家庭のデータを参照できない。
- 有効なトークンを認証済み利用者が受諾でき、受諾後は招待先家庭のデータを読み書きできる。
- 受諾後も別家庭のデータを読み書きできない。
- 無効・期限切れ・使用済みトークンと未認証利用者は受諾できない。
- membershipへ直接INSERTして任意の家庭へ参加できない。
- membership追加を意図的に失敗させた場合、membershipと招待状態のどちらも部分更新されない。
- 既存メンバーの受諾で重複membershipが作られない。
- 招待テーブルに生トークン用の列がなく、fixtureにもハッシュだけが保存される。
- テーブル、関数、所有者、`search_path`、RLSの権限境界が想定どおりである。

## 残るリスクと後続実装への注意点

- **招待発行は今回の対象外。** 本実装では暗号学的に安全な乱数から十分長いトークンを生成し、生値は招待リンクの作成時だけ扱う。SHA-256単体は低エントロピーなトークンを守れないため、トークンの推測困難性を発行側で保証する。
- **受諾APIの試行回数制限が必要。** 無効なトークンは同じエラーへまとめたが、Phase 2ではWeb/API層のレート制限とセキュリティログを追加する。
- **招待の発行・取消・再送を別途設計する。** これらは通常利用者へ招待テーブルの直接操作権限を与えず、信頼できるサーバー処理または別の限定RPCとして設計する。
- **メールアドレスとの一致は未検証。** 家庭外へリンクが漏れた場合、トークンを得た別の認証済み利用者も受諾できる。必要性をPhase 2で判断する。
- **同時実行テストは未実施。** `FOR UPDATE`と未使用条件で一回限りになる構造だが、本実装時には並行受諾の統合テストも追加する。
- **所有者と権限を継続監査する。** 将来のマイグレーションでdefault privilegeや関数シグネチャを変えた場合、`public`/`anon`へ実行権限が戻っていないか確認する。

## このスパイクで扱わなかったこと

- リモートSupabaseプロジェクトへの適用
- Next.jsアプリからの実接続
- 招待画面、ログイン画面、招待リンク送信
- 本番用トークンの発行、取消、再送
- メールアドレスと招待先利用者の一致確認
- Owner/Memberなどの役割区別
- GitHub ActionsでのDBテスト実行
