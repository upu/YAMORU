import { beforeEach, describe, expect, it, vi } from "vitest";
const { context, save, revalidate } = vi.hoisted(() => ({ context: vi.fn(), save: vi.fn(), revalidate: vi.fn() }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: context }));
vi.mock("../src/lib/d1/todos", () => ({ setTaskHardDeadline: save }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
import { setTaskHardDeadline } from "../src/features/todos/actions/hard-deadline";
beforeEach(() => { vi.clearAllMocks(); context.mockResolvedValue({ db: "db", session: "session" }); save.mockResolvedValue(undefined); });
describe("必達日の保存action", () => {
  it("過去日を暦日のまま保存し、空欄は解除する", async () => {
    expect(await setTaskHardDeadline(null, "occ", "2026-01-03", null)).toMatchObject({ status: "success" });
    expect(save).toHaveBeenCalledWith("db", "session", "occ", "2026-01-03", null);
    expect(await setTaskHardDeadline(null, "occ", "", "2026-01-03")).toMatchObject({ status: "success" });
    expect(save).toHaveBeenLastCalledWith("db", "session", "occ", null, "2026-01-03");
  });
  it("存在しない暦日は保存しない", async () => {
    expect(await setTaskHardDeadline(null, "occ", "2026-02-29", null)).toMatchObject({ status: "error" });
    expect(save).not.toHaveBeenCalled();
  });
  it("競合を成功と表示せず、再確認を案内する", async () => {
    save.mockRejectedValue(Object.assign(new Error("changed"), { code: "HARD_DEADLINE_CHANGED" }));
    const result = await setTaskHardDeadline(null, "occ", "2026-01-03", null);
    expect(result.status).toBe("error");
    expect(result.message).toContain("再読み込み");
    expect(revalidate).not.toHaveBeenCalled();
  });
});
