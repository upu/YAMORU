// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/settings/integrations/operations/[previewId]/confirm/actions", () => ({ decideOperationAction: vi.fn() }));

import { ConfirmationActions } from "../src/app/settings/integrations/operations/[previewId]/confirm/confirmation-actions";
import { PreviewDetails } from "../src/app/settings/integrations/operations/[previewId]/confirm/preview-details";

afterEach(cleanup);

// 外部commandの追加確認画面(YDR-062)。変わった内容を読める形で示し、承認・拒否は
// POSTのフォームだけで送る。
describe("追加確認画面", () => {
  it("対象・変更前後・次回への影響を表示する", () => {
    render(<PreviewDetails preview={JSON.stringify({
      affected_entities: [{ change: "reschedule", id: "occ", kind: "todo_occurrence", title: "ごみ出し" }],
      diff: { due_on: { from: "2027-01-06", to: "2026-10-14" } },
      schedule_effect: { current_occurrence: { due_on: "2026-10-14", scheduled_on: null } },
    })} />);
    expect(screen.getByText(/ごみ出し/u)).toHaveTextContent("ごみ出し(Todo(今回))");
    expect(screen.getAllByText("期限")[0]?.nextElementSibling).toHaveTextContent("2027-01-06 → 2026-10-14");
    expect(screen.getByText("予定日").nextElementSibling).toHaveTextContent("未設定");
  });

  it("承認と取りやめを、preview IDを持つPOSTのフォームで送る", () => {
    const { container } = render(<ConfirmationActions previewId="preview-1" />);
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(container.querySelector("input[name=previewId]")).toHaveValue("preview-1");
    expect(screen.getByRole("button", { name: "この内容で承認する" })).toHaveAttribute("value", "approve");
    expect(screen.getByRole("button", { name: "取りやめる" })).toHaveAttribute("value", "deny");
  });
});
