export type HomeItem = {
  title: string;
  detail: string;
  meta: string;
  tone: "urgent" | "today" | "upcoming" | "done";
  detailHref?: string;
};

export type HomeSection = {
  id: string;
  title: string;
  description: string;
  items: HomeItem[];
};

// バックエンド導入前に情報の優先順位だけを検証するための固定サンプルです。
export const HOME_SECTIONS: HomeSection[] = [
  {
    id: "overdue",
    title: "期限切れ",
    description: "期限を過ぎています",
    items: [
      {
        title: "猫の浄水器のフィルター交換",
        detail: "猫の浄水器",
        meta: "8月9日まで ・ 3日超過",
        tone: "urgent",
        detailHref: "/managed-items/cat-water-fountain",
      },
    ],
  },
  {
    id: "today",
    title: "今日",
    description: "今日確認したいこと",
    items: [
      {
        title: "エアコンのフィルター掃除",
        detail: "リビングのエアコン",
        meta: "今日まで ・ 誰でも可",
        tone: "today",
      },
    ],
  },
  {
    id: "upcoming",
    title: "近日",
    description: "これから7日間の予定",
    items: [
      {
        title: "製氷機の給水タンク掃除",
        detail: "キッチンの冷蔵庫",
        meta: "8月16日まで ・ あと4日",
        tone: "upcoming",
      },
      {
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
        title: "猫の浄水器のフィルター交換",
        detail: "猫の浄水器",
        meta: "7月10日 ・ 家族Aが実施",
        tone: "done",
        detailHref: "/managed-items/cat-water-fountain",
      },
      {
        title: "洗濯槽クリーナー",
        detail: "ドラム式洗濯機",
        meta: "7月28日 ・ 家族Bが実施",
        tone: "done",
      },
    ],
  },
];
