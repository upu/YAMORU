import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { updateNicknameMock } = vi.hoisted(() => ({
  updateNicknameMock: vi.fn(),
}));

vi.mock("../app/account/actions", () => ({
  updateNickname: updateNicknameMock,
}));

import { NicknameEditForm } from "../app/account/nickname-edit-form";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NicknameEditForm(Issue #76)", () => {
  it("連続して保存に成功しても、そのたびに編集モードから表示モードへ戻る", async () => {
    // 実際のサーバーアクションは呼び出しごとに新しいオブジェクトを返す。
    // 同じオブジェクト参照を使い回すmockだと、statusの値が同じ("success")場合に
    // 変化を検知できるかを検証できないため、呼び出しごとに新しいオブジェクトを返す。
    updateNicknameMock.mockImplementation(() =>
      Promise.resolve({ message: "ニックネームを変更しました。", status: "success" }),
    );

    render(<NicknameEditForm nickname="たろう" />);

    // 1回目の編集・保存
    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(await screen.findByRole("button", { name: "編集" })).toBeInTheDocument();
    expect(screen.getByText("ニックネームを変更しました。")).toBeInTheDocument();

    // 2回目の編集・保存(バグがあると編集モードから抜けられない)
    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    expect(
      screen.queryByRole("button", { name: "編集" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(await screen.findByRole("button", { name: "編集" })).toBeInTheDocument();
  });

  it("保存に失敗した場合は編集モードにとどまり、エラーを表示する", async () => {
    updateNicknameMock.mockImplementation(() =>
      Promise.resolve({
        message: "ニックネームを変更できませんでした。時間をおいて再度お試しください。",
        status: "error",
      }),
    );

    render(<NicknameEditForm nickname="たろう" />);

    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(
      await screen.findByText(
        "ニックネームを変更できませんでした。時間をおいて再度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "変更を保存" })).toBeInTheDocument();
  });
});
