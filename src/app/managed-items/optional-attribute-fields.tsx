import { tokyoYearFromIso } from "../time-zone";
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
// Issue #239: 見出し語は大分類(kindCode)に応じて変える(YDR-033)。備品では
// 「購入時期」、サービスでは「利用・契約を始めた時期」、それ以外は
// 「開始時期」。保存する値の意味自体は大分類によらず同じ。
function StartedOnFields({
  idPrefix,
  kindCode,
  nowIso,
  startedOn,
}: {
  idPrefix: string;
  kindCode: string;
  nowIso: string;
  startedOn: string | null;
}) {
  const parts = splitStartedOn(startedOn);
  const label = startedOnLabel(kindCode);
  // Issue #287: 固定の古い年(2024)ではなく、その時点の現在年を例として
  // 示す。値そのものは自動入力しない(空のまま)。
  const currentYear = tokyoYearFromIso(nowIso);
  return (
    <fieldset className="started-on-fieldset">
      <legend>{label}（任意）</legend>
      {/* Issue #393: 月日の「わからない」は選択肢自体が示すため繰り返さず、
      年だけでも登録できることだけを残す。 */}
      <p className="started-on-help" id={`${idPrefix}-started-help`}>
        年だけ、年と月だけでもかまいません。
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
            placeholder={`例: ${String(currentYear)}`}
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
  // Issue #287: 呼び出し元(Server Component)がAsia/Tokyo基準の現在時刻を
  // 渡す。渡されない場合(単体テストなど)はブラウザ実行時刻へ落ちる。
  nowIso = new Date().toISOString(),
  productInfo = null,
  startedOn = null,
}: {
  idPrefix: string;
  kindCode: string;
  note?: string | null;
  nowIso?: string;
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
      {/* Issue #393: 何を書く欄かはラベルとplaceholderで分かるため、ここには
      「正確な型番でなくてよい」という判断材料だけを残す。 */}
      <p id={`${idPrefix}-product-info-help`}>
        正確な型番が分からなくても、分かる範囲で書けます。
      </p>

      <StartedOnFields
        idPrefix={idPrefix}
        kindCode={kindCode}
        nowIso={nowIso}
        startedOn={startedOn}
      />

      {/* Issue #393: 自由記述であることはラベルから分かるため、補足文をやめて
      例だけをplaceholderで示す(消耗品のメモ欄と同じ形)。 */}
      <label htmlFor={`${idPrefix}-note`}>メモ（任意）</label>
      <textarea
        defaultValue={note ?? ""}
        id={`${idPrefix}-note`}
        maxLength={1000}
        name="note"
        placeholder="例: 置き場所や使い方"
        rows={4}
      />
    </>
  );
}
