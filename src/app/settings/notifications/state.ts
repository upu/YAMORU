export type NotificationFormState = { status: "idle" | "success" | "error"; message: string };
export const INITIAL_NOTIFICATION_STATE: NotificationFormState = { status: "idle", message: "" };
