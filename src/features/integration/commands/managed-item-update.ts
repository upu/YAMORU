import {
  loadManagedItemSnapshot,
  managedItemUpdateCommandStatements,
  planManagedItemUpdate,
  type ManagedItemCommandInput,
  type ManagedItemSnapshot,
} from "../../../lib/d1/managed-item-commands";
import { CommandError, type NormalizedCommand } from "./contract";
import { managedItemDetailUrl, mapD1Error, targetOf, type CommandContext, type CommandHandler } from "./handler";
import { managedItemTarget, objectValue } from "./input";
import { mapManagedItemError } from "./managed-item-create";
import { managedItemChanges, type ManagedItemChanges } from "./managed-item-input";

// managed_item.update: Webの編集画面で変えられる項目を、指定したものだけ変える。
// 指定しなかった項目は現在の値を保ち、保存はWebの編集と同じ文で行う。
// 削除・アーカイブは扱わない(5節)。

type UpdatePayload = { changes: ManagedItemChanges };

// 外部の項目名と、編集前後の値の対応。previewの差分に使う。
const FIELDS: [keyof ManagedItemChanges, keyof ManagedItemCommandInput][] = [
  ["name", "name"],
  ["kind", "kindCode"],
  ["item_type", "itemTypeCode"],
  ["custom_item_type", "customItemType"],
  ["external_url", "externalUrl"],
  ["note", "note"],
  ["product_info", "productInfo"],
  ["started_on", "startedOn"],
  ["tag_ids", "tagIds"],
];

function normalize(_context: CommandContext, request: { payload: unknown; target: unknown }): NormalizedCommand {
  const target = managedItemTarget(request.target);
  const payload = objectValue(request.payload ?? {}, "payload", ["changes"]);
  if (payload.changes === undefined || payload.changes === null) {
    throw new CommandError("missing_required", { fieldErrors: { "payload.changes": "required" } });
  }
  const normalized: UpdatePayload = { changes: managedItemChanges(payload.changes, "payload.changes") };
  return { command: "managed_item.update", payload: normalized, target };
}

// 現在の値へ変更を重ねる。詳しい種類は、分類を変えたときだけ指定どおりにする。
function merged(current: ManagedItemSnapshot, changes: ManagedItemChanges): ManagedItemCommandInput {
  const classified = changes.item_type !== undefined;
  return {
    customItemType: classified ? changes.custom_item_type ?? null : current.customItemType,
    externalUrl: changes.external_url === undefined ? current.externalUrl : changes.external_url,
    itemTypeCode: classified ? changes.item_type ?? null : current.itemTypeCode,
    kindCode: changes.kind ?? current.kindCode,
    name: changes.name ?? current.name,
    note: changes.note === undefined ? current.note : changes.note,
    productInfo: changes.product_info === undefined ? current.productInfo : changes.product_info,
    startedOn: changes.started_on === undefined ? current.startedOn : changes.started_on,
    tagIds: changes.tag_ids ?? current.tagIds,
  };
}

function diff(current: ManagedItemSnapshot, next: ManagedItemCommandInput, tags: { from: string[]; to: string[] }) {
  const entries = FIELDS
    .filter(([, key]) => JSON.stringify(current[key]) !== JSON.stringify(next[key]))
    .map(([name, key]) => [name, name === "tag_ids" ? tags : { from: current[key], to: next[key] }]);
  return Object.fromEntries(entries) as Record<string, unknown>;
}

async function plan(context: CommandContext, normalized: NormalizedCommand) {
  const { changes } = normalized.payload as UpdatePayload;
  const itemId = targetOf(normalized).id;
  const current = await loadManagedItemSnapshot(context.db, context.householdId, itemId)
    .catch((error: unknown) => mapD1Error(error, { MANAGED_ITEM_NOT_FOUND: () => new CommandError("not_found") }));
  const next = merged(current, changes);
  const update = await planManagedItemUpdate(context.db, context.householdId, next)
    .catch((error: unknown) => mapManagedItemError(error, "payload.changes", next.itemTypeCode !== null));
  const tags = { from: current.tags.map((tag) => tag.name), to: update.tags.map((tag) => tag.name) };
  return {
    build({ recordedAt }: { recordedAt: string }) {
      const result = { detail_url: managedItemDetailUrl(itemId), managed_item_id: itemId, name: next.name, recorded_at: recordedAt };
      return {
        ...managedItemUpdateCommandStatements(context.db, context.householdId, update, itemId),
        result,
        revisionEntity: { id: itemId, kind: "managed_item" as const },
      };
    },
    preview: {
      affected_entities: [{ change: "update", id: itemId, kind: "managed_item", title: current.name }],
      diff: diff(current, next, tags),
      schedule_effect: {},
    },
  };
}

export const managedItemUpdateHandler: CommandHandler = { normalize, plan };
