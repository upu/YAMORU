export type HouseholdActionState = {
  message: string;
  status: "error" | "idle";
};

export const INITIAL_HOUSEHOLD_STATE: HouseholdActionState = {
  message: "",
  status: "idle",
};
