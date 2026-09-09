import Link from "next/link";

import {
  APP_VERSION_INFO,
  type AppVersionInfo,
  formatDetailedAppVersion,
} from "../app-version";
import { PinIcon } from "../consumables/pin-icon";
import { EditIcon } from "../edit-icon";
import styles from "./help.module.css";

/* Issue #361: 通常の画面はコンパクトなままにし、各操作の説明はこの画面へ
   集める。画面側とヘルプで同じ説明を重複させない。 */
const USAGE_TOPICS = [
  {
    detail: "家事や手続きの予定です。期限が近いものと期限切れをホームに集めます。",
    term: "Todo",
  },
  {
    detail: "備品とサービス・契約の記録です。Todoや消耗品と関連づけられます。",
    term: "台帳",
  },
  {
    detail: "日用品の在庫です。「ある / 少ない / ない」で切り替え、少ないものは買い物候補に出ます。",
    term: "消耗品",
  },
];

const BASIC_OPERATIONS = [
  "ホームで今日やることを確認し、終わったTodoをその場で完了にする。",
  "消耗品の在庫が減ったら、ホームか消耗品詳細で在庫状態を切り替える。",
  "よく使う消耗品は消耗品詳細でピン留めし、ホームから確認・操作する。",
];

function PlusIcon() {
  return <span aria-hidden="true" className={styles.textIcon}>＋</span>;
}

const ICON_TOPICS = [
  {
    detail: "消耗品をホームのピン留めに追加します。ピン留め済みの状態でもう一度押すと外れます。",
    icon: <PinIcon isPinned={false} />,
    term: "ピン留め",
  },
  {
    detail: "Todoや台帳、関連する項目を追加します。",
    icon: <PlusIcon />,
    term: "追加",
  },
  {
    detail: "表示中の記録を編集します。",
    icon: <EditIcon />,
    term: "編集",
  },
];

export function HelpContent({ versionInfo }: { versionInfo: AppVersionInfo }) {
  return (
    <main className="detail-page help-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/">← ホームへ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="eyebrow">サポート</p>
        <h1>ヘルプ</h1>
        <p>YAMORUの使い方と、問い合わせるときに必要な情報を確認できます。</p>
      </header>

      <section aria-labelledby="usage-title" className="detail-card">
        <h2 id="usage-title">YAMORUの使い方</h2>
        <dl className={styles.topics}>
          {USAGE_TOPICS.map((topic) => (
            <div key={topic.term}>
              <dt>{topic.term}</dt>
              <dd>{topic.detail}</dd>
            </div>
          ))}
        </dl>
        <h3 className={styles.subheading}>日常的な操作</h3>
        <ul className={styles.operations}>
          {BASIC_OPERATIONS.map((operation) => (
            <li key={operation}>{operation}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="icons-title" className="detail-card">
        <h2 id="icons-title">主なアイコン</h2>
        <dl className={styles.topics}>
          {ICON_TOPICS.map((topic) => (
            <div key={topic.term}>
              <dt>
                <span className={styles.icon}>{topic.icon}</span>
                {topic.term}
              </dt>
              <dd>{topic.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="version-title" className="detail-card">
        <h2 id="version-title">バージョン情報</h2>
        <p className="app-version-detail">
          {formatDetailedAppVersion(versionInfo)}
        </p>
        <p>この一行をそのままお伝えください。</p>
      </section>
    </main>
  );
}

export default function HelpPage() {
  return <HelpContent versionInfo={APP_VERSION_INFO} />;
}
