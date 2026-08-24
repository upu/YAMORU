import { beforeEach, describe, expect, it, vi } from "vitest";

const { getD1ContextMock, revalidatePathMock, setOneTimeTaskScheduleMock } = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  setOneTimeTaskScheduleMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({
  setOneTimeTaskSchedule: setOneTimeTaskScheduleMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
  setTaskOccurrenceSchedule,
  unsetTaskOccurrenceSchedule,
} from "../src/app/managed-items/[id]/actions";

describe("一回限りTodoの予定日変更", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    setOneTimeTaskScheduleMock.mockResolvedValue(undefined);
  });

  it("具体日をAsia/Tokyoの日付としてD1へ渡す", async () => {
    const result = await setTaskOccurrenceSchedule(null, "occurrence-id", "2026-09-01");

    expect(setOneTimeTaskScheduleMock).toHaveBeenCalledWith(
      "db", "session", "occurrence-id", "2026-08-31T15:00:00.000Z",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ message: "予定日を2026年9月1日に設定しました。", status: "success" });
  });

  it("予定日を未定へ戻す", async () => {
    const result = await unsetTaskOccurrenceSchedule("item-1", "occurrence-id");

    expect(setOneTimeTaskScheduleMock).toHaveBeenCalledWith(
      "db", "session", "occurrence-id", null,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/item-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({ message: "予定日を未定に戻しました。", status: "success" });
  });

  it("不正な日付はD1へ送らない", async () => {
    const result = await setTaskOccurrenceSchedule(null, "occurrence-id", "not-a-date");

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "予定日を正しく入力してください。", status: "error" });
  });

  it.each([
    ["Occurrence is not pending", "他の操作で状態が変わりました。最新の状態を確認してください。"],
    ["Only one-time tasks can have an undated schedule", "繰り返しTodoの予定日は未定にできません。"],
  ])("D1の既知エラー %s を利用者向け案内へ変換する", async (message, expected) => {
    setOneTimeTaskScheduleMock.mockRejectedValue(new Error(message));

    const result = await unsetTaskOccurrenceSchedule(null, "occurrence-id");

    expect(result).toEqual({ message: expected, status: "error" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
