export type AcceptInvitationState =
  | { status: "idle" }
  | { kind: "invalid" | "cross-household"; status: "error" };

export const INITIAL_ACCEPT_INVITATION_STATE: AcceptInvitationState = {
  status: "idle",
};
