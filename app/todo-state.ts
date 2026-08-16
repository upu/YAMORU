export type TodoActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

export const INITIAL_TODO_STATE: TodoActionState = {
  message: "",
  status: "idle",
};
