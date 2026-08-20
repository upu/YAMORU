# YAMORU

暮らしの「いつだっけ？」をなくす。

YAMORUは、家族のTodo、家電や契約などの管理対象、定期メンテナンス、実施履歴を一か所で扱う家庭運営アプリです。

## 現在の段階

Phase 1(猫の浄水器ユースケースを一人で端から端まで動かす最小縦切り)が完了しています。[YDR-022](docs/decisions/ydr-022-cloudflare-workers-d1-migration.md)に基づき、家庭・台帳・Todo・履歴・招待発行の保存先はCloudflare D1へ移行済みです。認証と招待受諾はIssue #122でAuth.jsへ置き換えるまでSupabase互換経路を残しています。

- 登録・ログイン・ログアウト
- ニックネームと最初の家庭の作成
- 名前・種類・外部リンクを持つManagedItem(「家の台帳」)の登録・一覧・詳細
- 完了日基準のメンテナンスTodo登録
- 通常完了と、過去日時を指定するバックデート完了
- ActivityLogと次回OccurrenceのD1への原子的な永続化
- ホームとManagedItem詳細での実データ表示
- 自動生成された次回Todoが未変更の場合に限る、直近完了の取消
- iOS SafariとAndroid Chromeからホーム画面へ追加できるオンライン専用PWA
- アプリ層認可による家庭間データ分離、IDOR耐性、冪等性、完了・取消の原子性を実D1で検証するテスト

家族招待、二人以上でのデータ共有、一回限りTodo、固定日基準Todo、延期はPhase 2のスコープです。詳細は[プロダクト計画](docs/product/yamoru-project-plan.md)の該当Phaseを参照してください。

プロジェクトの知識は、OKF v0.2を参考にした[`docs/`](docs/)を正本とします。

## ローカルで起動する

Node.js 24 LTSと[mkcert](https://github.com/FiloSottile/mkcert)を用意し、リポジトリのルートで次のコマンドを実行します。Windowsでは`choco install mkcert`または`scoop install mkcert`でインストールできます。

```powershell
npm install
npm run d1:migrate
npm run dev
```

`npm run dev`は開発用HTTPS証明書を既定にします。初回実行時、`mkcert`がローカルCAをWindowsの証明書ストアへ登録し(初回のみ)、`localhost`・`127.0.0.1`・`::1`向けの証明書を`.certs/dev/`に生成します。証明書と秘密鍵はGit管理対象外です。生成後、ブラウザで[https://localhost:3000](https://localhost:3000)を開きます。

証明書に対応するホストが増える(後述のLAN内アクセス)、または証明書の期限が切れると、次回の`npm run dev`が自動で再生成します。手動で再生成・確認したいだけの場合は`npm run dev:cert`を使います。

HTTPでの起動が必要な場合は、明示的なフォールバックとして`npm run dev:http`を使用します。既定の`npm run dev`とは別のコマンドとして区別しています。

lint、型チェック、テスト、プロダクションビルドは次のコマンドで確認できます。

```powershell
npm run lint
npm run lint:fix
npm run typecheck
npm test
npm run test:d1
npm run build
```

Pull Requestと`main`へのpushでは、GitHub Actionsの`Quality checks`に加えて、空のローカルD1へのマイグレーション適用と家庭間分離・原子性テストを自動で確認します。

## 移行期間中のローカルSupabase(Auth・招待受諾のみ)

以下はIssue #122が完了するまでの認証互換環境です。家庭・台帳・Todo・履歴・招待発行のアプリデータはSupabase PostgreSQLではなくローカルD1へ保存されます。Supabaseの旧マイグレーション、型、RLSカタログ、DBテストは現在のD1スキーマの正本ではありません。D1変更時は[データベースに影響する変更の手順](docs/references/database-change-playbook.md)に従ってください。

ローカルのSupabaseは、移行期間中のAuth・招待受諾を手動確認する`prod`環境と、その互換テスト専用の`test`環境に物理的に分離しています。project ID・ポート・Dockerボリュームは独立しており、`test`側の初期化操作が`prod`へ影響することはありません。

| 環境 | 用途 | project ID | reset | API | Studio |
|---|---|---|---|---|---|
| `prod` | 移行期間中のSupabase Auth手動確認 | `YAMORU-prod-local` | 用意していません | http://127.0.0.1:55321 | http://127.0.0.1:55323 |
| `test` | Auth・招待受諾の互換テスト。架空fixtureのみ | `YAMORU-test` | `npm run test:db:reset` | http://127.0.0.1:58321 | http://127.0.0.1:58323 |

ローカルの`prod`は外部に公開できる本番基盤ではありません。Cloudflareへの本番デプロイと既存実データ移行はIssue #123で扱います。

事前に[Docker Desktop](https://www.docker.com/products/docker-desktop/)を起動します。Supabase CLIは`devDependencies`に固定バージョンで含まれているため、追加インストールは不要です。

- Supabase CLIはデフォルトで匿名の利用統計テレメトリを送信します。無効化する場合は、コマンド実行前に`SUPABASE_TELEMETRY_DISABLED=1`を設定します。
- Realtime、Storage、Edge Functionsなど、現在の対象外の機能は`prod`・`test`両方の`config.toml`で無効化しています。メール・パスワード認証は有効で、ローカル確認ではメール確認を要求しません。

### prod: 実データで手動確認する

初回セットアップ、普段の起動、`git pull`後に新しいマイグレーションがあるかどうかの確認、バックアップ・復旧は[ローカルprod環境の利用・運用手順](docs/references/local-prod-operations.md)にまとめています。`npm run dev`(通常の開発サーバー)は常にこの`prod`環境へ接続します。

`prod`にはfixtureを投入する仕組み自体がありません。`supabase/seed.sql`はこのワークディレクトリへ複製されず、`[db.seed] enabled = false`です。同じ理由で、`prod`を対象とするresetコマンドも意図的に用意していません。

`localhost`以外のホスト名やIPアドレスで開発サーバーを開く場合は、起動マシンのIPv4アドレスを`.env.local`の`YAMORU_ALLOWED_DEV_ORIGINS`へ設定します。これはスマートフォン専用ではなく、同じWi-Fi上のタブレットや別のPCなどから接続する場合も同じです。たとえば起動マシンのアドレスが`192.168.1.10`なら、`YAMORU_ALLOWED_DEV_ORIGINS=192.168.1.10`とし、別端末で`https://192.168.1.10:3000`を開きます。複数指定する場合はカンマで区切ります。同じ値がHTTPS開発証明書の対象ホストにもなるため、変更後は開発サーバーを再起動してください(`npm run dev`が証明書を自動で再生成します)。DHCPで起動マシンのIPアドレスが変わった場合も同様に再設定・再起動が必要です。

`YAMORU_ALLOWED_DEV_ORIGINS`はNext.jsの開発サーバーだけで使う設定であり、本番環境には設定しません。本番の`NEXT_PUBLIC_SUPABASE_URL`にはグローバルIPアドレスではなく、SupabaseプロジェクトのConnect画面に表示される`https://<project-ref>.supabase.co`形式のProject URLを設定します。Supabaseをセルフホストする場合も、ブラウザから到達できるHTTPSのドメイン名を使用します。

#### iPhoneなど別端末でローカルCAを信頼する

LAN内の別端末では、`mkcert`が発行したローカルCAをその端末が信頼するまで証明書の警告が出ます。Windows機からiPhoneへはAirDropが使えないため、次の手順でCAを転送します。

1. 開発マシンで`npm run dev:cert`を実行し、出力される「ローカルCAの場所」から`rootCA.pem`のパスを確認します(通常`mkcert -CAROOT`が示すフォルダー配下)。
2. `rootCA.pem`を、メール添付やiCloud Drive・OneDriveなど、開発マシンとiPhoneの両方からアクセスできる方法でiPhoneへ転送します。
3. iPhoneで`rootCA.pem`を開き、画面の指示に従って構成プロファイルをダウンロード・インストールします(設定 > 一般 > VPNとデバイス管理)。
4. 設定 > 一般 > 情報 > 証明書信頼設定を開き、インストールした`mkcert`のルート証明書を「完全に信頼」に切り替えます。

この手順は端末ごとに1回だけ必要です。ローカルCA自体はGit管理対象外で、開発マシンの外(mkcertのCAROOT)にのみ存在します。

続けてアプリを起動します。

```powershell
npm run dev
```

1. [https://127.0.0.1:3000](https://127.0.0.1:3000)を開くと、未認証時はログイン画面へ移動します。
2. 実際に使うメールアドレスと、6文字以上のパスワードで新規登録します(`prod`は実データ用のため、架空アドレスにこだわる必要はありません)。
3. ホーム画面が表示され、再読み込み後もログイン状態が維持されることを確認します。
4. 「アカウント」を開きます。ニックネーム未登録の場合はニックネームを入力して「ニックネームを登録」を選びます。続けて家庭名(既定値は登録したニックネームに「の家庭」を付けた値)を確認・入力し、「家庭を作成」を選びます。
5. 作成した家庭名が表示され、作成フォームが表示されなくなることを確認します。再読み込み後も同じ家庭名が表示されます。
6. 「ログアウト」を選びます。ホーム画面を再度開くとログイン画面へ移動します。
7. 登録時と同じ値でログインし、アカウント画面に同じ家庭名が表示されることを確認します。

### PWAとしてホーム画面に追加する

YAMORUのPWAはオンライン利用専用です。Service Workerを使用せず、認証済みHTML、Supabaseの応答、家庭データをオフライン用に永続キャッシュしません。オフライン編集・同期とPush通知には対応していません。

事前に、上記のローカルSupabase、`.env.local`、`YAMORU_ALLOWED_DEV_ORIGINS`、端末でのローカルCA信頼を設定し、開発マシンとスマートフォンを同じLANへ接続します。開発マシンで`npm run dev`を起動し、スマートフォンのブラウザから`https://<YAMORU_ALLOWED_DEV_ORIGINSに設定したホスト>:3000`を証明書警告なしで開いてください。

#### iOS Safari

1. Safariの共有ボタンを選び、「ホーム画面に追加」を選びます。
2. 「Webアプリとして開く」をオンにし、名前が「YAMORU」、画像がヤモリアイコンであることを確認します。
3. 「追加」を選び、Safariを閉じてホーム画面のYAMORUアイコンから起動します。

すでにホーム画面へ追加済みでアイコンが更新された場合は、開発サーバーを再起動し、既存のYAMORUアイコンを削除してからSafariで追加し直します。

アイコンはNext.jsのファイルベースMetadata規約に従い、一般用を`app/icon.png`、iOS用を`app/apple-icon.png`、manifestを`app/manifest.ts`から配信します。`app/icon.png`は`.png`に対応した正式な一般アイコン規約であるため、別途`app/favicon.ico`を必須とはしません。ローカルCAを完全に信頼したiPhoneでも、画像URLを直接開ける一方でホーム追加画面だけが「Y」のモノグラムになる場合は、コードと画像の最終確認を公開CAの証明書を使うHTTPS環境で行います。

#### Android Chrome

1. Chromeのメニューを開き、「アプリをインストール」または「ホーム画面に追加」を選びます。
2. 表示される案内で「インストール」を選びます。
3. Chromeを閉じ、ホーム画面またはアプリ一覧のYAMORUアイコンから起動します。

#### OK条件

- ホーム画面にYAMORUのヤモリアイコンと名前が表示される。
- アイコンから起動するとブラウザのアドレスバーや操作バーがない独立表示になり、未ログイン時はログイン画面、ログイン済みならホームが表示される。
- ログアウトすると、スマートフォンで開いているものと同じホストのログイン画面へ移動する。
- ホームの「アカウント」から「家族を招待する」を開くと、家族招待画面を利用できる。
- ホームの「家の台帳」から登録済みの管理対象を選ぶと、ManagedItem詳細を利用できる。
- 機内モードにするか開発サーバーを停止して再度開くと接続できず、以前表示した家庭データをオフライン用画面として利用できない。オンラインへ戻して再読み込みすると通常表示へ戻る。

iOSとAndroidのどちらかでメニューが表示されない、独立表示にならない、主要導線を利用できない場合は、端末名、OSとブラウザのバージョン、開いたURL、発生した画面を記録してfollow-up issueを起票します。

登録・ログイン・ログアウトは、いずれもServer ActionsまたはRoute Handler経由でNext.jsサーバーからローカルSupabaseへ接続します。ブラウザから`NEXT_PUBLIC_SUPABASE_URL`(HTTP)へ直接接続する経路は現状使用していないため、HTTPS化によるMixed Contentは発生しません。将来ブラウザー用Supabaseクライアントを直接使う場合は、ローカルSupabase APIもLAN内で到達可能なHTTPSにするか、接続をサーバー経由に限定するかを設計時に決め、ブラウザーコンソールにMixed Contentエラーがないことを確認してください。

続けて、猫の浄水器ユースケースを端から端まで確認します。

8. ホーム画面上部の「家の台帳」を開き、名前(例: 「猫の浄水器」)、種類、商品ページまたは説明書への外部リンク(任意)を入力して「管理対象を登録」を選びます。登録した名前が一覧に表示されます。
9. 登録した管理対象を開き、「メンテナンスTodoを登録」でTodo名(例: 「フィルター交換」)、次回の目安の期間(例: 最短1〜最長2週間後)、初回の基準日を入力して登録します。「現在のTodo」に表示されることを確認します。
10. 「やったよ」を選び、「今、自分がやった」で完了します。「直近の完了」に完了日が記録され、「現在のTodo」に次回の目安が表示されることを確認します。
11. 画面を再読み込み、またはログアウトしてから再ログインしても、登録した管理対象・メンテナンスTodo・完了記録が失われずに表示されることを確認します。
12. 「直近の完了」で「取り消す」を選び、確認ダイアログの内容(取り消すと未完了のTodoに戻り、自動生成された次回の予定が削除されること)を確認したうえで「この完了を取り消す」を選びます。対象のTodoが「現在のTodo」へ戻り、「直近の完了」から消えることを確認します。
13. 再び「やったよ」→「詳しく記録する」を選び、今日より前の実施日を指定して完了できることを確認します(バックデート完了)。指定した日付で「直近の完了」に記録されることを確認します。

### test: 自動テストで使う

D1の家庭間分離・IDOR・原子性はSupabaseを起動せずに確認できます。

```powershell
npm run d1:migrate
npm run test:d1
```

下記のSupabase `test`環境は、Issue #122で置き換えるAuthと招待受諾の互換テストだけに使います。`prod`のURLやキーは使いません。

```powershell
npm run test:start      # test環境を起動(初回はDockerイメージ取得で時間がかかります)
npm run test:db:reset   # マイグレーションとseed.sqlを最初から再適用。いつ実行してもprodへ影響しません
npm run test:db         # 移行中の招待受諾pgTAPテストを実行
npm run test:auth:local # Supabase Auth互換経路を自動確認
npm run test:e2e:install # 初回だけ、E2E用のChromiumをインストール
npm run test:e2e:local   # 二アカウント共有と家庭間分離をPlaywrightで確認
npm run test:stop       # test環境を停止
```

- `test:db:reset`・`test:db`は、実行前に接続先の`project_id`が`YAMORU-test`であることを検証し、一致しない場合は破壊的操作を開始せずに停止します(`scripts/supabase-destructive-guard.ts`)。
- `test:e2e:local`は#122のAuth.js移行に合わせてD1対応を完了するまで、旧Supabaseデータ経路を前提とした互換テストです。
- `supabase/seed.sql`が投入するのは、ローカル専用の架空データ(家庭A・家庭B、テスト用ユーザー、テスト用管理対象)だけです。家庭の実データは含めません。
- `test:auth:local`は毎回、`example.test`の一意な架空利用者を作成します。手動起動用の`.env.local`はGit管理対象外です。パスワード、アクセストークン、Service Roleキー、実在するメールアドレスはコミットしません。公開可能なキーも環境変数から読み、ブラウザへService Role権限を渡しません。認証済みであっても、家庭への所属が確認できるまでは家庭データへアクセス可能とは扱いません。

### 旧Supabaseスキーマの履歴資料(移行互換用)

現在のアプリデータ仕様の正本は`d1/migrations/`です。以下の型生成は、Issue #122まで残るSupabase Auth・招待受諾互換経路を保守するときだけ使用します。

```powershell
npm run gen:types       # マイグレーションから型を再生成する
npm run gen:types:check # コミット済みの型がマイグレーションと一致するか検証する(CIでも実行)
```

- 生成には使い捨てのSupabaseスタック(`environments/gen-types`、`prod`・`test`とは別のproject ID・ポート)を毎回起動し、`supabase/migrations/`だけを適用します。稼働中の`prod`・`test`から生成しないのは、それらに未コミットのマイグレーションが適用されていたり手動操作でずれていたりする可能性があり、「コミット済みマイグレーションだけから再現できる」という前提が崩れるためです。実行後、使い捨てスタックはデータ量ごと破棄されます。
- Supabase互換経路のマイグレーションを追加した場合だけ`npm run gen:types`を実行します。D1のCIは`npm run d1:migrate`と`npm run test:d1`を使用します。
- `lib/supabase/database.types.ts`は生成物です。手で編集せず、スキーマ側を直してから再生成してください。
- アプリの`createClient()`はこの型を適用済みです。`.from()`・`.rpc()`のテーブル名・カラム名・引数の誤りは`npm run typecheck`で検出されます。

### 旧RLSポリシー一覧(履歴資料)

`docs/references/rls-policy-catalog.md`はD1移行前の構成を確認する履歴資料です。現在の家庭間分離は`lib/d1/`と実D1テストで担保します。

```powershell
npm run gen:policies       # マイグレーションからカタログを再生成する
npm run gen:policies:check # コミット済みのカタログがマイグレーションと一致するか検証する(CIでも実行)
```

- 型生成と同じ使い捨てスタック方式で生成します。理由も同じです(稼働中の`prod`・`test`から生成すると、「コミット済みマイグレーションだけから再現できる」という前提が崩れるため)。
- `comment on policy`が付いていないポリシーが1件でもあれば、内容のズレとは別の理由で失敗します。RLSポリシーを追加・変更するマイグレーションでは、`comment on policy ... is '...'`で意図をDBコメントとして残してください。
- `docs/references/rls-policy-catalog.md`は生成物です。手で編集せず、マイグレーション側を直してから再生成してください。

## 文書の入口

- [知識バンドル](docs/index.md)
- [プロダクト計画](docs/product/yamoru-project-plan.md)
- [意思決定](docs/decisions/index.md)
- [ローカルprod環境の利用・運用手順](docs/references/local-prod-operations.md)
- [データベースに影響する変更の手順](docs/references/database-change-playbook.md)
- [レビュー依頼プロンプト](docs/references/review-prompts.md)
- [プロジェクトガイド](AGENTS.md)

## ライセンス

このリポジトリには、一般的な利用を許諾するライセンスを付与していません。利用を希望する場合の連絡方法を含む詳細は、[LICENSE](LICENSE)を確認してください。

## 公開時の注意

このリポジトリには、家庭の実データ、非公開のGoogle Driveリンク、認証情報、APIキーを保存しません。
