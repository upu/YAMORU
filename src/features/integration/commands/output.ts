import type { IntegrationOperation } from "../../../lib/d1/integration-operations";
import { confirmationOutput } from "./confirmation";
import { canonicalJson, CommandError, isCommandErrorCode } from "./contract";
import { tokyoDate } from "./input";

// command_prepare / command_commit / operation_getの応答の形(conversation-integration.md 5節)。

// 期限を過ぎたまま確定していない操作も、外からは期限切れとして見せる。
export function visibleStatus(operation: IntegrationOperation, now: Date): string {
  return operation.status === "prepared" && operation.expiresAt <= now.toISOString() ? "expired" : operation.status;
}

// 拒否を確定させたときの詳細を、再送やoperation_getでも同じ形で返す。
export function storedError(operation: IntegrationOperation): CommandError {
  const code = operation.reasonCode ?? "";
  const detail = JSON.parse(operation.reasonDetail ?? "{}") as {
    current_state?: Record<string, unknown>;
    field_errors?: Record<string, string>;
  };
  return new CommandError(isCommandErrorCode(code) ? code : "temporarily_unavailable", {
    currentState: detail.current_state,
    fieldErrors: detail.field_errors,
    operationId: operation.operationId,
  });
}

export function errorDetail(error: CommandError): string | null {
  if (error.currentState === undefined && error.fieldErrors === undefined) return null;
  return canonicalJson({ current_state: error.currentState, field_errors: error.fieldErrors });
}

export function outcomeOf(operation: IntegrationOperation, now: Date): Record<string, unknown> {
  const status = visibleStatus(operation, now);
  if (status === "succeeded") return { recorded_at: operation.resolvedAt, result: JSON.parse(operation.result ?? "null") as unknown };
  if (status === "expired" && operation.status === "prepared") {
    return { error: new CommandError("preview_expired", { operationId: operation.operationId }).toWire() };
  }
  if (status === "rejected" || status === "expired") return { error: storedError(operation).toWire() };
  return {};
}

export function prepareOutput(operation: IntegrationOperation, now: Date, issuer: string | null): Record<string, unknown> {
  return {
    operation_id: operation.operationId,
    status: visibleStatus(operation, now),
    preview_id: operation.previewId,
    expires_at: operation.expiresAt,
    // 「今日」「昨日」を解決した基準日。日付の暦はAsia/Tokyoに固定する。
    reference_date: tokyoDate(operation.createdAt),
    time_zone: "Asia/Tokyo",
    normalized_command: JSON.parse(operation.normalizedCommand) as unknown,
    ...(JSON.parse(operation.preview) as Record<string, unknown>),
    confirmation: confirmationOutput(operation, now, issuer),
    fingerprint: operation.fingerprint,
    household_revision: { epoch: operation.revisionEpoch, version: operation.revisionVersion },
    ...outcomeOf(operation, now),
  };
}

export function successOutput(operation: IntegrationOperation, replayed: boolean): Record<string, unknown> {
  return {
    status: "succeeded",
    operation_id: operation.operationId,
    replayed,
    recorded_at: operation.resolvedAt,
    result: JSON.parse(operation.result ?? "null") as unknown,
  };
}
