---
type: Component Map
title: 認証・家庭・招待の修正箇所マップ
description: ログイン、家庭の作成、招待、家庭間分離について、最初に読む実装とテスト、守る不変条件、関連する有効なYDRへの入口
tags: [yamoru, components, auth, household, invitation]
status: stable
---

# 認証・家庭・招待の修正箇所マップ

## 責務

Auth.js Credentialsによるログイン、家庭(household)の作成と所属、招待の発行・受諾、ニックネーム、そしてすべての機能が依存する家庭間分離を扱う。

## 主要入口

| 役割 | 実装 |
|---|---|
| 認証設定・保護経路 | `src/auth.ts`、`src/auth.config.ts`、`src/middleware.ts`、`src/app/public-paths.ts` |
| ログイン・パスワード | `src/app/login/actions.ts`、`src/app/account/password-actions.ts` → `src/lib/d1/authentication.ts`、`src/lib/auth/password.ts`、`src/lib/auth/password-policy.ts` |
| 家庭の作成・状態 | `src/app/household/actions.ts` → `src/lib/d1/households.ts` |
| 招待の発行・取消 | `src/app/household/invitation-actions.ts` → `src/lib/d1/invitations.ts` |
| 招待の受諾(既存利用者 / 新規登録) | `src/app/invitations/accept/actions.ts`、`src/app/invitations/accept/confirm/actions.ts`、`src/app/invitations/accept/confirm/registration-actions.ts`、`src/lib/invitations/claim-cookie.ts` |
| ニックネーム | `src/app/account/actions.ts` → `src/lib/d1/profiles.ts` |
| 家庭間分離の共通処理 | `src/lib/d1/authorization.ts`、`src/lib/d1/context.ts` |
| 運用(初回bootstrap、パスワード再設定) | `scripts/auth-admin.ts`、[手順](../references/auth-admin-operations.md) |

## 重要な不変条件

- D1にRLSはないため、家庭間分離はアプリ層で行う([YDR-022](../decisions/ydr-022-cloudflare-workers-d1-migration.md))。データアクセス関数はセッションからmembershipを導出し(`requireCurrentHouseholdId`)、フォームやURLから受け取った家庭IDを認可根拠にしない。
- 読み書きのSQLに`household_id`条件を含める。家庭Aの正規セッションに家庭Bの行IDを組み合わせても0件またはNot Foundになることをテストする(詳細は[データベースに影響する変更の手順](../references/database-change-playbook.md))。
- 公開登録は行わず、アカウント作成は招待経由に限る。招待は7日間・一回限り・メール一致の契約を持つ([YDR-023](../decisions/ydr-023-invitation-only-account-lifecycle.md))。
- 招待の生tokenはquery stringではなくURL fragmentで搬送する([YDR-024](../decisions/ydr-024-invitation-token-in-url-fragment.md))。
- パスワードハッシュのPBKDF2反復回数はCloudflare Workersの実行上限に合わせる([YDR-025](../decisions/ydr-025-pbkdf2-iterations-within-workers-limit.md))。変更時は`src/lib/auth/password.ts`と`tests/password.test.ts`を一組で見る。
- 家庭メンバーは全員が家庭内データを編集できる。細かな権限区別を持ち込まない([YDR-005](../decisions/ydr-005-no-realtime-no-fine-grained-permissions.md)のうち継続する部分)。
- アカウント単位のニックネームと家庭内の表示名は同一概念として扱う([YDR-018](../decisions/ydr-018-account-nickname-as-member-display-name.md))。

## 関連YDR

- 有効: [YDR-001](../decisions/ydr-001-family-first.md)、[YDR-018](../decisions/ydr-018-account-nickname-as-member-display-name.md)、[YDR-022](../decisions/ydr-022-cloudflare-workers-d1-migration.md)、[YDR-024](../decisions/ydr-024-invitation-token-in-url-fragment.md)、[YDR-025](../decisions/ydr-025-pbkdf2-iterations-within-workers-limit.md)
- 部分的に置き換えられている(範囲に注意):
  - [YDR-005](../decisions/ydr-005-no-realtime-no-fine-grained-permissions.md)はYDR-022が置き換えたが、置き換わったのは「household_idとRLSによる分離を必須とする」部分だけである。Realtimeを作らないこと、家庭メンバー全員が編集可能なことは継続する。
  - [YDR-023](../decisions/ydr-023-invitation-only-account-lifecycle.md)はYDR-024が置き換えたが、置き換わったのは生tokenの搬送方式だけである。招待の発行・失効ライフサイクル、7日間・一回限り・メール一致の契約、共通エラー、パスワード運用は継続する。
  - [YDR-019](../decisions/ydr-019-invitation-lifecycle.md)は全体をYDR-023が置き換えたため、過去の経緯として読む。

## 検証方法

```
npm test -- tests/auth-actions.test.ts tests/invitation-actions.test.ts tests/invite-accept-actions.test.ts tests/household-actions.test.ts
npm run test:d1
npm run lint
npm run typecheck
```

家庭間分離を変える場合は`src/lib/d1/authorization.d1-test.ts`と各機能の`*-authorization.d1-test.ts`、共有導線の回帰は`e2e/family-sharing.spec.ts`で確認する。
