// YAMORUはオンライン専用PWAで、認証済みHTMLや家庭データを永続キャッシュしない。
// そのためR2等の永続incremental cacheは追加せず、既定のインメモリ構成を使う。
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
