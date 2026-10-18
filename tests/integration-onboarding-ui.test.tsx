// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { IntegrationGuide } from "../src/app/settings/integrations/guide/integration-guide";
import { NotificationDeliveryStatus } from "../src/app/settings/notifications/delivery-status";
import { DEFAULT_SETTINGS } from "../src/features/integration/notifications/contract";

afterEach(cleanup);
it("現在のYAMORUの接続先だけを示し、初回同意・無害なテストと停止へ案内する", () => {
  render(<IntegrationGuide endpoint="https://fictional.example.test/mcp" />);
  expect(screen.getByText("https://fictional.example.test/mcp")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "会話連携の始め方" })).toBeInTheDocument();
  expect(screen.getByText(/パスワードや認証コードを会話へ貼らない/)).toBeInTheDocument();
  expect(screen.getByText(/予定や完了を変更せず/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "通知設定と配信履歴" })).toHaveAttribute("href", "/settings/notifications");
  expect(screen.getByText(/15分ぴったりの起動や到達時刻は保証されません/)).toBeInTheDocument();
  expect(screen.getByText(/YAMORUから外部の定期タスクは作成・停止しません/)).toBeInTheDocument();
});
it("新規受付が無効なら接続できると案内せず、管理者への確認を示す", () => {
  render(<IntegrationGuide endpoint={null} />);
  expect(screen.getByText(/新しい外部サービスとの連携を受け付けていません/)).toBeInTheDocument();
  expect(screen.queryByText(/https:\/\//)).not.toBeInTheDocument();
});
it("設定のONと定期タスクの稼働確認を区別する", () => {
  render(<NotificationDeliveryStatus settings={{ ...DEFAULT_SETTINGS, enabled: true, connectionId: "a" }} connectionAvailable />);
  expect(screen.getByText("通知設定は有効です。")).toBeInTheDocument();
  expect(screen.getByText(/外部の定期タスクの稼働状態はYAMORUから確認できません/)).toBeInTheDocument();
  expect(screen.getByText(/保存するだけでは定期タスクは作成されません/)).toBeInTheDocument();
});
it.each([
  { settings: DEFAULT_SETTINGS, available: false, message: "通知設定はOFFです。" },
  { settings: { ...DEFAULT_SETTINGS, enabled: true, muted: true }, available: true, message: "あなたへの通知を休止中です。" },
  { settings: { ...DEFAULT_SETTINGS, enabled: true, connectionId: "old" }, available: false, message: "通知先の連携・許可を確認してください。" },
])("保存済み状態を正しく伝える: $message", ({ settings, available, message }) => {
  render(<NotificationDeliveryStatus settings={settings} connectionAvailable={available} />);
  expect(screen.getByText(message)).toBeInTheDocument();
});
