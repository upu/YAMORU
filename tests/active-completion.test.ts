import { describe, expect, it } from "vitest";

import { selectActiveCompletionLogs } from "../app/active-completion";

describe("現在有効な完了ログの選択", () => {
  it("completedのOccurrenceではrecorded_atが最新の完了だけを選ぶ", () => {
    const selected = selectActiveCompletionLogs([
      {
        activity_logs: [
          {
            action: "completed",
            id: "cancelled",
            occurred_at: "2026-08-10T00:00:00.000Z",
            recorded_at: "2026-08-10T01:00:00.000Z",
          },
          {
            action: "completion_undone",
            id: "undo",
            occurred_at: "2026-08-11T00:00:00.000Z",
            recorded_at: "2026-08-11T00:00:00.000Z",
          },
          {
            action: "completed",
            id: "active",
            occurred_at: "2026-08-09T00:00:00.000Z",
            recorded_at: "2026-08-12T00:00:00.000Z",
          },
        ],
        status: "completed",
      },
    ]);

    expect(selected).toEqual([
      expect.objectContaining({ id: "active", occurred_at: "2026-08-09T00:00:00.000Z" }),
    ]);
  });

  it("pendingへ戻ったOccurrenceの完了ログは選ばない", () => {
    const selected = selectActiveCompletionLogs([
      {
        activity_logs: [
          {
            action: "completed",
            id: "cancelled",
            occurred_at: "2026-08-10T00:00:00.000Z",
            recorded_at: "2026-08-10T01:00:00.000Z",
          },
        ],
        status: "pending",
      },
    ]);

    expect(selected).toEqual([]);
  });
});
