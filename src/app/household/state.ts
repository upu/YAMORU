export type IssueInvitationState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "issued";
      expiresAt: string;
      invitedEmail: string;
      link: string;
    };

export const INITIAL_ISSUE_INVITATION_STATE: IssueInvitationState = {
  status: "idle",
};

export type CancelInvitationState = {
  message: string;
  status: "error" | "idle";
};

export const INITIAL_CANCEL_INVITATION_STATE: CancelInvitationState = {
  message: "",
  status: "idle",
};
