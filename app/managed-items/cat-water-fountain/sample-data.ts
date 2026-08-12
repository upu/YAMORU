export type Activity = {
  date: string;
  dateTime: string;
  member: string;
};

// 実データ接続前に、詳細画面で確認すべき情報の順序だけを検証する固定サンプルです。
export const CAT_WATER_FOUNTAIN = {
  name: "猫の浄水器",
  kind: "ペット用品",
  externalLink: {
    isSample: true,
    label: "サンプル商品ページを開く",
    url: "https://example.com/cat-water-fountain",
  },
  lastActivity: {
    date: "7月10日",
    dateTime: "2026-07-10",
    member: "家族A",
  },
  nextDueDate: "8月9日まで",
  task: {
    name: "フィルター交換",
    cadence: "完了日から30日後",
    status: "期限切れ",
  },
  history: [
    {
      date: "7月10日",
      dateTime: "2026-07-10",
      member: "家族A",
    },
    {
      date: "6月10日",
      dateTime: "2026-06-10",
      member: "家族B",
    },
    {
      date: "5月11日",
      dateTime: "2026-05-11",
      member: "家族A",
    },
  ] satisfies Activity[],
} as const;
