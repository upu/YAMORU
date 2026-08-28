import { startedOnLabel } from "./model";
import { splitStartedOn } from "./started-on";

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

// Issue #42: 開始時期は年・月・日を別々の欄に分け、月日を「わからない」の
// まま残せるようにする。一つの日付入力にすると、年しか覚えていない対象へ
// 偽の月日を埋めさせてしまう。
// Issue #239: 見出し語は大分類(kindCode)に応じて変える(YDR-033)。モノでは
// 「購入時期」、サービスでは「利用・契約を始めた時期」、それ以外は
// 「開始時期」。保存する値の意味自体は大分類によらず同じ。
function StartedOnFields({
  idPrefix,
  kindCode,
  startedOn,
}: {
  idPrefix: string;
  kindCode: string;
  startedOn: string | null;
}) {
  const parts = splitStartedOn(startedOn);
  const label = startedOnLabel(kindCode);
  return (
    <fieldset className="started-on-fieldset">
      <legend>{label}（任意）</legend>
      <p className="started-on-help" id={`${idPrefix}-started-help`}>
        分かる範囲だけで入力できます。年だけ、年と月だけでもかまいません。
      </p>
      <div className="started-on-inputs">
        <span>
          <label htmlFor={`${idPrefix}-started-year`}>年</label>
          <input
            aria-describedby={`${idPrefix}-started-help`}
            autoComplete="off"
            defaultValue={parts.year}
            id={`${idPrefix}-started-year`}
            inputMode="numeric"
            maxLength={4}
            name="startedYear"
            placeholder="2024"
            type="text"
          />
        </span>
        <UnknownableSelect
          defaultValue={parts.month}
          id={`${idPrefix}-started-month`}
          label="月"
          name="startedMonth"
          values={MONTHS}
        />
        <UnknownableSelect
          defaultValue={parts.day}
          id={`${idPrefix}-started-day`}
          label="日"
          name="startedDay"
          values={DAYS}
        />
      </div>
    </fieldset>
  );
}

// Issue #42: 家庭内での呼び名(name)とは別に、購入した商品を
// 見分けるための情報とメモを任意で残す。型番だけを必須の項目にすると
// 正確な型番が分からない対象で入力しづらいため、一つの自由入力にする。
export function ManagedItemOptionalAttributeFields({
  idPrefix,
  kindCode,
  note = null,
  productInfo = null,
  startedOn = null,
}: {
  idPrefix: string;
  kindCode: string;
  note?: string | null;
  productInfo?: string | null;
  startedOn?: string | null;
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
        メーカー名、商品名、型番など、購入した商品を見分けるための情報を
        分かる範囲で書けます。型番だけを正確に入力する必要はありません。
      </p>

      <StartedOnFields idPrefix={idPrefix} kindCode={kindCode} startedOn={startedOn} />

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
