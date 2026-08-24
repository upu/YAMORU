export type HouseholdActionState = {
  message: string;
  status: "error" | "idle";
};

export const INITIAL_HOUSEHOLD_STATE: HouseholdActionState = {
  message: "",
  status: "idle",
};

export type NicknameActionState = {
  message: string;
  status: "error" | "idle";
};

export const INITIAL_NICKNAME_STATE: NicknameActionState = {
  message: "",
  status: "idle",
};

export type NicknameEditActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

export const INITIAL_NICKNAME_EDIT_STATE: NicknameEditActionState = {
  message: "",
  status: "idle",
};
