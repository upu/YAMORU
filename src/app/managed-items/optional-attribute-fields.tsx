import { splitPurchaseDate } from "./purchase-date";

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

// 「わからない」を既定に持つ数値の選択肢。分からない精度を空のまま残せる。
function UnknownableSelect({
  defaultValue,
  id,
  label,
  name,
  values,
}: {
  defaultValue: string;
  id: string;
  label: string;
  name: string;
  values: number[];
}) {
  return (
    <span>
      <label htmlFor={id}>{label}</label>
      <select defaultValue={defaultValue} id={id} name={name}>
        <option value="">わからない</option>
        {values.map((value) => (
          <option key={value} value={String(value).padStart(2, "0")}>
            {value}
          </option>
        ))}
      </select>
    </span>
  );
}

// Issue #42: 購入時期は年・月・日を別々の欄に分け、月日を「わからない」の
// まま残せるようにする。一つの日付入力にすると、年しか覚えていない対象へ
// 偽の月日を埋めさせてしまう。
function PurchaseDateFields({
  idPrefix,
  purchasedOn,
}: {
  idPrefix: string;
  purchasedOn: string | null;
}) {
  const parts = splitPurchaseDate(purchasedOn);
  return (
    <fieldset className="purchase-date-fieldset">
      <legend>購入時期（任意）</legend>
      <p className="purchase-date-help" id={`${idPrefix}-purchased-help`}>
        分かる範囲だけで入力できます。年だけ、年と月だけでもかまいません。
      </p>
      <div className="purchase-date-inputs">
        <span>
          <label htmlFor={`${idPrefix}-purchased-year`}>年</label>
          <input
            aria-describedby={`${idPrefix}-purchased-help`}
            autoComplete="off"
            defaultValue={parts.year}
            id={`${idPrefix}-purchased-year`}
            inputMode="numeric"
            maxLength={4}
            name="purchasedYear"
            placeholder="2024"
            type="text"
          />
        </span>
        <UnknownableSelect
          defaultValue={parts.month}
          id={`${idPrefix}-purchased-month`}
          label="月"
          name="purchasedMonth"
          values={MONTHS}
        />
        <UnknownableSelect
          defaultValue={parts.day}
          id={`${idPrefix}-purchased-day`}
          label="日"
          name="purchasedDay"
          values={DAYS}
        />
      </div>
    </fieldset>
  );
}

// Issue #42: 台帳での名前(家庭内での呼び名)とは別に、購入した商品を
// 見分けるための情報とメモを任意で残す。型番だけを必須の項目にすると
// 正確な型番が分からない対象で入力しづらいため、一つの自由入力にする。
export function ManagedItemOptionalAttributeFields({
  idPrefix,
  note = null,
  productInfo = null,
  purchasedOn = null,
}: {
  idPrefix: string;
  note?: string | null;
  productInfo?: string | null;
  purchasedOn?: string | null;
}) {
  return (
    <>
      <label htmlFor={`${idPrefix}-product-info`}>
        メーカー・商品名など（任意）
      </label>
      <input
        aria-describedby={`${idPrefix}-product-info-help`}
        autoComplete="off"
        defaultValue={productInfo ?? ""}
        id={`${idPrefix}-product-info`}
        maxLength={200}
        name="productInfo"
        placeholder="例: 三菱 霧ヶ峰 MSZ-0000"
        type="text"
      />
      <p id={`${idPrefix}-product-info-help`}>
        上の「名前」は家庭内での呼び名です。こちらにはメーカー名、商品名、型番など、
        購入した商品を見分けるための情報を分かる範囲で書けます。
      </p>

      <PurchaseDateFields idPrefix={idPrefix} purchasedOn={purchasedOn} />

      <label htmlFor={`${idPrefix}-note`}>メモ（任意）</label>
      <textarea
        aria-describedby={`${idPrefix}-note-help`}
        defaultValue={note ?? ""}
        id={`${idPrefix}-note`}
        maxLength={1000}
        name="note"
        rows={4}
      />
      <p id={`${idPrefix}-note-help`}>
        置き場所や使い方など、家庭で残しておきたいことを自由に書けます。
      </p>
    </>
  );
}
