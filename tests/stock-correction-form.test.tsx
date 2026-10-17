import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/app/consumables/history-actions", () => ({ correctStockHistory: vi.fn() }));
import { StockCorrectionForm } from "../src/app/consumables/stock-correction-form";
import { stockOccurredLabel, stockRecordedLabel } from "../src/app/consumables/stock-history-labels";
import type { StockRecord } from "../src/lib/d1/consumable-stock-read";
afterEach(cleanup);
const record: StockRecord = { recordId: "r", eventId: "r", revision: 0, kind: "refill", occurredOn: "2026-10-17", occurredAt: null,
  status: "available", recordedAt: "2026-10-17T00:00:00.000Z", voided: false, rootSequence: 1, refillId: "f", performerId: null };
it("補充の訂正では在庫状態を補完せず、変更する項目と現在観測を別に選べる", () => {
  render(<StockCorrectionForm record={record} consumableId="c" stockRevision={1} members={[{ nickname: "家族", userId: "a" }]} />);
  expect(screen.getByLabelText("訂正する項目")).not.toContainHTML('value="status"');
  expect(screen.getByLabelText("現在の在庫も確認した場合")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("訂正する項目"), { target: { value: "performer" } });
  expect(screen.getByLabelText("実施者")).toHaveValue("");
  expect(screen.queryByLabelText("正しい実施日")).not.toBeInTheDocument();
});
it("既存の壊れた日付や保存状態を架空の観測日へ置き換えない", () => {
  expect(stockOccurredLabel(null, null)).toBe("観測日不明");
  expect(stockOccurredLabel("2026-02-30", null)).toBe("観測日不明");
  expect(stockRecordedLabel("invalid")).toBe("記録日時不明");
});
