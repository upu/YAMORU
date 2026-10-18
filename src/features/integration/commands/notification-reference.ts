import { notificationReplyGuard, notificationReplySource, requireNotificationReplyAccess, type ReplySource } from "../../../lib/d1/notification-replies";
import { ReadError } from "../read-contract";
import { CommandError, invalidInput, type NormalizedCommand } from "./contract";
import type { CommandContext, CommandHandler, CommandPlan } from "./handler";

export function requireNotificationReferenceScope(scopes: readonly string[], normalized: NormalizedCommand) {
  if (normalized.notification_reference && !scopes.includes("notifications.manage")) throw new CommandError("insufficient_scope");
}
export async function requireNotificationReferenceAccess(context: CommandContext, normalized: Pick<NormalizedCommand, "notification_reference">) {
  if (!normalized.notification_reference) return;
  if (!context.principal) throw new CommandError("not_found");
  try { await requireNotificationReplyAccess(context.db, context.principal, context.now); }
  catch (error) { if (error instanceof ReadError) throw new CommandError(error.code === "insufficient_scope" ? "insufficient_scope" : "not_found"); throw error; }
}
async function matchesSource(context: CommandContext, normalized: NormalizedCommand, source: ReplySource) {
  const target = normalized.target;
  if (!target) return false;
  if (normalized.command === "notification.snooze") return target.kind === "attention_candidate" && target.id === normalized.notification_reference?.candidate_id;
  if (["todo.complete", "todo.reschedule"].includes(normalized.command)) return source.kind === "todo_occurrence" && target.kind === source.kind && target.id === source.id;
  if (["todo.correct", "todo.undo"].includes(normalized.command)) {
    if (source.kind !== "todo_occurrence" || target.kind !== "completion_log") return false;
    return Boolean(await context.db.prepare("SELECT 1 FROM activity_logs WHERE id=? AND household_id=? AND task_occurrence_id=? AND action='completed'")
      .bind(target.id, context.householdId, source.id).first());
  }
  return ["stock.observe", "stock.refill", "stock.correct"].includes(normalized.command) && source.kind === "consumable" && target.kind === source.kind && target.id === source.id;
}
export async function planWithNotificationReference(context: CommandContext, normalized: NormalizedCommand, handler: CommandHandler): Promise<CommandPlan> {
  const ref = normalized.notification_reference;
  if (!ref) return handler.plan(context, normalized);
  if (!context.principal) throw new CommandError("not_found");
  const principal = context.principal;
  requireNotificationReferenceScope(principal.scopes, normalized);
  let source: ReplySource;
  try { source = await notificationReplySource(context.db, principal, ref, context.now); }
  catch (error) { if (error instanceof ReadError) throw new CommandError(error.code === "insufficient_scope" ? "insufficient_scope" : "not_found"); throw error; }
  if (!["todo.complete", "todo.reschedule", "todo.correct", "todo.undo", "notification.snooze", "stock.observe", "stock.refill", "stock.correct"].includes(normalized.command)) {
    throw invalidInput("notification_reference", "unsupported_reply_command");
  }
  if (!await matchesSource(context, normalized, source)) throw new CommandError("not_found");
  const plan = await handler.plan(context, normalized);
  return {
    // Legacy Workers replan without this marker and reject the unequal preview before executing.
    preview: { ...plan.preview, schedule_effect: { ...plan.preview.schedule_effect, notification_reference: ref } },
    build(input) {
      const execution = plan.build(input);
      const guardId = `notification-reply:${input.businessKey}`;
      return { ...execution, statements: [notificationReplyGuard(context.db, principal, ref, source, context.now, guardId), ...execution.statements,
        context.db.prepare("DELETE FROM attention_guards WHERE id=?").bind(guardId)] };
    },
  };
}
