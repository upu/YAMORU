// YAMORUはオンライン専用PWAで、認証済みHTMLや家庭データを永続キャッシュしない。
// そのためR2等の永続incremental cacheは追加せず、既定のインメモリ構成を使う。
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig();
// Auth.js middleware renews the incoming session. A POST handler's replacement
// or deletion must win, otherwise login/logout restores the previous user.
config.dangerous = {
  ...config.dangerous,
  headersAndCookiesPriority: (event) => event.method === "POST" ? "handler" : "middleware",
};
export default config;
