export type MaintenanceTodoActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

export const INITIAL_MAINTENANCE_TODO_STATE: MaintenanceTodoActionState = {
  message: "",
  status: "idle",
};
