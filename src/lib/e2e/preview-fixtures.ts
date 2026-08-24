// preview環境に対するPlaywright E2E(#151)が使う、固定の架空テスト
// アカウント。scripts/e2e-admin-platform.ts(reset実行)とe2e/preview配下の
// specの両方から参照する単一の正本にする。
export const PREVIEW_E2E_OWNER_EMAIL = "e2e-owner@example.test";
export const PREVIEW_E2E_OUTSIDER_EMAIL = "e2e-outsider@example.test";
export const PREVIEW_E2E_INVITEE_EMAIL = "e2e-invitee@example.test";
export const PREVIEW_E2E_OUTSIDER_NICKNAME = "E2E部外者";
export const PREVIEW_E2E_OUTSIDER_HOUSEHOLD_NAME = "E2E部外者の家庭";
