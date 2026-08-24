import { constantTimeTokenMatch } from "../src/lib/auth/constant-time-token.ts";
import { hashPassword } from "../src/lib/auth/password.ts";
import {
  PREVIEW_E2E_INVITEE_EMAIL,
  PREVIEW_E2E_OUTSIDER_EMAIL,
  PREVIEW_E2E_OUTSIDER_HOUSEHOLD_NAME,
  PREVIEW_E2E_OUTSIDER_NICKNAME,
  PREVIEW_E2E_OWNER_EMAIL,
} from "../src/lib/e2e/preview-fixtures.ts";

type E2eAdminPlatformEnv = {
  DB: D1Database;
  E2E_ADMIN_SESSION_TOKEN: string;
};

type ResetFixturesResult = {
  ownerEmail: string;
  ownerPassword: string;
  outsiderEmail: string;
  outsiderPassword: string;
};

function randomPassword(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(24)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

// 前回実行分の固定テストアカウント(owner・outsider・invitee)と、それらが
// 所属する家庭をすべて消す。householdはON DELETE CASCADEでメンバー・
// 管理対象・Todo・履歴・招待をまとめて削除するため、ownerが自分で作成した
// 家庭やinviteeが参加した家庭のようにidが実行のたびに変わるものも、
// メールアドレス経由でもれなく片付く。
async function clearFixtures(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `DELETE FROM households WHERE id IN (
         SELECT hm.household_id FROM household_members hm
         JOIN users u ON u.id = hm.user_id
         WHERE u.email IN (?1, ?2, ?3)
       )`,
    ).bind(PREVIEW_E2E_OWNER_EMAIL, PREVIEW_E2E_OUTSIDER_EMAIL, PREVIEW_E2E_INVITEE_EMAIL),
    db.prepare("DELETE FROM users WHERE email IN (?1, ?2, ?3)").bind(
      PREVIEW_E2E_OWNER_EMAIL,
      PREVIEW_E2E_OUTSIDER_EMAIL,
      PREVIEW_E2E_INVITEE_EMAIL,
    ),
  ]);
}

// owner: ニックネーム・家庭が未作成の状態から始める(specが初回セットアップ
// 導線を確認するため)。outsider: 別の家庭にすでに所属した状態で作る
// (specが家庭間分離を確認するため)。inviteeはspec自身が招待受諾UIから作る。
async function seedFixtures(db: D1Database): Promise<ResetFixturesResult> {
  const ownerPassword = randomPassword();
  const outsiderPassword = randomPassword();
  const [ownerHash, outsiderHash] = await Promise.all([
    hashPassword(ownerPassword),
    hashPassword(outsiderPassword),
  ]);
  const ownerId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const outsiderHouseholdId = crypto.randomUUID();

  await db.batch([
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?1, ?2, ?3)")
      .bind(ownerId, PREVIEW_E2E_OWNER_EMAIL, ownerHash),
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?1, ?2, ?3)")
      .bind(outsiderId, PREVIEW_E2E_OUTSIDER_EMAIL, outsiderHash),
    db.prepare("INSERT INTO profiles (user_id, nickname) VALUES (?1, ?2)")
      .bind(outsiderId, PREVIEW_E2E_OUTSIDER_NICKNAME),
    db.prepare("INSERT INTO households (id, name) VALUES (?1, ?2)")
      .bind(outsiderHouseholdId, PREVIEW_E2E_OUTSIDER_HOUSEHOLD_NAME),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES (?1, ?2)")
      .bind(outsiderHouseholdId, outsiderId),
  ]);

  return {
    outsiderEmail: PREVIEW_E2E_OUTSIDER_EMAIL,
    outsiderPassword,
    ownerEmail: PREVIEW_E2E_OWNER_EMAIL,
    ownerPassword,
  };
}

const e2eAdminPlatform = {
  async fetch(request: Request, env: E2eAdminPlatformEnv): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!await constantTimeTokenMatch(token, env.E2E_ADMIN_SESSION_TOKEN)) {
      return new Response(null, { status: 401 });
    }

    try {
      await clearFixtures(env.DB);
      const result = await seedFixtures(env.DB);
      return Response.json(result);
    } catch {
      return new Response(null, { status: 500 });
    }
  },
};

export default e2eAdminPlatform;
