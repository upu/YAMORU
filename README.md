# YAMORU

暮らしの「いつだっけ？」をなくす。

YAMORUは、家族のTodo、家電や契約などの管理対象、定期メンテナンス、実施履歴を一か所で扱う家庭運営アプリです。

## 現在の段階

プロダクト定義と意思決定をもとに、固定サンプルデータを使ったホーム画面、管理対象の詳細、Todo完了フローを確認できます。ローカルSupabase Authへ接続した登録・ログイン・ログアウトも確認できます。家庭の実データは使用しません。

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

## ローカルSupabase Authで登録・ログインする

事前に[Docker Desktop](https://www.docker.com/products/docker-desktop/)を起動します。Supabase CLIは`devDependencies`に固定バージョンで含まれているため、追加インストールは不要です。

```powershell
npm install
npm run db:start
npm run db:status
Copy-Item .env.example .env.local
```

`npm run db:status`が表示するローカルの公開可能なキーを、`.env.local`の`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`へ設定します。CLIが`ANON_KEY`という名前で表示する場合も、その値を使用します。Service Roleキーは設定しません。

`localhost`以外のホスト名やIPアドレスで開発サーバーを開く場合は、起動マシンのIPv4アドレスを`.env.local`の`YAMORU_ALLOWED_DEV_ORIGINS`へ設定します。これはスマートフォン専用ではなく、同じWi-Fi上のタブレットや別のPCなどから接続する場合も同じです。たとえば起動マシンのアドレスが`192.168.1.10`なら、`YAMORU_ALLOWED_DEV_ORIGINS=192.168.1.10`とし、別端末で`https://192.168.1.10:3000`を開きます。複数指定する場合はカンマで区切ります。同じ値がHTTPS開発証明書の対象ホストにもなるため、変更後は開発サーバーを再起動してください(`npm run dev`が証明書を自動で再生成します)。DHCPで起動マシンのIPアドレスが変わった場合も同様に再設定・再起動が必要です。

`YAMORU_ALLOWED_DEV_ORIGINS`はNext.jsの開発サーバーだけで使う設定であり、本番環境には設定しません。本番の`NEXT_PUBLIC_SUPABASE_URL`にはグローバルIPアドレスではなく、SupabaseプロジェクトのConnect画面に表示される`https://<project-ref>.supabase.co`形式のProject URLを設定します。Supabaseをセルフホストする場合も、ブラウザから到達できるHTTPSのドメイン名を使用します。

### iPhoneなど別端末でローカルCAを信頼する

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
2. `person@example.test`などの架空のメールアドレスと、6文字以上のテスト用パスワードで新規登録します。
3. ホーム画面が表示され、再読み込み後もログイン状態が維持されることを確認します。
4. 「アカウント」を開き、「ログアウト」を選びます。ホーム画面を再度開くとログイン画面へ移動します。
5. 登録時と同じ値でログインできることを確認します。

登録・ログイン・ログアウトは、いずれもServer ActionsまたはRoute Handler経由でNext.jsサーバーからローカルSupabaseへ接続します。ブラウザから`NEXT_PUBLIC_SUPABASE_URL`(HTTP)へ直接接続する経路は現状使用していないため、HTTPS化によるMixed Contentは発生しません。将来ブラウザー用Supabaseクライアントを直接使う場合は、ローカルSupabase APIもLAN内で到達可能なHTTPSにするか、接続をサーバー経由に限定するかを設計時に決め、ブラウザーコンソールにMixed Contentエラーがないことを確認してください。

Authサービスへの実接続だけを自動確認する場合は、ローカルSupabaseを起動してから実行します。テストはSupabase CLIから接続先と公開可能なキーを自動取得するため、テスト専用のenvファイルは不要です。

```powershell
npm run test:auth:local
```

このテストは毎回、`example.test`の一意な架空利用者を作成します。`npm run db:reset`でローカルデータを再構築できます。手動起動用の`.env.local`はGit管理対象外です。パスワード、アクセストークン、Service Roleキー、実在するメールアドレスはコミットしません。公開可能なキーも環境変数から読み、ブラウザへService Role権限を渡しません。認証済みであっても、家庭への所属が確認できるまでは家庭データへアクセス可能とは扱いません。

## ローカルSupabase(DB・RLS)

家庭間データ分離と、期限付き・一回限りの招待受諾をRow Level Security(RLS)と両立できるか検証するため、ローカル専用のDBテストも用意しています([YDR-005](docs/decisions/ydr-005-no-realtime-no-fine-grained-permissions.md)、[RLSスパイク結果](docs/spikes/supabase-rls-household-isolation.md)、[招待受諾スパイク結果](docs/spikes/household-invitation-acceptance.md)を参照)。

事前に[Docker Desktop](https://www.docker.com/products/docker-desktop/)を起動しておきます。Supabase CLIはこのリポジトリの`devDependencies`に固定バージョンで含まれているため、追加のインストールは不要です。

```powershell
npm run db:start  # ローカルSupabaseを起動(初回はDockerイメージの取得で時間がかかります)
npm run db:reset  # マイグレーションとseed.sqlを最初から再適用
npm run db:test   # pgTAPによるRLS分離・招待受諾テストを実行(supabase test db)
npm run db:stop   # ローカルSupabaseを停止
```

- `npm run db:start`後、Supabase Studioは[http://127.0.0.1:54323](http://127.0.0.1:54323)で確認できます。
- `supabase/seed.sql`が投入するのは、ローカル専用の架空データ(家庭A・家庭B、テスト用ユーザー、テスト用管理対象)だけです。家庭の実データは含めません。
- Supabase CLIはデフォルトで匿名の利用統計テレメトリを送信します。無効化する場合は、コマンド実行前に`SUPABASE_TELEMETRY_DISABLED=1`を設定します。
- Realtime、Storage、Edge Functionsなど、現在の対象外の機能は`supabase/config.toml`で無効化しています。メール・パスワード認証は有効で、ローカル確認ではメール確認を要求しません。

## 文書の入口

- [知識バンドル](docs/index.md)
- [プロダクト計画](docs/product/yamoru-project-plan.md)
- [意思決定](docs/decisions/index.md)
- [レビュー依頼プロンプト](docs/references/review-prompts.md)
- [プロジェクトガイド](AGENTS.md)

## ライセンス

このリポジトリには、一般的な利用を許諾するライセンスを付与していません。利用を希望する場合の連絡方法を含む詳細は、[LICENSE](LICENSE)を確認してください。

## 公開時の注意

このリポジトリには、家庭の実データ、非公開のGoogle Driveリンク、認証情報、APIキーを保存しません。
