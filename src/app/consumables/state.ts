export type ConsumableActionState = {
  message: string;
  status: "error" | "idle";
};

export const INITIAL_CONSUMABLE_STATE: ConsumableActionState = {
  message: "",
  status: "idle",
};
