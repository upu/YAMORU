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

import { D1ConflictError, type D1ErrorCode } from "../src/lib/d1/errors";
import {
  setTaskOccurrenceSchedule,
  unsetTaskOccurrenceSchedule,
} from "../src/features/todos/actions/schedule";

// Issue #369: 案内の選択はD1層の識別コードだけで決まる。内部の英文メッセージを
// 判定に使っていないことを確かめるため、実際とは違う英文を持たせる。
function d1Error(code: D1ErrorCode): Error {
  return new D1ConflictError("internal detail that must not reach the screen", code);
}


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
    // 予定日を未定へ戻したTodoは、ホームだけでなくTodo一覧にも残る(Issue #201)。
    expect(revalidatePathMock).toHaveBeenCalledWith("/todos");
    expect(result).toEqual({ message: "予定日を未定に戻しました。", status: "success" });
  });

  it("不正な日付はD1へ送らない", async () => {
    const result = await setTaskOccurrenceSchedule(null, "occurrence-id", "not-a-date");

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "予定日を正しく入力してください。", status: "error" });
  });

  it.each<[D1ErrorCode, string]>([
    ["OCCURRENCE_NOT_PENDING", "他の操作で状態が変わりました。最新の状態を確認してください。"],
    ["UNDATED_SCHEDULE_REQUIRES_ONE_TIME", "繰り返しTodoの予定日は未定にできません。"],
  ])("D1の識別コード %s を利用者向け案内へ変換する", async (code, expected) => {
    setOneTimeTaskScheduleMock.mockRejectedValue(d1Error(code));

    const result = await unsetTaskOccurrenceSchedule(null, "occurrence-id");

    expect(result).toEqual({ message: expected, status: "error" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
