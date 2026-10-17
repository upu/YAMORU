export type ConfirmOperationState = {
  message: string;
  status: "done" | "error" | "idle";
};

export const INITIAL_CONFIRM_OPERATION_STATE: ConfirmOperationState = {
  message: "",
  status: "idle",
};
