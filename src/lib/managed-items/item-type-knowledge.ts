import { normalizeItemTypeText } from "./item-type-text";

// Issue #332: AIが「詳しい種類」を提案するときに使う、YAMORU専用の構造化知識。
// 家庭用品・サービス管理でよく使う代表的な種類と、その言い換え(variants)、
// 手がかりになる関連語(relatedTerms、メーカー名・製品名・俗称)を持つ。
//
// 初期段階ではベクトルDBやRAG基盤を前提にしない(issue本文の「初期段階では
// 専用のベクトルDBや大規模RAG基盤を前提にしない」)。少量の定数で足りるかを
// 先に確かめ、足りなくなってから検索基盤を検討する。
//
// ここに並ぶのはYAMORU共通の一般知識だけで、家庭の実データは含めない。
// 家庭ごとの表記は listHouseholdCustomItemTypes と提案・採用履歴から別途
// 集める(他家庭の個別データを混ぜない、issue本文の設計上の注意)。
export type ItemTypeKnowledgeEntry = {
  kindCode: string;
  label: string;
  relatedTerms: string[];
  variants: string[];
};

export const ITEM_TYPE_KNOWLEDGE: ItemTypeKnowledgeEntry[] = [
  {
    kindCode: "asset",
    label: "コーヒーマシン",
    relatedTerms: ["デロンギ", "マグニフィカ", "ネスプレッソ", "キューリグ", "バリスタ", "エスプレッソ", "コーヒー"],
    variants: ["全自動コーヒーマシン", "カプセル式コーヒーマシン", "ドリップ式コーヒーメーカー"],
  },
  {
    kindCode: "asset",
    label: "エアコン",
    relatedTerms: ["ダイキン", "霧ヶ峰", "白くまくん", "うるさら", "クーラー", "冷房", "暖房"],
    variants: ["ルームエアコン", "壁掛けエアコン"],
  },
  {
    kindCode: "asset",
    label: "冷蔵庫",
    relatedTerms: ["冷凍庫", "野菜室", "製氷"],
    variants: ["冷凍冷蔵庫", "ワインセラー"],
  },
  {
    kindCode: "asset",
    label: "洗濯機",
    relatedTerms: ["ビートウォッシュ", "洗濯", "乾燥"],
    variants: ["ドラム式洗濯乾燥機", "縦型洗濯機"],
  },
  {
    kindCode: "asset",
    label: "掃除機",
    relatedTerms: ["ルンバ", "ブラーバ", "ダイソン", "マキタ"],
    variants: ["ロボット掃除機", "スティック掃除機"],
  },
  {
    kindCode: "asset",
    label: "電子レンジ",
    relatedTerms: ["ヘルシオ", "ビストロ", "レンジ"],
    variants: ["オーブンレンジ", "スチームオーブンレンジ"],
  },
  {
    kindCode: "asset",
    label: "食洗機",
    relatedTerms: ["ミーレ", "食器洗い", "ボッシュ"],
    variants: ["食器洗い乾燥機", "据え置き型食洗機"],
  },
  {
    kindCode: "asset",
    label: "空気清浄機",
    relatedTerms: ["プラズマクラスター", "ナノイー", "花粉", "加湿"],
    variants: ["加湿空気清浄機", "除湿機"],
  },
  {
    kindCode: "asset",
    label: "給湯器",
    relatedTerms: ["ノーリツ", "リンナイ", "お湯", "追い焚き"],
    variants: ["エコキュート", "ガス給湯器"],
  },
  {
    kindCode: "asset",
    label: "浄水器",
    relatedTerms: ["クリンスイ", "ブリタ", "カートリッジ"],
    variants: ["ウォーターサーバー", "据え置き型浄水器"],
  },
  {
    kindCode: "asset",
    label: "火災警報器",
    relatedTerms: ["煙感知器", "熱感知器", "消防"],
    variants: ["住宅用火災警報器", "消火器"],
  },
  {
    kindCode: "asset",
    label: "換気扇",
    relatedTerms: ["フィルター", "24時間換気"],
    variants: ["レンジフード", "浴室換気扇"],
  },
  {
    kindCode: "asset",
    label: "プリンター",
    relatedTerms: ["エプソン", "キヤノン", "ブラザー", "インク", "トナー"],
    variants: ["インクジェットプリンター", "レーザープリンター", "複合機"],
  },
  {
    kindCode: "asset",
    label: "ネットワーク機器",
    relatedTerms: ["バッファロー", "nec", "wifi", "wi-fi", "ontメッシュ"],
    variants: ["無線LANルーター", "メッシュWi-Fi"],
  },
  {
    kindCode: "asset",
    label: "自転車",
    relatedTerms: ["ヤマハ", "パス", "ビッケ", "ブリヂストン", "チャイルドシート"],
    variants: ["電動アシスト自転車", "子ども用自転車"],
  },
  {
    kindCode: "asset",
    label: "自動車",
    relatedTerms: ["トヨタ", "ホンダ", "日産", "スズキ", "車検", "タイヤ"],
    variants: ["軽自動車", "電動アシスト付き車両", "バイク"],
  },
  {
    kindCode: "asset",
    label: "寝具",
    relatedTerms: ["西川", "エアウィーヴ", "羽毛"],
    variants: ["マットレス", "布団"],
  },
  {
    kindCode: "asset",
    label: "ペット用品",
    relatedTerms: ["猫", "犬", "水槽", "ケージ"],
    variants: ["自動給餌器", "給水機"],
  },
  {
    kindCode: "service",
    label: "電気",
    relatedTerms: ["東京電力", "関西電力", "電力", "アンペア"],
    variants: ["電力契約"],
  },
  {
    kindCode: "service",
    label: "ガス",
    relatedTerms: ["東京ガス", "大阪ガス", "ボンベ"],
    variants: ["都市ガス", "プロパンガス"],
  },
  {
    kindCode: "service",
    label: "水道",
    relatedTerms: ["上下水道", "水道局"],
    variants: ["上水道", "下水道"],
  },
  {
    kindCode: "service",
    label: "インターネット回線",
    relatedTerms: ["nuro", "フレッツ", "ドコモ光", "ソフトバンク光", "プロバイダ"],
    variants: ["光回線", "モバイル回線"],
  },
  {
    kindCode: "service",
    label: "携帯電話",
    relatedTerms: ["ahamo", "povo", "楽天モバイル", "ワイモバイル", "スマホ"],
    variants: ["携帯電話回線", "格安SIM"],
  },
  {
    kindCode: "service",
    label: "保険",
    relatedTerms: ["満期", "更新", "共済", "保険料"],
    variants: ["火災保険", "自動車保険", "生命保険", "医療保険"],
  },
  {
    kindCode: "service",
    label: "動画配信サービス",
    relatedTerms: ["netflix", "ネットフリックス", "amazonプライム", "ディズニープラス", "u-next"],
    variants: ["サブスクリプション"],
  },
  {
    kindCode: "service",
    label: "音楽配信サービス",
    relatedTerms: ["spotify", "apple music", "youtube music"],
    variants: ["サブスクリプション"],
  },
  {
    kindCode: "service",
    label: "習い事",
    relatedTerms: ["月謝", "発表会", "レッスン", "教室"],
    variants: ["ピアノ教室", "スイミングスクール", "学習塾", "英会話教室"],
  },
  {
    kindCode: "service",
    label: "福祉サービス",
    relatedTerms: ["受給者証", "相談支援", "児童"],
    variants: ["放課後等デイサービス", "訪問リハビリ"],
  },
  {
    kindCode: "service",
    label: "清掃サービス",
    relatedTerms: ["おそうじ本舗", "ダスキン", "定期清掃"],
    variants: ["ハウスクリーニング", "エアコンクリーニング"],
  },
  {
    kindCode: "service",
    label: "税・公共料金",
    relatedTerms: ["納付", "納税", "自治体"],
    variants: ["固定資産税", "自動車税", "住民税"],
  },
  {
    kindCode: "service",
    label: "住まいの契約",
    relatedTerms: ["更新料", "管理費", "返済"],
    variants: ["賃貸契約", "住宅ローン"],
  },
  {
    kindCode: "service",
    label: "保守契約",
    relatedTerms: ["メーカー保証", "点検", "サポート"],
    variants: ["延長保証", "定期点検契約"],
  },
];

// 入力中の情報(名前・メーカー・メモ・入力途中の種類)と、知識の見出し語・
// 言い換え・関連語を突き合わせる。表記は normalizeItemTypeText で揃えるため、
// 大文字小文字と前後の空白の違いは無視する。
function matchedTerms(entry: ItemTypeKnowledgeEntry, normalizedText: string): string[] {
  return [entry.label, ...entry.variants, ...entry.relatedTerms].filter(
    (term) => normalizedText.includes(normalizeItemTypeText(term)),
  );
}

// 選択中の大分類の知識だけを、一致した手がかりの多い順に返す。一致が無ければ
// 空を返し、知識全体をAIへ送らない(「AIへ送信する情報は必要最小限にする」)。
export function findItemTypeKnowledge(
  { kindCode, limit = 4, text }: { kindCode: string; limit?: number; text: string },
): ItemTypeKnowledgeEntry[] {
  const normalizedText = normalizeItemTypeText(text);
  if (normalizedText === "") return [];
  return ITEM_TYPE_KNOWLEDGE
    .filter((entry) => entry.kindCode === kindCode)
    .map((entry) => ({ entry, hits: matchedTerms(entry, normalizedText).length }))
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
