---
type: Playbook
title: 開発テスト用ローカル環境の構築
description: Auth.jsとローカルD1を使ってYAMORUを起動し、開発中の確認と自動テストを行う手順
tags: [yamoru, development, local, authjs, d1, testing]
status: stable
---

# 開発テスト用ローカル環境の構築

この手順では、家庭の実データを使わず、Auth.jsとローカルD1でYAMORUを開発・検証する。スマートフォンやタブレットからの接続とPWA確認は[実端末・PWAの確認](local-device-pwa-verification.md)を参照する。

## 前提

- Node.js 24 LTS
- [mkcert](https://github.com/FiloSottile/mkcert)

WindowsではChocolateyの`choco install mkcert`またはScoopの`scoop install mkcert`でmkcertをインストールできる。

## 初回セットアップ

リポジトリのルートで依存関係をインストールし、環境変数ファイルを用意する。

```
npm install
```

`.env.example`を`.env.local`へ複製する。この一手順だけがshellで異なる。

bash / zshの場合。

```bash
cp .env.example .env.local
```

PowerShellの場合。

```powershell
Copy-Item .env.example .env.local
```

`.env.local`の`AUTH_SECRET`を推測困難なランダム値へ置き換える。パスワード、JWT、招待token、claim secret、`AUTH_SECRET`はコミットしない。

ローカルD1へマイグレーションを適用し、最初のアカウントを作る。

```
npm run d1:migrate
npm run auth:bootstrap
```

`auth:bootstrap`は利用者が一人もいないローカルD1に限り実行できる。公開signupは提供しない。二人目以降は、家庭の管理者が発行した招待URLから登録する。入力値と運用上の注意は[Auth.js初回bootstrapとパスワード再設定](../references/auth-admin-operations.md)を参照する。

## 開発サーバーを起動する

```
npm run dev
```

`npm run dev`は開発用HTTPSを既定とする。初回実行時にmkcertがローカルCAをWindowsの証明書ストアへ登録し、`localhost`、`127.0.0.1`、`::1`向けの証明書を`.certs/dev/`へ生成する。証明書と秘密鍵はGit管理対象外である。

ブラウザで[https://localhost:3000](https://localhost:3000)を開く。証明書に対応するホストが増えた場合や証明書の期限が切れた場合は、次回起動時に自動で再生成される。証明書だけを手動で再生成・確認する場合は`npm run dev:cert`を使う。

HTTPでの起動が必要な場合に限り、明示的なフォールバックとして`npm run dev:http`を使う。

## ローカルで基本動作を確認する

1. 未認証でホームを開くとログイン画面へ移動することを確認する。
2. `auth:bootstrap`で登録した認証情報でログインする。
3. アカウント画面でニックネームと最初の家庭を作成する。
4. 再読み込み後も同じ家庭を表示できることを確認する。
5. ログアウト後はログイン画面へ移動し、同じ認証情報で再ログインできることを確認する。

## 自動テストを実行する

通常の品質確認は次を実行する。

```
npm run lint
npm run typecheck
npm test
npm run test:d1
npm run build
```

`npm run test:d1`は、実D1上で家庭間分離、IDOR耐性、複数行更新の原子性を確認する。事前にローカルD1へマイグレーションを適用しておく。

家族招待を含むブラウザ操作を確認する場合は、初回だけChromiumをインストールしてE2Eを実行する。

```
npm run test:e2e:install
npm run test:e2e:local
```

`test:e2e:local`はE2E専用の空のローカルD1へマイグレーションと架空fixtureを適用する。通常のローカルD1や家庭の実データは使わない。

Pull Requestと`main`へのpushでは、GitHub ActionsがQuality checksに加え、空のローカルD1へのマイグレーション適用と家庭間分離・原子性テストを実行する。
