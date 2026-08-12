export type HomeItem = {
  id: string;
  title: string;
  detail: string;
  meta: string;
  tone: "urgent" | "today" | "upcoming" | "done" | "reminder" | "caution";
  detailHref?: string;
};

export type HomeSection = {
  id: string;
  title: string;
  description: string;
  items: HomeItem[];
};

// バックエンド導入前に情報の優先順位だけを検証するための固定サンプルです。
// 猫の浄水器のフィルター交換Todoは、推奨期間の状態(YDR-017)に応じて
// page.tsxがreminderへ実行時に差し込みます。「期限切れ」区分は厳密な
// 期限(strict)専用のため、推奨期間の上限超過(past-window)でもここには
// 入りません。
export const HOME_SECTIONS: HomeSection[] = [
  {
    id: "overdue",
    title: "期限切れ",
    description: "期限を過ぎています",
    items: [],
  },
  {
    id: "today",
    title: "今日",
    description: "今日確認したいこと",
    items: [
      {
        id: "air-conditioner-filter",
        title: "エアコンのフィルター掃除",
        detail: "リビングのエアコン",
        meta: "今日まで ・ 誰でも可",
        tone: "today",
      },
    ],
  },
  {
    id: "reminder",
    title: "そろそろ",
    description: "交換の目安の時期です",
    items: [],
  },
  {
    id: "upcoming",
    title: "近日",
    description: "これから7日間の予定",
    items: [
      {
        id: "ice-maker-water-tank",
        title: "製氷機の給水タンク掃除",
        detail: "キッチンの冷蔵庫",
        meta: "8月16日まで ・ あと4日",
        tone: "upcoming",
      },
      {
        id: "bath-drain",
        title: "浴室の排水口メンテナンス",
        detail: "浴室",
        meta: "8月18日まで ・ あと6日",
        tone: "upcoming",
      },
    ],
  },
  {
    id: "recent",
    title: "最近の実施",
    description: "家族が完了したこと",
    items: [
      {
        id: "cat-water-fountain-filter-last",
        title: "猫の浄水器のフィルター交換",
        detail: "猫の浄水器",
        meta: "7月10日 ・ 家族Aが実施",
        tone: "done",
        detailHref: "/managed-items/cat-water-fountain",
      },
      {
        id: "washing-machine-cleaner",
        title: "洗濯槽クリーナー",
        detail: "ドラム式洗濯機",
        meta: "7月28日 ・ 家族Bが実施",
        tone: "done",
      },
    ],
  },
];
