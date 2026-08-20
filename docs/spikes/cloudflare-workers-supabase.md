---
type: Spike Report
title: Cloudflare Workers + Supabase継続の技術スパイク(A案)
description: 既存のSupabase(Auth/RLS)構成を維持したままNext.jsをCloudflare Workersでホストできるかを、実際のログインフローとproxy.ts非互換の回避策(middleware.tsへの切り戻し)まで含めて検証した
tags: [yamoru, spike, cloudflare, workers, supabase]
status: stable
---

# Cloudflare Workers + Supabase継続の技術スパイク(A案)

Issue: [#116](https://github.com/upu/YAMORU/issues/116)
関連: [cloudflare-workers-d1.md](cloudflare-workers-d1.md)(B案: Workers + D1のスパイク。Workersホスティング自体の制約はこちらと共通)、[YDR-005](../decisions/ydr-005-no-realtime-no-fine-grained-permissions.md)(household_idとRLSによる家庭間分離を必須とする決定。A案はこの前提を変更しない)

## 背景

Issue #116は、CloudflareのA案(Workers + Supabase継続)とB案(Workers + D1 + アプリ層認可)を比較対象としている。B案のスパイク([cloudflare-workers-d1.md](cloudflare-workers-d1.md))で、Workersホスティング自体に関わる制約(`proxy.ts`の非互換、`wrangler types`の型衝突、OpenNextのWindows非対応)が判明した。これらはDBをSupabaseのままにするA案にも共通して影響するため、A案固有の検証は主に次の2点に絞られる。

- Supabase Auth(ログイン)・RLS(データアクセス制御)が、Workers上で実際に機能するか
- `proxy.ts`が使えないことの実害が、B案で判明した「認可の穴」以外に無いか(セッション維持の面で問題がないか)

## 検証方法

B案スパイクで追加した`wrangler.jsonc` / `open-next.config.ts`をそのまま使い、既存のYAMORUアプリ(ロジック変更なし)をWorkers向けにビルドした。`proxy.ts`は[cloudflare-workers-d1.md](cloudflare-workers-d1.md)で判明した非互換のため、B案スパイク同様に一時的に取り除いた状態で検証した(恒久的な削除ではない)。

- ローカルSupabase(`environments/test`)を起動し、実際の`NEXT_PUBLIC_SUPABASE_URL` / `PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`を`.env.local`に設定してビルド。
- `wrangler dev`でローカル起動し、Supabase Admin APIでテスト用利用者を1名作成。
- ブラウザ(claude-in-chrome)で実際に`/login`からログインフォームを送信し、ホーム画面・アカウント画面まで遷移できるかを確認。
- `proxy.ts`を外した状態で、未認証のまま保護対象ページ(`/`, `/account`, `/account/invitations`, `/managed-items`, `/todos/new`)へアクセスし、リダイレクトされるかをcurlで確認。
- Supabase Auth API(GoTrue)を直接呼び、`refresh_token_rotation`環境下でのリフレッシュトークンの挙動を検証した(`environments/test/supabase/config.toml`の設定を使用)。
- `proxy.ts`を`middleware.ts`(旧規約)+Edgeランタイムへ置き換える回避策を試し、OpenNextのビルドが通ること、および期限切れに見せかけたセッションCookieを使って保護ページへアクセスした際に、実際にセッションがリフレッシュされ`Set-Cookie`で書き戻されることを確認した。検証後は`proxy.ts`へ戻し、恒久的な変更はしていない。
- 検証後、作成したテスト利用者はSupabase Admin APIで削除した。実データ・実クレデンシャルは`.env.local`(gitignore対象)にのみ置き、コミットしていない。

## 結果

issue #116の検証項目のうち、A案に関わる項目について。Workersホスティング自体に関わる項目は[cloudflare-workers-d1.md](cloudflare-workers-d1.md)の結果と同じ(共通の制約)。

| 検証項目 | 結果 |
|---|---|
| Next.jsをWorkers上で起動できる | B案と同じく**条件付きで可能**。`proxy.ts`のままでは不可だが、`middleware.ts`(旧規約)+Edgeランタイムへ切り戻せば起動できる。DBをD1にするかSupabaseのままにするかは、この制約に影響しない。 |
| ローカル環境で実行できる | 確認済み。実Supabase(ローカル)に接続した状態で`wrangler dev`が正常動作。 |
| 現在使用しているNext.js機能に互換性問題がない | **条件付きで解決**。Server Actions・Supabase Authログイン・RLS経由のデータ取得はWorkers上で動作する。`proxy.ts`のままだとアクセストークン期限切れ(既定1時間)のたびに再ログインを強制される実害を確認したが、`middleware.ts`への切り戻しでこの実害自体が解消することも実証した(後述)。 |
| household単位のアクセス制御を実装・テストする | A案はRLSをそのまま使うため新規実装は不要。既存のRLSスパイク([supabase-rls-household-isolation.md](supabase-rls-household-isolation.md))の検証結果がそのまま適用できる。 |
| 現在のSupabase構成との複雑さを比較する | 実施(後述) |
| 無料枠・将来有料化した場合のコストを比較する | 実施(後述) |

既存の`npm run lint` / `typecheck` / `test` / `build`は、本検証で追加したコード(なし、`.env.local`の値変更のみ)による影響を受けない。

## 実機で確認できたこと

`proxy.ts`を除いた状態で、ブラウザから実際に次の流れを確認した。

1. `/login`にアクセスし、Supabaseに実在する利用者のメールアドレス・パスワードを入力してログインフォーム(`app/login/actions.ts`のServer Action)を送信。
2. ログインに成功し、ホーム画面(`/`)へリダイレクトされ、その利用者に紐づく状態(家庭未作成のため「家庭を作成してください」)が正しく表示された。
3. 続けて`/account`へ遷移しても再ログインを求められず、セッションが維持されたままアカウント情報(登録したメールアドレス)が表示された。

これは、Next.js Server Actions・Supabase Authへの実際のネットワーク呼び出し・RLSで絞り込まれたクエリ・Cookieへのセッション書き込みと読み出しが、**すべてCloudflare Workers(ローカルのwrangler dev環境)上で問題なく機能する**ことを示している。B案で確認した静的な起動確認より一段深い、実際の認証・データアクセスフローの実証になった。

また、B案スパイクの[cloudflare-workers-d1.mdの「判明した制約」](cloudflare-workers-d1.md)で指摘した`proxy.ts`の影響範囲を、この検証で以下のように具体化できた。

- **未認証アクセスのリダイレクトは、`proxy.ts`が無くても機能する。** YAMORUの保護対象ページ(`/`, `/account`, `/account/invitations`, `/managed-items`, `/managed-items/[id]`, `/todos/new`)は、いずれも`requireUser()`(`lib/auth/current-user.ts`)をページ側で個別に呼んでおり、`proxy.ts`の認可チェックと二重の防御になっている。実際に`proxy.ts`を外した状態でこれら全ページへ未認証アクセスしたところ、すべて`/login`へ307リダイレクトされることを確認した。
- **`proxy.ts`だけが担っているのは、Supabaseセッション(アクセストークン)のサイレントリフレッシュ結果をCookieへ書き戻す処理。** ログイン自体はServer Action経由でCookieを書き込めるため`proxy.ts`が無くても成立する(確認済み)。一方、ログイン後にアクセストークンが期限切れになった際の自動更新結果を持続的にCookieへ反映する処理は、`lib/supabase/server.ts`のコメントが明示するとおりServer Componentの中では書き込めず、`proxy.ts`(またはRoute Handler)でしか行えない。この経路が失われた場合の実際の挙動は、Supabase Auth REST API(`/auth/v1/token`)へ直接リクエストして検証した(次項)。

## `proxy.ts`が無い場合、セッションは実際にどう壊れるか

トークンの有効期限(既定1時間)まで待たずに、Auth API(GoTrue)を直接呼んでリフレッシュトークンのローテーション挙動を検証した。`environments/test/supabase/config.toml`の設定は次のとおり。

```
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10  # 秒
```

検証手順と結果:

1. テスト利用者でログインし、初回のrefresh_token(`token1`)を取得。
2. `token1`で`/auth/v1/token?grant_type=refresh_token`を呼び、新しいrefresh_token(`token2`)を取得。**これが「Server Componentがアクセストークン期限切れを検知して自動リフレッシュするが、Cookieへ書き戻せず結果を捨てる」状況の再現。** ブラウザのCookieには古い`token1`が残ったままになる。
3. `token1`を再度使ってリフレッシュ→**成功**(`token2`が返る)。`refresh_token_reuse_interval`は、直前に払い出した結果と同一トークンへ同じ古いトークンで複数回リクエストしても安全に同じ結果を返すための猶予であり、「古いトークンが一定時間使える」という意味ではないことが分かった。
4. `token2`で改めてリフレッシュし、3世代目のrefresh_token(`token3`)を取得(=通常の運用でその後さらに時間が経ち、次のリフレッシュが起きた状態を再現)。
5. この状態で`token1`(2世代前)を使ってリフレッシュを試みると、**`400 refresh_token_already_used`(Invalid Refresh Token: Already Used)で失敗した。**

**結論: `proxy.ts`が無いと、アクセストークンが一度でも期限切れになった後は、ブラウザのCookieに残った(rotate済みの)refresh_tokenが次の別リクエストで使われた時点で確実に失敗し、再ログインを強制される。** これは「まれに起きる不具合」ではなく、YAMORUの既定のトークン有効期限(1時間)が経過するたびに機械的に発生する。

## 回避策: `middleware.ts`(旧規約)への切り戻しで解決することを実証した

OpenNext for Cloudflareのissue([opennextjs-cloudflare#1082](https://github.com/opennextjs/opennextjs-cloudflare/issues/1082))で、メンテナが案内している回避策を試した。要点は次のとおり。

- Next.js 16の新しい`proxy.ts`規約(Node.jsランタイム限定、Edgeへの切り替え不可)は、OpenNextでは今後も(Adapters APIが来るまで)サポートされない。
- 一方、Next.js 16でも**旧`middleware.ts`規約はdeprecatedとして引き続き動作し**、`export const config = { runtime: "experimental-edge" }`を指定すればEdgeランタイムとして扱える。
- OpenNextはEdgeミドルウェアを正式サポートしているため、`middleware.ts`+Edgeランタイムの組み合わせならビルドが通る。

実際に`lib/supabase/proxy.ts`の`updateSession()`をそのまま流用し、ファイルを`proxy.ts`から`middleware.ts`(`export function middleware(...)`、`runtime: "experimental-edge"`)に置き換えたところ、`opennextjs-cloudflare build`が`Bundling middleware function...`まで到達して成功した。

続けて、この構成でセッションリフレッシュが実際に機能するかを検証した。

1. Supabase Auth APIから正規のセッション(access_token・refresh_token)を取得。
2. `expires_at`を過去の時刻に書き換え、期限切れに見せかけたセッションをSupabase SSRのCookie形式(`sb-<ref>-auth-token`、`base64-`+base64url(JSON)化)で自前エンコード。
3. このCookieを付けて`curl`で保護ページ(`/account`)へリクエスト。

結果、**200 OKで認証済みページの内容(登録メールアドレス・ログアウトボタン等)が返り、レスポンスに新しい`Set-Cookie: sb-127-auth-token=...`が含まれていた。** 中身をデコードすると、refresh_tokenが元の値から新しい値へ実際にローテーションされていることを確認した。つまり`middleware.ts`は`proxy.ts`と全く同じCookie書き込みAPI(`NextResponse`)を使っており、機能的に完全な代替になっている。

**この回避策には留保が要る。** `middleware.ts`規約自体と`runtime: "experimental-edge"`はいずれもNext.js側で非推奨(ビルド時に警告が出る)であり、将来のNext.jsバージョンで削除される可能性がある。OpenNext側の恒久対応(Node.jsミドルウェアの正式サポート)は「Adapters API」という別リポジトリで開発中だが、2026年8月時点でも具体的な時期は示されていない。したがって、A案・B案どちらを採用する場合も「当面は`middleware.ts`切り戻しで動く」という前提で進めることになり、Next.jsの将来バージョンで`middleware.ts`が完全に削除された場合の対応(Adapters APIへの乗り換え、または当時のOpenNextの対応状況次第で別の回避策)を継続的にウォッチする必要がある。

## 複雑さの比較(現状 vs A案)

YAMORUは現在、クラウドへのデプロイ実績がなく、各利用者が自分の家でローカルSupabase + `next dev`を動かす運用([ローカルprod環境の利用・運用手順](../references/local-prod-operations.md))になっている。A案は、この構成のうちアプリのホスティング先だけをCloudflare Workersに変える案で、Supabase(Auth/RLS/マイグレーション運用)には一切手を加えない。

| 観点 | 現状(ローカルセルフホスト) | A案(Workers + Supabase) |
|---|---|---|
| 認可・DB層 | 変化なし(RLS) | 変化なし(RLS) |
| 認証 | 変化なし(Supabase Auth) | 変化なし(Supabase Auth) |
| ホスティング | 各利用者の自宅端末 | Cloudflare Workers(共有の常時稼働環境) |
| `proxy.ts`との相性 | 制約なし | `proxy.ts`は非対応だが`middleware.ts`(deprecated)への切り戻しで回避可能(前述) |
| 追加で必要なツール | なし | wrangler, `@opennextjs/cloudflare`(Windows非公式サポート) |
| Supabase自体のホスティング | ローカル(Docker) | 未決定(Supabase Cloudへ移行するか、リモートSupabaseを別途用意するかは本スパイクの範囲外) |

A案はB案と異なり、RLS・認可・Auth周りの実装コストの増加が無い。追加コストは実質的に「Workersへのデプロイ・運用」という、Cloudflareを使う以上どの案でも避けられない部分(`proxy.ts`対応含む)に限定される。ただし、現状はSupabaseもローカル運用のため、A案を採用する場合は**Supabase側もクラウド(Supabase Cloud、またはセルフホスト版のクラウド配置)へ移行する必要があり**、その検証は本スパイクに含まれていない。

## コストの比較

現状はアプリ・DBともに各利用者の自宅端末で動かしており、クラウド利用料は$0。A案でCloudflare Workersへ移行する場合、追加でWorkersの利用料が発生し、Supabase側もクラウド運用に切り替えるならその利用料も発生する(B案スパイクの[コスト比較](cloudflare-workers-d1.md#コストの比較2026年8月時点の公式料金ページに基づく)にCloudflare Workers・Supabaseそれぞれの無料枠・有料枠の数値をまとめてある。A案はD1を使わないため、その表のD1関連行は対象外)。

- Cloudflare Workersの無料枠(100,000リクエスト/日、CPU時間10ms/呼び出し)は、家族数人〜十数人・低頻度アクセスというYAMORUの利用規模であれば十分に収まる見込み。
- Supabaseを無料枠のまま使う場合、1週間操作がないと自動停止する制約は変わらない(B案スパイクで指摘したのと同じ)。

## このスパイクで扱わなかったこと

- `middleware.ts`切り戻し以外の恒久対応(OpenNextのAdapters APIによる正式なNode.jsミドルウェア対応)の検証。本スパイクで確認したのは当面の回避策のみ。
- `middleware.ts`切り戻しをYAMORUの実コードへ本採用する場合の実装(本セッションでは検証後に`proxy.ts`へ戻し、恒久的な変更はしていない)
- Supabase Cloud(またはリモートSupabase)への実際の移行・接続検証。本検証はローカルSupabaseへWorkers経由で接続しただけで、リモートSupabaseとの往復レイテンシ・接続制限等は未検証。
- Cloudflareのリモート環境(実際のWorkers)へのデプロイ
- 最終的な採用判断(Cloudflare Workersを採用するか、Supabaseを継続するか、D1へ移行するか)とそれに伴うYDRの起票。A案・B案双方のスパイク結果が揃った次のステップとして扱う。
