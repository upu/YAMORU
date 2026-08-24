export type AuthActionState = {
  message: string;
  status: "error" | "idle";
};

export const INITIAL_AUTH_STATE: AuthActionState = {
  message: "",
  status: "idle",
};
