---
type: Spike Report
title: Cloudflare Workers + D1移行可否の技術スパイク(B案)
description: 既存のSupabase構成をCloudflare Workers + D1 + アプリ層認可(B案)へ移行できるかを、実際にYAMORUのNext.jsアプリを改造して検証した
tags: [yamoru, spike, cloudflare, workers, d1, authorization]
status: stable
---

# Cloudflare Workers + D1移行可否の技術スパイク(B案)

Issue: [#116](https://github.com/upu/YAMORU/issues/116)
関連: [YDR-005](../decisions/ydr-005-no-realtime-no-fine-grained-permissions.md)(household_idとRLSによる家庭間分離を必須とする決定。本スパイクはこの前提を置き換える場合の実現可能性を検証するもので、YDR-005自体を変更する決定ではない)

## 背景

YAMORUは個人開発の家庭内タスク管理アプリで、現在はSupabase(PostgreSQL + Auth + RLS)を基盤にNext.js(App Router)で実装している。Issue #116は、本番運用基盤としてCloudflareを中心とした構成へ移行できるかを検証するSpikeで、以下2案を比較する対象としている。

- A案: Cloudflare Workers + Supabase継続(Auth/RLSはそのまま)
- B案: Cloudflare Workers + D1 + アプリ層認可(RLSを持たない)

本スパイクはB案を優先して検証した。A案の実機検証は[cloudflare-workers-supabase.md](cloudflare-workers-supabase.md)を参照。最終的な採用判断(YDR起票)は次のステップとして扱う。

## 検証方法

既存のYAMORUアプリ(`app/`, `lib/supabase/*`)にはロジック変更を加えず、Cloudflare Workers/D1関連の設定・コードを追加する形で検証した。

- `wrangler.jsonc` / `open-next.config.ts`を追加し、`@opennextjs/cloudflare`(1.20.2)経由で既存アプリをビルドし、`wrangler dev`(wrangler 4.124.0)でローカル起動を確認。
- D1(ローカル)に、既存のRLSスパイク([supabase-rls-household-isolation.md](supabase-rls-household-isolation.md))と対になる最小スキーマ(`d1/migrations/0001_init_household_spike.sql`: households / household_members / managed_items / users)を作成し、`wrangler d1 migrations apply DB --local`と`wrangler d1 execute --local`でマイグレーション運用とCRUDを確認。
- household単位のアクセス制御を、RLSではなくアプリ層の関数(`lib/d1-spike/authorization.ts`)として実装。RLSスパイクと同じ検証マトリクス(家庭Aメンバーは家庭Aを読み書きできる/家庭Bを読み書きできない、非メンバー・未認証は読み書きできない、他家庭のid×自家庭のhouseholdIdという組み合わせは0件処理になる)を、`@cloudflare/vitest-pool-workers`(0.22.0)で実際のWorkersランタイム(Miniflare/workerd)上のD1に対してテストした(`lib/d1-spike/authorization.spike.test.ts`、`npm run spike:cf:d1:test`)。
- 認証方式の候補としてAuth.js(`next-auth` 5.0.0-beta.32)のCredentialsプロバイダーを検証し、D1の`users`テーブルへ直接問い合わせる`authorize()`を実装(`lib/d1-spike/auth.ts`、`lib/d1-spike/users.ts`、`lib/d1-spike/password.ts`)。ルートハンドラ(`app/api/spike-d1-auth/[...nextauth]/route.ts`)を追加し、既存アプリのWorkersビルドに組み込めるかを確認。既存のSupabase Authログイン(`app/login`)には触れていない。
- 複雑さの比較は、上記の実装を実際に手を動かした過程で判明した差分に基づく。
- コストの比較は、2026年8月時点のCloudflare公式料金ページ・Supabase公式料金ページの数値に基づく。

実装は`wrangler.jsonc`、`open-next.config.ts`、`d1/migrations/`、`lib/d1-spike/`、`app/api/spike-d1-auth/`、`vitest.d1-spike.config.ts`を参照。

## 結果

issue #116の検証項目のうち、B案に関わる項目について。

| 検証項目 | 結果 |
|---|---|
| Next.jsをWorkers上で起動できる | **条件付きで可能**。`proxy.ts`(Next 16の新ミドルウェア規約)のままでは不可だが、旧`middleware.ts`規約+Edgeランタイムへ切り戻せば起動できることを実証した(後述)。 |
| ローカル環境で実行できる | 確認済み(`wrangler dev`。`/login`・`/icon.png`・`/manifest.webmanifest`のSSR/静的配信をcurlで確認) |
| 現在使用しているNext.js機能に互換性問題がない | **条件付き**。`proxy.ts`(Next 16のミドルウェア、Supabaseセッション更新に使用)はOpenNext for CloudflareでNode.jsランタイムミドルウェアとして扱われ、ビルド時にエラーになる。ただし`middleware.ts`(旧規約、deprecated)+`runtime: "experimental-edge"`へ切り戻せば回避できることを実証した(後述)。 |
| D1のローカル開発を確認する | 確認済み(`wrangler d1 migrations apply DB --local`) |
| 基本的なCRUDをD1で実装する | 確認済み(CLI経由のINSERT/UPDATE/DELETE/SELECTに加え、アプリコード`lib/d1-spike/authorization.ts`としても実装) |
| 認証方式を検討する | Auth.js(Credentialsプロバイダー+JWTセッション戦略)で実装可能。Adapterは不要(OAuth/DBセッション戦略の場合のみ必要)。ただしAuth.js v5は本検証時点でもbeta(5.0.0-beta.32)。 |
| household単位のアクセス制御を実装・テストする | 確認済み。アプリ層関数+実D1上の自動テスト14件が全てグリーン。 |
| 現在のSupabase構成との複雑さを比較する | 実施(後述) |
| 無料枠・将来有料化した場合のコストを比較する | 実施(後述) |

既存の`npm run lint` / `typecheck` / `test` / `build`は、本スパイクの追加後も引き続き成功する(確認済み)。

## 判明した制約・後続実装への注意点

- **`proxy.ts`(Next.js 16のミドルウェア)はOpenNext for Cloudflareで動かないが、旧`middleware.ts`規約への切り戻しで回避できる。** Next.js 16は`proxy.ts`を既定でNode.jsランタイムで実行するが、`@opennextjs/cloudflare`(1.20.2時点)はNode.jsランタイムのミドルウェアを検出すると`ERROR Node.js middleware is not currently supported. Consider switching to Edge Middleware.`でビルドを止める。`export const config = { runtime: "edge" }`をproxy.tsに指定してEdge化しようとしても、Next.js自身が`Proxy does not support Edge runtime.`で拒否する。**この制約はOpenNext側で意図的なもので、Node.jsミドルウェアは「Adapters API」という別リポジトリでの対応を待つ必要があり、現時点(2026年8月)でも時期未定**([opennextjs-cloudflare#1082](https://github.com/opennextjs/opennextjs-cloudflare/issues/1082)、OpenNext開発者のコメント参照)。ただし同issueで案内されている回避策どおり、同じ`updateSession()`ロジックを、ファイル名を`proxy.ts`から**`middleware.ts`(deprecatedな旧規約)に戻し**、`export const config = { runtime: "experimental-edge", ... }`を指定するだけで、OpenNextのビルドが成功することを確認した(`Bundling middleware function...`のステップまで到達し、Node.jsミドルウェア扱いのエラーが出ない)。
- **上記の`middleware.ts`切り戻しで、セッションリフレッシュのCookie書き戻しも実際に機能することを実証した。** わざと期限切れに見せかけたSupabaseセッションCookieを持たせて保護ページへアクセスしたところ、`middleware.ts`が正しくリフレッシュトークンをローテーションし、新しいセッションを`Set-Cookie`でブラウザへ書き戻したうえで、認証済みページの内容を200 OKで返した(詳細は[cloudflare-workers-supabase.md](cloudflare-workers-supabase.md))。つまり`middleware.ts`は`proxy.ts`と全く同じCookie API(`NextResponse`)を使っているため、機能的な代替として成立する。
- **ただしこの回避策はdeprecatedな規約に依存しており、恒久的な解決ではない。** `middleware.ts`規約自体がNext.js側で非推奨(ビルド時に警告、将来のバージョンで削除される可能性がある)で、`runtime: "experimental-edge"`も同様に非推奨警告が出る。OpenNext側の正式なNode.jsミドルウェア対応(Adapters API)が来るまでの「今は動く」回避策と位置づけるべきで、YAMORUが本移行する場合はどちらの方針を取るか(deprecated規約に依存し続けるか、Adapters APIのリリースを待つか)を判断する必要がある。
- **`npx wrangler types`が生成する型が、既存アプリのDOM lib型と衝突する。** Cloudflare Workersのバインディング型(`D1Database`等)を得るために`wrangler types`を実行すると、Workersランタイム全体の型が`worker-configuration.d.ts`にグローバル展開される。この中の型定義がDOM libの`Element`/`HTMLElement`等と衝突し、既存のjsdomベースのコンポーネントテスト(`tests/complete-todo-panel.test.tsx`)の`npm run typecheck`を壊すことを確認した。本スパイクでは`wrangler types`を使わず、実際に使う分だけの最小限の型(`lib/d1-spike/cloudflare-types.d.ts`)を手書きして回避した。1つのNext.jsプロジェクト内にブラウザ向けコードとWorkersランタイム向けコードを同居させる場合、型システムの分離に継続的なコストがかかる。
- **Workersランタイム専用のテストファイルを、既存のtsc型検査・vitest実行から分離する必要がある。** `@cloudflare/vitest-pool-workers`が提供する`"cloudflare:workers"`のようなWorkers組み込みモジュールの型は、本プロジェクトの`tsconfig.json`(`moduleResolution: "bundler"`)の下では、手書きのambientモジュール宣言(`declare module "cloudflare:workers" {...}`)を用意しても解決できなかった(原因未特定)。そのため`lib/d1-spike/**/*.spike.test.ts`を`tsconfig.json`の`exclude`とESLintの型検査対象(`disableTypeChecked`)の両方から除外し、専用の`vitest.d1-spike.config.ts`(`npm run spike:cf:d1:test`)でのみ実行・検証する構成にした。
- **`D1Database#exec()`は複数行・コメント入りのSQLをそのまま実行できない。** `-- コメント`や空行を含むマイグレーションSQLをそのまま`db.exec(sql)`に渡すと`D1_EXEC_ERROR: SQL code did not contain a statement`で失敗する。`wrangler d1 migrations apply`(CLIのマイグレーション適用)は内部でこれを吸収するが、テストコード側で直接スキーマを流し込む場合は、コメント除去とステートメント分割を自前で行い、`db.batch(...)`で適用する必要がある。
- **`@cloudflare/vitest-pool-workers`のAPIは本検証時点でも変化が大きい。** 一般に知られる`defineWorkersConfig`ではなく、`cloudflareTest()`というVite pluginを`vitest.config.ts`の`plugins`に渡す形式(0.22.0時点)だった。ドキュメントより先にpackageの型定義を読んで実際のAPI形状を確認する必要があり、bleeding edgeなツールであることを踏まえておく。
- **Credentialsプロバイダー+JWTセッション戦略では、Auth.jsのAdapter(`@auth/d1-adapter`)が不要。** Adapterが必要になるのはOAuthプロバイダーやDBセッション戦略を使う場合のみで、メール+パスワードのCredentials認証だけならアプリ側でD1へ直接問い合わせる実装で完結する。ただしメール確認・パスワードリセット等の周辺機能は自前実装が必要になる(このスパイクでは未検証)。
- **RLSの制約はアプリ層に「移動」するだけで、消えるわけではない。** `lib/d1-spike/authorization.ts`の各関数は、呼び出しの都度`requireHouseholdMembership()`を呼び忘れると認可チェックが素通りする。また`UPDATE ... WHERE id = ? AND household_id = ?`のように、対象householdIdの条件をクエリ側で明示し忘れると、id を知っている限り他家庭の行を書き換えられてしまう(RLSスパイクで指摘した「`WITH CHECK`が必須」という注意点と同型の問題が、DB層ではなくアプリ層の規律の問題として再出現する)。この規律を守れているかどうかは、RLSのようにDB側で一元的に強制する手段がなく、コードレビューとテストでしか担保できない。
- **OpenNextは公式にWindowsを完全サポートしていない。** ビルド時に`WARN OpenNext is not fully compatible with Windows.`が出続ける。個人開発者がWindows環境で日常的にWorkers向けビルドを行う場合、公式には推奨されない構成での運用になる。

## 複雑さの比較(Supabase RLS vs D1+アプリ層認可)

| 観点 | Supabase(RLS) | Cloudflare D1(アプリ層認可) |
|---|---|---|
| 認可の強制場所 | DBのポリシーとして1回定義すれば、以降の全クエリ経路に自動的に効く | データアクセス関数ごとに呼び出しを徹底する必要があり、書き忘れが素通りする |
| 認可の検証方法 | pgTAPでポリシーそのものを宣言的に検証できる | アプリコードの単体テストで、呼び出し漏れがないことを愚直に確認するしかない |
| 型システムの独立性 | Node.js/ブラウザ向けTypeScript構成のみで完結 | Workersランタイム向けの型とDOM libの型が衝突するため、tsconfig・ESLint設定・テスト実行系列を分離する必要がある |
| ローカル開発ツールの成熟度 | Supabase CLIは既存プロジェクトで長期運用実績あり | wrangler/OpenNext/vitest-pool-workersはいずれも本検証時点でAPIや挙動の変化が大きく、Windows対応も限定的 |
| Next.jsミドルウェアとの相性 | 制約なし(現行構成で稼働中) | Next 16の`proxy.ts`はOpenNextで動かないが、deprecatedな`middleware.ts`規約への切り戻しで回避可能(恒久対応はOpenNext側のAdapters API待ち) |
| 認証まわりの周辺機能 | Supabase Authがメール確認・パスワードリセット等を提供済み | Auth.js Credentialsを使う場合、これらを自前実装する必要がある |

総じて、B案(D1+アプリ層認可)は「RLSを持たない」ことによる実装・運用コストが、DBのポリシー1つを書くこととは比較にならないほど大きい。Next.js 16 + OpenNext for Cloudflareの`proxy.ts`非互換は、deprecatedな`middleware.ts`規約への切り戻しで当面回避できることを確認したが、これはA案にも共通する制約でありB案固有の弱みではない。

## コストの比較(2026年8月時点の公式料金ページに基づく)

### Cloudflare Workers + D1

| | 無料枠 | 有料枠(Workers Paid: $5/月〜) |
|---|---|---|
| Workersリクエスト | 100,000/日 | 月1,000万リクエスト込み、以降$0.30/百万リクエスト |
| Workers CPU時間 | 10ms/呼び出し | 月3,000万CPUミリ秒込み、以降$0.02/百万CPUミリ秒 |
| D1読み込み | 500万行/日 | 月250億行込み、以降$0.001/百万行 |
| D1書き込み | 10万行/日 | 月5,000万行込み、以降$1.00/百万行 |
| D1ストレージ | 5GB(合計) | 5GB込み、以降$0.75/GB・月 |
| 休止(pause) | なし(常時稼働) | なし |

### Supabase

| | 無料枠(Free) | 有料枠(Pro: $25/月〜) |
|---|---|---|
| プロジェクト数 | 2 | 無制限(追加費用あり) |
| データベース容量 | 500MB | 8GB込み、以降$0.125/GB |
| Auth利用者数(MAU) | 50,000 | 100,000込み、以降$0.00325/MAU |
| Egress(帯域) | 5GB | 250GB込み、以降$0.09/GB |
| 休止(pause) | **1週間操作がないと自動停止** | なし |

家族数人〜十数人・低頻度アクセスというYAMORUの利用規模では、無料枠の容量・リクエスト数自体はどちらも十分に余裕がある。差が出るのは次の2点。

- **休止の有無**: Supabase Freeは1週間操作がないと自動停止し、再開に手動操作が要る。個人開発で使用頻度に波がある運用とは相性が悪い。Cloudflare Workers/D1の無料枠には休止の概念がない。
- **有料化時の最低額**: 無料枠を超えて有料化が必要になった場合、Cloudflareは$5/月から、Supabaseは$25/月から。

コストだけを見ればCloudflare Workers + D1に分があるが、「判明した制約」「複雑さの比較」で述べた実装・運用コスト(特にRLS代替の負担)を踏まえずに判断すべきではない。

## このスパイクで扱わなかったこと

Issueのスコープ外、または本セッションの範囲外として、以下は未検証。

- A案(Cloudflare Workers + Supabase継続)の実機検証(別途[cloudflare-workers-supabase.md](cloudflare-workers-supabase.md)で実施)
- 最終的な採用判断(Cloudflare Workersを採用するか、Supabaseを継続するか、D1へ移行するか、採用するAuth方式、本移行時の変更範囲)とそれに伴うYDRの起票
- Cloudflareのリモート環境(実際のWorkers/D1)へのデプロイ。本スパイクはローカル検証のみ。
- `middleware.ts`切り戻し以外の恒久対応(OpenNextのAdapters APIによる正式なNode.jsミドルウェア対応)の検証。本スパイクで確認したのは当面の回避策のみ。
- Auth.jsでのメール確認・パスワードリセット・アカウント復旧等の周辺機能
- household作成・招待受諾等のライフサイクル全体(今回はmanaged_itemsの読み書きに絞った最小スキーマのみ)
- ログイン画面等のUI実装(APIハンドラとデータアクセス層のみを検証した)
- 本番データ・本番環境への適用(issueの制約により対象外)
