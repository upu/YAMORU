---
type: Decision
ydr_id: YDR-025
title: PBKDF2の反復回数をCloudflare Workersの実行上限(10万回)に合わせる
description: crypto.subtle/node:crypto pbkdf2がCloudflare Workers上で反復回数10万回を超えると例外になるため、独自の多段連結を避けてPBKDF2-SHA256の反復回数を10万回へ下げる
tags: [yamoru, decisions, ydr, authentication, cloudflare, security]
status: stable
decision_status: Accepted
decision_date: 2026-08-22
---

# YDR-025: PBKDF2の反復回数をCloudflare Workersの実行上限(10万回)に合わせる

- 状態: Accepted
- 決定日: 2026-08-22

## 背景

[Issue #142](https://github.com/upu/YAMORU/issues/142)は、[Issue #139](https://github.com/upu/YAMORU/issues/139)のCloudflare preview通し確認で見つかった。`lib/auth/password-policy.ts`はPBKDF2-SHA256の反復回数を`600_000`としていたが、previewでログインすると次の例外がWorkerログに記録され、Credentials認証が失敗した。

```text
NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000).
```

ローカルのNode.js環境とローカルの`@cloudflare/vitest-pool-workers`(local workerd)は、どちらもこの上限を再現せず60万回のhash生成・検証に成功した。実機相当の挙動は`wrangler dev --remote`でのみ確認できた。

## 検証したこと

`wrangler dev --remote`で実際のCloudflare edge上に最小限のWorkerを一時的に配備し、次を実測した(2026-08-22)。

- `crypto.subtle.deriveBits()`でのPBKDF2は、反復回数100,000回で成功し、100,001回で`NotSupportedError`になる。上限は正確に100,000回。
- `node:crypto`の`pbkdf2()`(`nodejs_compat`有効)も、`crypto.subtle`と全く同じ100,000回上限を持つ。issueが第一候補とした「`node:crypto`へ統一すれば60万回を維持できるか」は成立しない。この上限はWeb Crypto固有ではなく、workerdランタイム全体の制約である([cloudflare/workerd#1346](https://github.com/cloudflare/workerd/issues/1346))。
- `node:crypto`の`scrypt()`には反復回数の固定上限はないが、既定の`maxmem`(32MB)を超えるパラメータ(例: `N=32768, r=8`)は失敗し、Workersのisolateメモリ上限(128MB程度)に近いパラメータ(`N=131072, r=8`)は`wrangler dev --remote`では成功したものの、実機での安定性は未検証。

## 検討した案

- **案1(採用): PBKDF2-SHA256を維持し、反復回数だけをWorkersの上限(10万回)に合わせる。** 既存のhash形式(`pbkdf2-sha256$v1$<iterations>$<salt>$<derived>`)を変更せず、`lib/auth/password.ts`の実装も変更しない。反復回数はhash文字列へ埋め込み済みのため、`lib/auth/password-policy.ts`の定数変更だけで完結する。
- 案2: `node:crypto`のPBKDF2へ実装を切り替える。実測の通りWorkers上の上限は`crypto.subtle`と同じであり、60万回を維持する効果がないためこの案では解決しない。
- 案3: `scrypt`など別アルゴリズムへ切り替える。反復回数の上限は回避できるが、Workersのisolateメモリ上限に近いパラメータでの本番安定性が未検証であり、hash形式・検証実装の全面変更を伴う。安定性リスクをこのissueの範囲では受け入れない。
- 案4: 独自に複数回のPBKDF2呼び出しを連結し、実質的な反復回数を稼ぐ。issueで最初から不採用と定めている。強度の計算根拠が自明でなく、レビュー・監査コストに見合わない。

## 決定

- `lib/auth/password-policy.ts`の`PASSWORD_HASH_ITERATIONS`を`600_000`から`100_000`へ変更する。アルゴリズム(PBKDF2-SHA256)、hash形式、`lib/auth/password.ts`の実装は変更しない。
- `PASSWORD_HASH_ITERATIONS`は将来にわたり100,000を超えないことをコード内コメントと自動テスト(`tests/password.test.ts`)で固定する。ローカルのテスト環境(vitest、local `wrangler dev`)はこの上限を再現しないため、値そのものへの上限アサーションで代替する。
- この変更のデプロイ前に発行済みのpassword hash(反復回数600,000で埋め込み済み)は、デプロイ後は新しい上限(100,000)を超えるため`verifyPassword`が検証前に拒否する。該当する利用者は[Auth.js初回bootstrapとパスワード再設定](../references/auth-admin-operations.md)の手順で運用者がパスワードを再設定する必要がある。

## 結果

- previewで`auth:reset-password:preview`によりパスワードを再設定した利用者は、新しいパスワードでログインできる。
- 本YDRのデプロイより前にproduction D1へ保存されたpassword hashは、デプロイ後にログインできなくなる可能性がある。production側の影響有無の確認と、必要であれば`auth:reset-password:production`での再設定は、production D1を変更しないという本issueのスコープ外として別途行う。
- 保護強度はOWASP 2023時点のPBKDF2-SHA256推奨(60万回以上)を下回り、旧OWASP推奨水準(10万回)に相当する。招待限定・家族専用でpublic signupを持たない運用([YDR-023](ydr-023-invitation-only-account-lifecycle.md))であることを踏まえ、この強度低下を許容する。

## 見直す条件

- CloudflareがPBKDF2の反復回数上限を引き上げる、または`crypto.subtle`/`node:crypto`以外の高強度なhash手段(Argon2など)をWorkers上でネイティブサポートする。
- scryptなど代替アルゴリズムのWorkers isolateメモリ上限内での安定動作が別途検証され、10万回PBKDF2より高い保護強度が実用的に得られる。
- 家族専用・招待限定という脅威モデルが変わり、より高い保護強度が必要になる。
