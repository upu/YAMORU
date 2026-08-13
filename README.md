# YAMORU

暮らしの「いつだっけ？」をなくす。

YAMORUは、家族のTodo、家電や契約などの管理対象、定期メンテナンス、実施履歴を一か所で扱う家庭運営アプリです。

## 現在の段階

プロダクト定義と意思決定をもとに、固定サンプルデータを使ったホーム画面、管理対象の詳細、Todo完了フローを確認できます。ローカルSupabaseへ接続した登録・ログイン・ログアウトと、最初の家庭作成も確認できます。これらの画面は固定サンプルデータで動作し、家庭の実データは使用しません。開発者本人がローカルの`prod`環境へ任意で実データを永続化できますが、これはこのリポジトリのコミット対象にはなりません(詳細は[ローカルSupabase(prod・test環境)](#ローカルsupabaseprodtest環境)を参照)。

Todoの完了結果は、画面間で共有するブラウザ内の一時状態です。再読み込みすると固定サンプルデータへ戻り、保存はされません。

プロジェクトの知識は、OKF v0.2を参考にした[`docs/`](docs/)を正本とします。

## ローカルで起動する

Node.js 24 LTSと[mkcert](https://github.com/FiloSottile/mkcert)を用意し、リポジトリのルートで次のコマンドを実行します。Windowsでは`choco install mkcert`または`scoop install mkcert`でインストールできます。

```powershell
npm install
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
npm run build
```

Pull Requestと`main`へのpushでは、GitHub Actionsの`Quality checks`が同じlint、型チェック、テスト、プロダクションビルドを自動で確認します。

## ローカルSupabase(prod・test環境)

ローカルのSupabaseは、実データを保存する`prod`環境と、自動テスト専用の`test`環境に物理的に分離しています。project ID・ポート・Dockerボリュームがそれぞれ独立しているため、`test`側の初期化操作が`prod`のデータへ影響することはありません。マイグレーション・seed・pgTAPテストの正本は`supabase/`配下の1か所だけで管理し、各環境のワークディレクトリへは`npm run prod:start`や`npm run test:start`などの実行時に`scripts/supabase-env-sync.ts`が自動で複製します。手動でのファイルコピーは不要です。

| 環境 | 用途 | project ID | reset | API | Studio |
|---|---|---|---|---|---|
| `prod` | 開発者本人が手動確認で使う実データ。永続・バックアップ対象 | `YAMORU-prod-local` | 用意していません | http://127.0.0.1:55321 | http://127.0.0.1:55323 |
| `test` | 自動テスト専用。架空fixtureのみを扱い、いつでも初期化してよい | `YAMORU-test` | `npm run test:db:reset` | http://127.0.0.1:58321 | http://127.0.0.1:58323 |

ローカルの`prod`は、開発者本人の手元での動作確認のために実データを永続化する個人用途の環境であり、外部に公開できる本番基盤ではありません。Hosted Supabaseへの移行やVercel公開、外部ネットワークへの公開は別途必要です。

事前に[Docker Desktop](https://www.docker.com/products/docker-desktop/)を起動します。Supabase CLIは`devDependencies`に固定バージョンで含まれているため、追加インストールは不要です。

### prod: 実データで手動確認する

```powershell
npm install
npm run prod:start
npm run prod:status
Copy-Item .env.example .env.local
```

`npm run prod:status`が表示するローカルの公開可能なキーを、`.env.local`の`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`へ設定します。CLIが`ANON_KEY`という名前で表示する場合も、その値を使用します。Service Roleキーは設定しません。`npm run dev`(通常の開発サーバー)は常にこの`prod`環境へ接続します。

`prod`にはfixtureを投入する仕組み自体がありません。`supabase/seed.sql`はこのワークディレクトリへ複製されず、`[db.seed] enabled = false`です。同じ理由で、`prod`を対象とするresetコマンドも意図的に用意していません。スキーマを変更する場合は`supabase/migrations/`へマイグレーションを追加し、`npm run prod:backup`でバックアップしたうえで`npm run prod:migrate`を実行してください(データを保ったままマイグレーションだけを適用します)。

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
4. 「アカウント」を開き、家庭名を入力して「家庭を作成」を選びます。
5. 作成した家庭名が表示され、作成フォームが表示されなくなることを確認します。再読み込み後も同じ家庭名が表示されます。
6. 「ログアウト」を選びます。ホーム画面を再度開くとログイン画面へ移動します。
7. 登録時と同じ値でログインし、アカウント画面に同じ家庭名が表示されることを確認します。

登録・ログイン・ログアウトは、いずれもServer ActionsまたはRoute Handler経由でNext.jsサーバーからローカルSupabaseへ接続します。ブラウザから`NEXT_PUBLIC_SUPABASE_URL`(HTTP)へ直接接続する経路は現状使用していないため、HTTPS化によるMixed Contentは発生しません。将来ブラウザー用Supabaseクライアントを直接使う場合は、ローカルSupabase APIもLAN内で到達可能なHTTPSにするか、接続をサーバー経由に限定するかを設計時に決め、ブラウザーコンソールにMixed Contentエラーがないことを確認してください。

### test: 自動テストで使う

家庭間データ分離、最初の家庭作成、期限付き・一回限りの招待受諾をRow Level Security(RLS)と両立できるか検証するため、ローカル専用のDBテストも用意しています([YDR-005](docs/decisions/ydr-005-no-realtime-no-fine-grained-permissions.md)、[RLSスパイク結果](docs/spikes/supabase-rls-household-isolation.md)、[招待受諾スパイク結果](docs/spikes/household-invitation-acceptance.md)を参照)。自動テストはすべて`test`環境だけに接続し、`prod`のURLやキーを使いません。

```powershell
npm run test:start      # test環境を起動(初回はDockerイメージ取得で時間がかかります)
npm run test:db:reset   # マイグレーションとseed.sqlを最初から再適用。いつ実行してもprodへ影響しません
npm run test:db         # pgTAPによるRLS分離・家庭作成・招待受諾テストを実行(supabase test db)
npm run test:auth:local # 登録・ログイン・最初の家庭作成のAuth接続をvitestで自動確認
npm run test:stop       # test環境を停止
```

- `test:db:reset`・`test:db`は、実行前に接続先の`project_id`が`YAMORU-test`であることを検証し、一致しない場合は破壊的操作を開始せずに停止します(`scripts/supabase-destructive-guard.ts`)。
- `supabase/seed.sql`が投入するのは、ローカル専用の架空データ(家庭A・家庭B、テスト用ユーザー、テスト用管理対象)だけです。家庭の実データは含めません。
- `test:auth:local`は毎回、`example.test`の一意な架空利用者を作成します。手動起動用の`.env.local`はGit管理対象外です。パスワード、アクセストークン、Service Roleキー、実在するメールアドレスはコミットしません。公開可能なキーも環境変数から読み、ブラウザへService Role権限を渡しません。認証済みであっても、家庭への所属が確認できるまでは家庭データへアクセス可能とは扱いません。

### バックアップと復旧(prod)

```powershell
npm run prod:backup
```

- Auth利用者(`auth`スキーマ)とアプリのデータ(`public`スキーマ)をデータのみダンプし、リポジトリ外の既定の保存先(`%USERPROFILE%\.yamoru\backups\prod\`)へタイムスタンプ付きファイル名で保存します。保存先は環境変数`YAMORU_PROD_BACKUP_DIR`で変更できます。いずれもリポジトリの外であり、Gitの追跡対象にはなりません。
- バックアップファイルには、パスワードハッシュやセッション・リフレッシュトークンを含むAuth利用者の認証情報と、家庭の実データが平文で含まれます。取扱いには実データそのものと同じ注意が必要です。共有・アップロード先には十分注意し、不要になった世代は手動で削除してください。
- ファイル名にタイムスタンプを付けて世代管理しており、最新の1件だけに依存しません。

復旧手順は、バックアップから別の一時スタック(`environments/restore-verify`、`prod`とは別のproject ID・ポート)へ復元し、内容を確認する形で検証します。

```powershell
npm run prod:restore -- "C:\Users\<you>\.yamoru\backups\prod\yamoru-prod-20260101-120000.sql"
```

一時スタックを起動してマイグレーションを適用し、指定したバックアップのデータを読み込んだうえで、Auth利用者・家庭・membershipの件数を表示します。Supabase StudioのURLも表示されるので、内容を目視でも確認できます。確認後は案内されるコマンドで一時スタックを停止してください。

実際に`prod`のデータを失って復旧する場合だけ、確認用の環境変数を明示したうえで`prod`本体へ復元します。

```powershell
$env:YAMORU_CONFIRM_PROD_RESTORE = "YAMORU-prod-local"
npm run prod:restore -- "C:\Users\<you>\.yamoru\backups\prod\yamoru-prod-20260101-120000.sql" --target=prod
```

- Supabase CLIはデフォルトで匿名の利用統計テレメトリを送信します。無効化する場合は、コマンド実行前に`SUPABASE_TELEMETRY_DISABLED=1`を設定します。
- Realtime、Storage、Edge Functionsなど、現在の対象外の機能は`prod`・`test`両方の`config.toml`で無効化しています。メール・パスワード認証は有効で、ローカル確認ではメール確認を要求しません。

### スキーマの最新仕様(型生成)

`supabase/migrations/`を積み上げた結果の最終スキーマは、`lib/supabase/database.types.ts`が正本です。テーブル・カラム・RLS関数の引数と戻り値が機械可読な形で入っており、全マイグレーションを時系列に読まなくても現在の仕様を確認できます。手で書いた要約文書は置きません(更新を忘れれば実装とずれるため)。

```powershell
npm run gen:types       # マイグレーションから型を再生成する
npm run gen:types:check # コミット済みの型がマイグレーションと一致するか検証する(CIでも実行)
```

- 生成には使い捨てのSupabaseスタック(`environments/gen-types`、`prod`・`test`とは別のproject ID・ポート)を毎回起動し、`supabase/migrations/`だけを適用します。稼働中の`prod`・`test`から生成しないのは、それらに未コミットのマイグレーションが適用されていたり手動操作でずれていたりする可能性があり、「コミット済みマイグレーションだけから再現できる」という前提が崩れるためです。実行後、使い捨てスタックはデータ量ごと破棄されます。
- マイグレーションを追加したら`npm run gen:types`を実行し、生成結果を同じコミットに含めてください。忘れた場合はCIの`Supabase schema types are up to date`が失敗します。
- `lib/supabase/database.types.ts`は生成物です。手で編集せず、スキーマ側を直してから再生成してください。
- アプリの`createClient()`はこの型を適用済みです。`.from()`・`.rpc()`のテーブル名・カラム名・引数の誤りは`npm run typecheck`で検出されます。

## 文書の入口

- [知識バンドル](docs/index.md)
- [プロダクト計画](docs/product/yamoru-project-plan.md)
- [意思決定](docs/decisions/index.md)
- [データベースに影響する変更の手順](docs/references/database-change-playbook.md)
- [レビュー依頼プロンプト](docs/references/review-prompts.md)
- [プロジェクトガイド](AGENTS.md)

## ライセンス

このリポジトリには、一般的な利用を許諾するライセンスを付与していません。利用を希望する場合の連絡方法を含む詳細は、[LICENSE](LICENSE)を確認してください。

## 公開時の注意

このリポジトリには、家庭の実データ、非公開のGoogle Driveリンク、認証情報、APIキーを保存しません。
