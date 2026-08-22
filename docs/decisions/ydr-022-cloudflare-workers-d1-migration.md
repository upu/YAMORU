---
type: Decision
ydr_id: YDR-022
title: Cloudflare Workers + D1へ移行し、家庭間分離をアプリ層で実装する
description: 本番運用基盤をCloudflare Workers + D1へ移行する方針を採用し、household間のデータ分離をSupabase RLSからアプリ層の所属チェックへ置き換える
tags: [yamoru, decisions, ydr, cloudflare, infrastructure]
status: stable
decision_status: Accepted
decision_date: 2026-08-20
supersedes: YDR-005
---

# YDR-022: Cloudflare Workers + D1へ移行し、家庭間分離をアプリ層で実装する

- 状態: Accepted
- 決定日: 2026-08-20
- 置き換える決定: [YDR-005](ydr-005-no-realtime-no-fine-grained-permissions.md)の「household_idとRLSによる家庭間の分離は必須とする」のみ。Realtimeを作らないこと、家庭メンバー全員が編集可能なことは変更しない(下記「決定」に引き継ぐ)。

## 背景

[Issue #116](https://github.com/upu/YAMORU/issues/116)で、本番運用基盤としてCloudflareを中心とした構成を採用できるかを検証した。個人開発であることを踏まえ、無料枠での長期運用・利用サービスの集約・ローカル開発の容易さ・運用実装の複雑さを重視し、以下2案を実機で比較検証した。

- A案: Cloudflare Workers + Supabase継続(Auth/RLSはそのまま)
- B案: Cloudflare Workers + D1 + アプリ層認可(RLSを持たない)

検証結果は[cloudflare-workers-d1.md](../spikes/cloudflare-workers-d1.md)(B案)と[cloudflare-workers-supabase.md](../spikes/cloudflare-workers-supabase.md)(A案)を参照。両案とも、Next.js 16の`proxy.ts`がOpenNext for Cloudflareで動かない共通の非互換があったが、deprecatedな`middleware.ts`(旧ミドルウェア規約)+Edgeランタイムへの切り戻しで回避できることを実証した。

本決定時点のYAMORUはクラウドへのデプロイ実績がなく、各利用者が自宅でローカルSupabase + `next dev`を動かす運用だった。本決定は、この自宅セルフホスト運用から、Cloudflareを使った常時稼働のクラウド運用へ移行する方針を定める。

## 検討した案

- **案1(採用): B案(Workers + D1 + アプリ層認可)**。Cloudflare Workers/D1の無料枠には自動停止がなく、有料化時の最低額($5/月〜)もSupabase Pro($25/月〜)より低い。個人開発で長期運用しやすい。一方、RLSという宣言的な家庭間分離の仕組みを失い、認可をアプリ層の関数呼び出しの徹底とテストだけで担保する必要がある。
- 案2: A案(Workers + Supabase継続)。RLS・Auth・招待受諾等の周辺機能をそのまま使え、実装コストの増加がない。一方、Supabase自体もクラウド(Supabase Cloudなど)へ移行する必要があり、その場合は無料枠の1週間自動停止という制約や、有料化時の最低額($25/月〜)がB案より高くなる。
- 案3: 現状維持(自宅セルフホストのまま)。追加コスト・複雑さが一切ないが、各家庭が自分でDockerを動かし続ける必要があり、YAMORUを家族以外(将来的な共有)へ広げる場合の運用負担が大きい。また常時稼働でないため、外出先からのアクセスなど将来の要件に対応しにくい。

**案1(B案)を採用する。** 個人開発として無料枠での長期運用を最優先する方針(`docs/product/yamoru-project-plan.md`の「配信・運用」)に照らし、コスト面の優位性を重視した。RLSを失うことによる認可実装の負担は、[cloudflare-workers-d1.md](../spikes/cloudflare-workers-d1.md)の「複雑さの比較」で判明した実装パターン(データアクセス層での所属チェック関数+自動テスト)を踏襲することで許容範囲と判断する。

## 決定

- 本番運用基盤として、Cloudflare Workers + D1を採用する。Supabaseの継続利用、自宅セルフホストの継続はいずれも採用しない。
- household間のデータ分離は、household_idを用いる方針自体は維持し(YDR-005から変更しない)、実施手段をSupabase RLSからアプリ層のデータアクセス関数での所属チェックへ置き換える。パターンは[cloudflare-workers-d1.md](../spikes/cloudflare-workers-d1.md)の`lib/d1-spike/authorization.ts`を踏襲する。
  - データアクセス関数は、呼び出しの都度householdIdへの所属チェックを行う。
  - 更新・削除は`WHERE id = ? AND household_id = ?`のように対象householdIdをクエリ側で明示し、他家庭の行を書き換えられないようにする。
  - 上記の規律をコードレビューだけに委ねず、家庭A/B/非メンバー/未認証の境界を自動テスト([cloudflare-workers-d1.md](../spikes/cloudflare-workers-d1.md)の検証マトリクス相当)で担保する。
- 認証方式はAuth.js(next-auth)のCredentialsプロバイダー+JWTセッション戦略を採用する。Adapter(`@auth/d1-adapter`等)は導入しない。
- Next.jsのミドルウェア(セッション更新)は、`proxy.ts`(Next 16新規約)ではなく`middleware.ts`(deprecated旧規約)+`runtime: "experimental-edge"`で実装する。OpenNext for CloudflareがNode.jsミドルウェアを正式サポート(Adapters API)するまでの前提とする。
- Realtimeは作らない。アプリ表示時・フォーカス復帰時・明示的な再読み込みで最新データを取得する(YDR-005から変更しない)。
- 家庭メンバー全員が編集可能とする。Owner/Memberなどの細かな権限区別は引き続き作らない(YDR-005から変更しない)。
- 本Issueでは本番環境への完全移行は行わない。本決定は移行の方針を定めるものであり、実際の移行作業は別issueで行う。

## 本移行の際のおおまかな変更範囲

- `wrangler.jsonc` / `open-next.config.ts`を本番向けに整備する(D1バインディング、キャッシュ戦略等)。
- `proxy.ts`を`middleware.ts`(旧規約)+Edgeランタイムへ置き換える。
- `lib/supabase/*`のデータアクセスコードを、D1向けのデータアクセス層(household・managed_items・todos等、既存の全テーブル)へ置き換える。
- 認証をSupabase Authから、Auth.js Credentials(メール+パスワード)へ置き換える。ログイン画面・新規登録・招待受諾フローを含む。
- `supabase/tests/database/`のpgTAPテストに相当する境界テストを、`@cloudflare/vitest-pool-workers`で全テーブル分再構築する。
- GitHub Actionsのワークフロー(型生成・RLSポリシーカタログ生成等)を、D1のスキーマ・マイグレーション運用に合わせて置き換える。
- Supabase運用を前提とした手順書をD1・Cloudflareベースへ書き換える。
- 既存Supabaseデータ(実際に自宅で使われているデータ)をD1へ移行する設計・手順を別途検討する(本スパイクでは未着手)。

## 結果

- YAMORUの本番運用基盤の方針が、自宅セルフホストからCloudflare Workers + D1へ移行する方向に定まった。
- household間のデータ分離が、宣言的なRLSから、アプリ層の規律+自動テストによる担保へ変わる。
- 認証がSupabase AuthからAuth.js Credentialsへ変わり、メール確認・パスワードリセット等の周辺機能を自前実装する必要が生じる。

## 見直す条件

- OpenNext for Cloudflareが正式にNode.jsミドルウェア(Adapters API)をサポートし、`proxy.ts`(Next.js現行規約)がそのまま使えるようになった場合、`middleware.ts`からの切り戻しを検討する。
- Next.jsが`middleware.ts`(deprecated)規約を完全に廃止した場合、その時点のOpenNextの対応状況を踏まえて代替手段を再検討する。
- アプリ層での家庭間分離の運用で、認可の書き忘れによる実際のインシデントが発生した場合、RLSを持つ構成(Supabase)への回帰を検討する。
- 実際の移行作業に着手する段階で、既存Supabaseデータの移行方式が現実的でないと判明した場合。
