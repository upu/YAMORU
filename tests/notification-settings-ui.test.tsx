// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationSettingsForm } from "../src/app/settings/notifications/settings-form";
import { DeliveryHistoryList } from "../src/app/settings/notifications/delivery-history";
import { DEFAULT_SETTINGS } from "../src/features/integration/notifications/contract";
vi.mock("../src/app/settings/notifications/actions", () => ({ saveNotificationAction: vi.fn(), candidateControlAction: vi.fn() }));
afterEach(cleanup);
it("初期値と本人の通知先を専門的な入力なしで選べる", () => {
  render(<NotificationSettingsForm settings={DEFAULT_SETTINGS} revision={0} connections={[{ id: "a", name: "Assistant" }]} nextAt="2026-10-17T00:00:00.000Z" />);
  expect(screen.getByLabelText("通知を有効にする")).not.toBeChecked();
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
  expect(screen.getByText(/現在は通知を受け取れません/)).toBeInTheDocument();
});
