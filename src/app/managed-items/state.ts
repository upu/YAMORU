export type ManagedItemActionState = {
  message: string;
  status: "error" | "idle";
};

export const INITIAL_MANAGED_ITEM_STATE: ManagedItemActionState = {
  message: "",
  status: "idle",
};
