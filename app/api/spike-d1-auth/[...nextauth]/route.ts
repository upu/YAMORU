// Issue #116スパイク: Auth.js(next-auth v5)のルートハンドラ。
// 既存のSupabase Authベースのログイン(app/login, app/auth/signout)とは
// 完全に独立したスパイク専用の経路。
import { handlers } from "../../../../lib/d1-spike/auth";

export const { GET, POST } = handlers;
