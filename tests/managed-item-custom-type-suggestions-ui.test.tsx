import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  getManagedItemForEditMock,
  listHouseholdCustomItemTypesMock,
  listManagedItemClassificationOptionsMock,
  loadAccountStateMock,
  requireUserMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  getManagedItemForEditMock: vi.fn(),
  listHouseholdCustomItemTypesMock: vi.fn(),
  listManagedItemClassificationOptionsMock: vi.fn(),
  loadAccountStateMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock("../src/auth", () => ({ auth: vi.fn() }));
vi.mock("../src/lib/auth/current-user", () => ({ requireUser: requireUserMock }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/households", () => ({ loadAccountState: loadAccountStateMock }));
vi.mock("../src/lib/d1/managed-items", () => ({
  getManagedItemForEdit: getManagedItemForEditMock,
  listHouseholdCustomItemTypes: listHouseholdCustomItemTypesMock,
  listManagedItemClassificationOptions: listManagedItemClassificationOptionsMock,
}));

import ManagedItemEditPage from "../src/app/managed-items/[id]/edit/page";
import { ManagedItemEditForm } from "../src/app/managed-items/[id]/edit/managed-item-edit-form";
import ManagedItemRegistrationPage, {
  ManagedItemRegistrationContent,
} from "../src/app/managed-items/new/page";

const CLASSIFICATION_OPTIONS = {
  itemTypes: [
    { code: "appliance", kindCode: "asset", label: "家電" },
    { code: "contract", kindCode: "service", label: "契約" },
  ],
  kinds: [
    { code: "asset", label: "備品" },
    { code: "service", label: "サービス" },
  ],
};

// Issue #288: 家庭内で使用中の自由入力の詳しい種類(listHouseholdCustomItemTypes
// が返す形)。表記揺れの例として「放課後デイサービス」を含める。
const CUSTOM_TYPE_OPTIONS = [
  { kindCode: "asset", label: "虫かご" },
  { kindCode: "service", label: "放課後デイサービス" },
  { kindCode: "service", label: "ピアノ教室" },
];

function renderRegistrationForm(
  customItemTypeOptions: { kindCode: string; label: string }[] = CUSTOM_TYPE_OPTIONS,
) {
  render(
    <ManagedItemRegistrationContent
      classificationOptions={CLASSIFICATION_OPTIONS}
      customItemTypeOptions={customItemTypeOptions}
      household={{ id: "household-1", name: "テスト家庭" }}
    />,
  );
}

function chooseCustomItemType() {
  fireEvent.change(screen.getByLabelText("詳しい種類（任意）"), {
    target: { value: "__custom__" },
  });
}

function selectKind(kindCode: string) {
  fireEvent.change(screen.getByLabelText("大分類"), { target: { value: kindCode } });
}

function suggestionGroup() {
  return screen.getByRole("group", { name: "使用中の詳しい種類から選ぶ" });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "user-1" });
  getD1ContextMock.mockResolvedValue({ db: {}, session: { userId: "user-1" } });
  loadAccountStateMock.mockResolvedValue({
    household: { id: "household-1", name: "テスト家庭" },
    nickname: "ぽっぷ",
  });
  listManagedItemClassificationOptionsMock.mockResolvedValue(CLASSIFICATION_OPTIONS);
  listHouseholdCustomItemTypesMock.mockResolvedValue(CUSTOM_TYPE_OPTIONS);
});

afterEach(cleanup);

describe("登録・編集の自由入力(詳しい種類)候補(Issue #288)", () => {
  it("「その他（自由入力）」を選ぶと、選択中の大分類で使用中の候補を並べる", () => {
    renderRegistrationForm();
    selectKind("service");
    chooseCustomItemType();

    const group = suggestionGroup();
    expect(within(group).getByRole("button", { name: "放課後デイサービス" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "ピアノ教室" })).toBeInTheDocument();
    // 別の大分類でだけ使われている候補は混ぜない(プリセットの詳しい種類と同じ扱い)。
    expect(within(group).queryByRole("button", { name: "虫かご" })).not.toBeInTheDocument();
    expect(screen.getByText("使用中の種類が2件あります。選ぶと入力欄へ入ります。"))
      .toBeInTheDocument();
  });

  it("候補を選ぶと自由入力欄へ入り、そのまま送信できる", () => {
    renderRegistrationForm();
    selectKind("service");
    chooseCustomItemType();

    const input = screen.getByLabelText("詳しい種類を入力");
    expect(input).toHaveValue("");
    fireEvent.click(within(suggestionGroup()).getByRole("button", { name: "放課後デイサービス" }));

    expect(input).toHaveValue("放課後デイサービス");
    expect(input).toHaveAttribute("name", "customItemType");
    expect(input).toHaveAttribute("maxLength", "50");
  });

  it("入力した文字で候補を絞り込み、前後の空白と大文字小文字の違いは無視する", () => {
    renderRegistrationForm([
      { kindCode: "service", label: "放課後デイサービス" },
      { kindCode: "service", label: "IoT見守りサービス" },
      { kindCode: "service", label: "ピアノ教室" },
    ]);
    selectKind("service");
    chooseCustomItemType();
    const input = screen.getByLabelText("詳しい種類を入力");

    fireEvent.change(input, { target: { value: "放課後" } });
    expect(within(suggestionGroup()).getByRole("button", { name: "放課後デイサービス" }))
      .toBeInTheDocument();
    expect(within(suggestionGroup()).queryByRole("button", { name: "ピアノ教室" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("使用中の種類が1件あります。選ぶと入力欄へ入ります。"))
      .toBeInTheDocument();

    fireEvent.change(input, { target: { value: "  IOT  " } });
    expect(within(suggestionGroup()).getByRole("button", { name: "IoT見守りサービス" }))
      .toBeInTheDocument();
  });

  it("一致する候補がなくても、新しい種類をそのまま入力できる", () => {
    renderRegistrationForm();
    selectKind("service");
    chooseCustomItemType();
    const input = screen.getByLabelText("詳しい種類を入力");

    fireEvent.change(input, { target: { value: "訪問リハビリ" } });

    expect(input).toHaveValue("訪問リハビリ");
    expect(screen.queryByRole("group", { name: "使用中の詳しい種類から選ぶ" }))
      .not.toBeInTheDocument();
    expect(
      screen.getByText("入力中の文字に一致する使用中の種類はありません。新しい種類として入力できます。"),
    ).toBeInTheDocument();
  });

  it("使用中の自由入力がまだない大分類では、候補欄を出さずに案内だけ表示する", () => {
    renderRegistrationForm([]);
    chooseCustomItemType();

    expect(screen.queryByRole("group", { name: "使用中の詳しい種類から選ぶ" }))
      .not.toBeInTheDocument();
    expect(
      screen.getByText("この大分類で使用中の自由入力の種類はまだありません。新しい種類として入力できます。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("詳しい種類を入力")).toHaveValue("");
  });

  it("プリセットの詳しい種類を選んでいる間は候補欄を出さない", () => {
    renderRegistrationForm();

    expect(screen.queryByLabelText("詳しい種類を入力")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "使用中の詳しい種類から選ぶ" }))
      .not.toBeInTheDocument();
  });

  it("編集画面では保存済みの自由入力を初期値にしたまま、候補から選び直せる", () => {
    render(
      <ManagedItemEditForm
        classificationOptions={CLASSIFICATION_OPTIONS}
        customItemType="放課後デイ"
        customItemTypeOptions={CUSTOM_TYPE_OPTIONS}
        externalUrl={null}
        id="item-1"
        itemTypeCode={null}
        kindCode="service"
        name="放課後等デイサービスB"
        note={null}
        productInfo={null}
        startedOn={null}
      />,
    );

    const input = screen.getByLabelText("詳しい種類を入力");
    expect(input).toHaveValue("放課後デイ");
    // 初期値で候補を絞り込むため、一致する候補だけを出す。
    expect(within(suggestionGroup()).getByRole("button", { name: "放課後デイサービス" }))
      .toBeInTheDocument();
    expect(within(suggestionGroup()).queryByRole("button", { name: "ピアノ教室" }))
      .not.toBeInTheDocument();

    fireEvent.click(within(suggestionGroup()).getByRole("button", { name: "放課後デイサービス" }));
    expect(input).toHaveValue("放課後デイサービス");
  });
});

describe("自由入力候補の取得(Issue #288)", () => {
  it("登録画面は自家庭の候補だけを取得してフォームへ渡す", async () => {
    render(await ManagedItemRegistrationPage());

    expect(listHouseholdCustomItemTypesMock).toHaveBeenCalledWith({}, { userId: "user-1" });
    selectKind("service");
    chooseCustomItemType();
    expect(within(suggestionGroup()).getByRole("button", { name: "放課後デイサービス" }))
      .toBeInTheDocument();
  });

  it("家庭未所属の利用者では家庭専用データの取得を呼ばない", async () => {
    loadAccountStateMock.mockResolvedValue({ household: null, nickname: null });

    render(await ManagedItemRegistrationPage());

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    expect(listHouseholdCustomItemTypesMock).not.toHaveBeenCalled();
    expect(listManagedItemClassificationOptionsMock).not.toHaveBeenCalled();
  });

  it("編集画面も自家庭の候補だけを取得してフォームへ渡す", async () => {
    getManagedItemForEditMock.mockResolvedValue({
      customItemType: "放課後デイ",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "service",
      name: "放課後等デイサービスA",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    render(await ManagedItemEditPage({ params: Promise.resolve({ id: "item-1" }) }));

    expect(listHouseholdCustomItemTypesMock).toHaveBeenCalledWith({}, { userId: "user-1" });
    expect(within(suggestionGroup()).getByRole("button", { name: "放課後デイサービス" }))
      .toBeInTheDocument();
  });
});
