# YAMORU

暮らしの「いつだっけ？」をなくす。

YAMORUは、家族のTodo、家電や契約などの管理対象、定期メンテナンス、実施履歴を一か所で扱う家庭運営アプリです。

## 現在の段階

プロダクト定義と意思決定をもとに、固定サンプルデータを使ったホーム画面、管理対象の詳細、Todo完了フローを確認できます。外部サービスへの接続や家庭の実データは使用しません。

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

## ローカルSupabase(技術スパイク)

家庭間データ分離と、期限付き・一回限りの招待受諾をRow Level Security(RLS)と両立できるか検証するため、ローカル専用のSupabase環境を用意しています。アプリ本体はまだSupabaseへ接続していません([YDR-005](docs/decisions/ydr-005-no-realtime-no-fine-grained-permissions.md)、[RLSスパイク結果](docs/spikes/supabase-rls-household-isolation.md)、[招待受諾スパイク結果](docs/spikes/household-invitation-acceptance.md)を参照)。

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
- Realtime、Storage、Edge Functions、認証プロバイダーの設定など、この技術スパイクの対象外の機能は`supabase/config.toml`で無効化しています。

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
