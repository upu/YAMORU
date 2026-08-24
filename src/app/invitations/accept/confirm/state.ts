export type AcceptInvitationState =
  | { status: "idle" }
  | { kind: "invalid"; status: "error" };

export const INITIAL_ACCEPT_INVITATION_STATE: AcceptInvitationState = {
  status: "idle",
};
