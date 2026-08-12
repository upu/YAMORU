# YAMORU

暮らしの「いつだっけ？」をなくす。

YAMORUは、家族のTodo、家電や契約などの管理対象、定期メンテナンス、実施履歴を一か所で扱う家庭運営アプリです。

## 現在の段階

プロダクト定義と意思決定をもとに、固定サンプルデータを使ったホーム画面、管理対象の詳細、Todo完了フローを確認できます。ローカルSupabase Authへ接続した登録・ログイン・ログアウトも確認できます。家庭の実データは使用しません。

Todoの完了結果は、画面間で共有するブラウザ内の一時状態です。再読み込みすると固定サンプルデータへ戻り、保存はされません。

プロジェクトの知識は、OKF v0.2を参考にした[`docs/`](docs/)を正本とします。

## ローカルで起動する

Node.js 24 LTSを用意し、リポジトリのルートで次のコマンドを実行します。

```powershell
npm install
npm run dev
```

起動後、ブラウザで[http://localhost:3000](http://localhost:3000)を開きます。

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

`localhost`以外のホスト名やIPアドレスで開発サーバーを開く場合は、起動マシンのIPv4アドレスを`.env.local`の`YAMORU_ALLOWED_DEV_ORIGINS`へ設定します。これはスマートフォン専用ではなく、同じWi-Fi上のタブレットや別のPCなどから接続する場合も同じです。たとえば起動マシンのアドレスが`192.168.1.10`なら、`YAMORU_ALLOWED_DEV_ORIGINS=192.168.1.10`とし、別端末で`http://192.168.1.10:3000`を開きます。複数指定する場合はカンマで区切ります。変更後は開発サーバーを再起動してください。

`YAMORU_ALLOWED_DEV_ORIGINS`はNext.jsの開発サーバーだけで使う設定であり、本番環境には設定しません。本番の`NEXT_PUBLIC_SUPABASE_URL`にはグローバルIPアドレスではなく、SupabaseプロジェクトのConnect画面に表示される`https://<project-ref>.supabase.co`形式のProject URLを設定します。Supabaseをセルフホストする場合も、ブラウザから到達できるHTTPSのドメイン名を使用します。

続けてアプリを起動します。

```powershell
npm run dev
```

1. [http://127.0.0.1:3000](http://127.0.0.1:3000)を開くと、未認証時はログイン画面へ移動します。
2. `person@example.test`などの架空のメールアドレスと、6文字以上のテスト用パスワードで新規登録します。
3. ホーム画面が表示され、再読み込み後もログイン状態が維持されることを確認します。
4. 「アカウント」を開き、「ログアウト」を選びます。ホーム画面を再度開くとログイン画面へ移動します。
5. 登録時と同じ値でログインできることを確認します。

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
