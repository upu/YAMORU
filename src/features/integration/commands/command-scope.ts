import type { IntegrationScope } from "../scopes";
export function commandScope(command: string): IntegrationScope {
  if (command === "notification.claim" || command === "notification.ack") return "events.subscribe";
  return command.startsWith("notification.") ? "notifications.manage" : "household.write";
}
