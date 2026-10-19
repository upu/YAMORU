// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationSettingsForm } from "../src/app/settings/notifications/settings-form";
import { DeliveryHistoryList } from "../src/app/settings/notifications/delivery-history";
import { DEFAULT_SETTINGS } from "../src/features/integration/notifications/contract";
vi.mock("../src/app/settings/notifications/actions", () => ({ saveNotificationAction: vi.fn(), candidateControlAction: vi.fn() }));
afterEach(cleanup);
it("初期値と本人の通知先を専門的な入力なしで選べる", () => {
  render(<NotificationSettingsForm settings={DEFAULT_SETTINGS} revision={0} connections={[{ id: "a", name: "Assistant" }]} nextAt="2026-10-17T00:00:00.000Z" />);
  expect(screen.getByLabelText("連携先の定期確認でお知らせを受け取る")).not.toBeChecked();
  expect(screen.getByLabelText("まとめる時刻")).toHaveValue("09:00");
  expect(screen.getByRole("option", { name: "Assistant" })).toBeInTheDocument();
  expect(screen.getByLabelText("優先度が高い用事の間隔（時間）")).toHaveValue(null);
  expect(screen.getByText(/必達日を過ぎた用事でも/)).toBeInTheDocument();
});
it("受領と案内報告を既読にせず、不明なら重複再送を避ける案内を出す", () => {
  const base = { deliveryId: "d", candidateId: "c", candidateName: "フィルター", connectionId: "a", recordedAt: "2026-10-17T00:00:00.000Z", reason: null };
  render(<DeliveryHistoryList timeZone="Asia/Tokyo" items={[{ ...base, sequence: 1, outcome: "accepted" }, { ...base, sequence: 2, outcome: "reported" }, { ...base, sequence: 3, outcome: "unknown" }]} />);
  expect(screen.getByText("連携先がイベントを受領")).toBeInTheDocument();
  expect(screen.getByText("連携先が案内したと報告")).toBeInTheDocument();
  expect(screen.getByText(/利用者が読んだことを示すものではありません/)).toBeInTheDocument();
  expect(screen.getByText(/重複するおそれがあるため自動再送/)).toBeInTheDocument();
});
it("通知できる時刻がないときは時刻の代わりに設定の確認を案内する", () => {
  const { container } = render(<NotificationSettingsForm settings={DEFAULT_SETTINGS} revision={0} connections={[]} nextAt={null} />);
  expect(container.querySelector("time")).toBeNull();
  expect(screen.getByText(/保存済みの条件では、お知らせの取得を停止しています/)).toBeInTheDocument();
});
it("利用可能な接続がないときは新規ONを提示せず、準備へ案内する", () => {
  render(<NotificationSettingsForm settings={DEFAULT_SETTINGS} revision={0} connections={[]} nextAt={null} />);
  expect(screen.queryByLabelText("連携先の定期確認でお知らせを受け取る")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "定期的なお知らせの準備へ" })).toHaveAttribute("href", "/settings/integrations/guide#periodic-title");
  expect(new FormData(screen.getByRole<HTMLFormElement>("form", { name: "お知らせの条件" })).has("enabled")).toBe(false);
});
it("受け取り先が失効しても保存済みのONをOFFに戻せる", () => {
  render(<NotificationSettingsForm settings={{ ...DEFAULT_SETTINGS, enabled: true, connectionId: "old" }} revision={3} connections={[]} nextAt={null} />);
  const toggle = screen.getByLabelText("連携先の定期確認でお知らせを受け取る");
  expect(toggle).toBeChecked();
  expect(screen.getByRole("option", { name: "以前の連携先（現在は利用できません）" })).toHaveValue("old");
  fireEvent.click(toggle);
  const submitted = new FormData(screen.getByRole<HTMLFormElement>("form", { name: "お知らせの条件" }));
  expect(submitted.has("enabled")).toBe(false);
  expect(submitted.get("connectionId")).toBe("old");
});
