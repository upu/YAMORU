import type { IntegrationPrincipal } from "../principal";
import { objectInput, ReadError, stringInput } from "../read-contract";
import { readNotificationReplySet } from "../../../lib/d1/notification-replies";
import { createHouseholdReader, type ReadDependencies } from "../read";

type ReplyItem = Awaited<ReturnType<typeof readNotificationReplySet>>["items"][number];
async function selectedReply(deps: ReadDependencies, id: string, item: ReplyItem | undefined) {
  if (!item?.source) return null;
  try {
    const response = await createHouseholdReader(deps).entityGet({ kind: item.source.kind, id: item.source.id });
    return { notification_reference: { delivery_id: id, candidate_id: item.candidate_id }, entity: response.entity };
  } catch (error) {
    if (error instanceof ReadError && error.code === "not_found") return null;
    throw error;
  }
}
function selectedItem(items: ReplyItem[], count: number, candidateId: string | undefined) {
  if (candidateId === undefined) return count === 1 ? items[0] : undefined;
  const item = items.find((item) => item.candidate_id === candidateId);
  if (!item) throw new ReadError("not_found");
  return item;
}
export async function readReplyContext(deps: ReadDependencies, principal: IntegrationPrincipal, now: Date, input: unknown) {
  const value = objectInput(input, ["delivery_id", "candidate_id"]);
  const id = stringInput(value.delivery_id, 100);
  const candidateId = value.candidate_id === undefined ? undefined : stringInput(value.candidate_id, 100);
  const set = await readNotificationReplySet(deps.db, principal, id, now);
  const selected = await selectedReply(deps, id, selectedItem(set.items, set.count, candidateId));
  const selectionRequired = set.count > 1 && candidateId === undefined && set.items.some((item) => item.source !== null);
  return { schema_version: 1, request_id: crypto.randomUUID(), as_of: now.toISOString(), delivery_id: id,
    selection_required: selectionRequired, missing_count: Math.max(0, set.count - set.items.length), items: set.items, selected,
    recovery: selected || selectionRequired ? null : "select_current_target", data_origin: "user_authored" as const };
}
