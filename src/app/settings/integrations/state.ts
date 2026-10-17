export type RevokeConnectionState = {
  message: string;
  status: "error" | "idle";
};

export const INITIAL_REVOKE_CONNECTION_STATE: RevokeConnectionState = {
  message: "",
  status: "idle",
};
