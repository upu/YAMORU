import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStockAction } from "../src/app/consumables/use-stock-action";
afterEach(cleanup);
it("通信失敗の再試行では同じ操作IDを使い、成功後の別操作には新しいIDを使う", async () => {
  const ids: FormDataEntryValue[] = [];
  const action = vi.fn((_previous: unknown, form: FormData) => {
    ids.push(form.get("operationId") ?? "");
    expect(form.get("stockRevision")).toBe("4");
    return Promise.resolve({ status: ids.length < 2 ? "error" as const : "success" as const, message: String(ids.length) });
  });
  function Harness() {
    const [state, submit] = useStockAction(action, 4);
    return <form action={submit} aria-label="在庫"><input type="hidden" name="stockStatus" value="low" /><button>記録</button><p>{state.message}</p></form>;
  }
  render(<Harness />);
  for (let count = 1; count <= 3; count += 1) {
    fireEvent.submit(screen.getByRole("form", { name: "在庫" }));
    await waitFor(() => { expect(screen.getByText(String(count))).toBeInTheDocument(); });
  }
  expect(ids[0]).toBe(ids[1]);
  expect(ids[2]).not.toBe(ids[1]);
});
