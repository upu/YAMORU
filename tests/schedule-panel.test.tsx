import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setTaskOccurrenceScheduleMock, unsetTaskOccurrenceScheduleMock } = vi.hoisted(() => ({
  setTaskOccurrenceScheduleMock: vi.fn(),
  unsetTaskOccurrenceScheduleMock: vi.fn(),
}));

vi.mock("../src/app/managed-items/[id]/actions", () => ({
  setTaskOccurrenceSchedule: setTaskOccurrenceScheduleMock,
  unsetTaskOccurrenceSchedule: unsetTaskOccurrenceScheduleMock,
}));

import { SchedulePanel } from "../src/app/managed-items/[id]/schedule-panel";

afterEach(cleanup);

describe("SchedulePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未定Todoは具体日を設定できる", () => {
    setTaskOccurrenceScheduleMock.mockResolvedValue({
      message: "予定日を2026年9月1日に設定しました。",
      status: "success",
    });
    render(
      <SchedulePanel
        managedItemId={null}
        occurrenceId="occurrence-1"
        scheduledFor={null}
        taskTitle="通知書が届いたら申請"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "通知書が届いたら申請の予定日を設定する" }));
    fireEvent.change(screen.getByLabelText("予定日"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "この日を予定日にする" }));

    expect(setTaskOccurrenceScheduleMock).toHaveBeenCalledWith(
      null, "occurrence-1", "2026-09-01",
    );
  });

  it("具体日があるTodoは確認後に未定へ戻せる", () => {
    unsetTaskOccurrenceScheduleMock.mockResolvedValue({
      message: "予定日を未定に戻しました。",
      status: "success",
    });
    render(
      <SchedulePanel
        managedItemId="item-1"
        occurrenceId="occurrence-1"
        scheduledFor="2026-08-31T15:00:00.000Z"
        taskTitle="申請"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "申請の予定日を未定に戻す" }));
    expect(screen.getByRole("dialog", { name: "申請の予定日を未定に戻す" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "予定日を未定に戻す" }));

    expect(unsetTaskOccurrenceScheduleMock).toHaveBeenCalledWith("item-1", "occurrence-1");
  });
});
