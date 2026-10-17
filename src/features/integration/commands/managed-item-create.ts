import {
  managedItemCreationStatements,
  planManagedItemCreation,
  type ManagedItemCreationPlan,
} from "../../../lib/d1/managed-item-commands";
import { CommandError, invalidInput, type NormalizedCommand } from "./contract";
import { mapD1Error, managedItemDetailUrl, type CommandContext, type CommandHandler } from "./handler";
import { objectValue } from "./input";
import { managedItemPayload, type ManagedItemPayload } from "./managed-item-input";
import { buildTodoCreation, planTodo, scheduleEffect, todoDiff } from "./todo-create";
import { createPayload, type CreatePayload } from "./todo-create-input";

// managed_item.create: 管理対象を作る。保存の文はWebの登録と同じ。
// managed_item_with_todo.create: 管理対象と、それへ関連付けたTodoを一つのbatchで
// 作る。2つの独立したcommitにせず、どちらかだけが残ることはない(5節)。

function planItem(context: CommandContext, item: ManagedItemPayload, field: string): Promise<ManagedItemCreationPlan> {
  return planManagedItemCreation(context.db, context.householdId, {
    customItemType: item.custom_item_type,
    externalUrl: item.external_url,
    itemTypeCode: item.item_type,
    kindCode: item.kind,
    name: item.name,
    note: item.note,
    productInfo: item.product_info,
    startedOn: item.started_on,
    tagIds: item.tag_ids,
  }).catch((error: unknown) => mapD1Error(error, {
    MANAGED_ITEM_CLASSIFICATION_INVALID: () => item.item_type === null
      ? invalidInput(`${field}.kind`, "unknown_kind")
      : invalidInput(`${field}.item_type`, "unknown_for_kind"),
    MANAGED_ITEM_TAG_LIMIT_EXCEEDED: () => invalidInput(`${field}.tag_ids`, "too_many_tags"),
    TAG_NOT_FOUND: () => invalidInput(`${field}.tag_ids`, "not_found"),
  }));
}

function itemDiff(item: ManagedItemPayload, plan: ManagedItemCreationPlan) {
  return { ...item, tags: plan.tags };
}

function buildItem(context: CommandContext, item: ManagedItemPayload, plan: ManagedItemCreationPlan) {
  const itemId = crypto.randomUUID();
  return {
    ...managedItemCreationStatements(context.db, context.householdId, plan, itemId),
    itemId,
    result: { detail_url: managedItemDetailUrl(itemId), managed_item_id: itemId, name: item.name },
  };
}

function rejectTarget(target: unknown): void {
  // 新しく作る対象は、まだIDを持たない(5節)。
  if (target !== undefined) throw invalidInput("target", "not_allowed_for_create");
}

export const managedItemCreateHandler: CommandHandler = {
  normalize(_context, request) {
    rejectTarget(request.target);
    return { command: "managed_item.create", payload: managedItemPayload(request.payload), target: null };
  },
  async plan(context: CommandContext, normalized: NormalizedCommand) {
    const item = normalized.payload as ManagedItemPayload;
    const plan = await planItem(context, item, "payload");
    return {
      build({ recordedAt }) {
        const built = buildItem(context, item, plan);
        return {
          evidence: built.evidence,
          result: { ...built.result, recorded_at: recordedAt },
          revisionEntity: { id: built.itemId, kind: "managed_item" as const },
          statements: built.statements,
        };
      },
      preview: {
        affected_entities: [{ change: "create", id: null, kind: "managed_item", title: item.name }],
        diff: itemDiff(item, plan),
        schedule_effect: {},
      },
    };
  },
};

// Todo側の入力はtodo.createと同じ解析・確認を通す。項目名はpayload.todo配下として返す。
function renamed(error: unknown, prefix: string): unknown {
  if (!(error instanceof CommandError) || error.fieldErrors === undefined) return error;
  const fieldErrors = Object.fromEntries(Object.entries(error.fieldErrors)
    .map(([field, reason]) => [field.replace(/^payload(?=\.|$)/u, prefix), reason]));
  return new CommandError(error.code, { currentState: error.currentState, fieldErrors });
}

type CombinedPayload = { managed_item: ManagedItemPayload; todo: CreatePayload };

function required(value: unknown, field: string): unknown {
  if (value === undefined || value === null) throw new CommandError("missing_required", { fieldErrors: { [field]: "required" } });
  return value;
}

function combinedPayload(payload: unknown, now: Date): CombinedPayload {
  const value = objectValue(payload ?? {}, "payload", ["managed_item", "todo"]);
  const item = managedItemPayload(required(value.managed_item, "payload.managed_item"), "payload.managed_item");
  // 関連先は同じ操作で作る管理対象に決まるため、Todo側では指定させない。
  const todo = objectValue(required(value.todo, "payload.todo"), "payload.todo", [
    "title", "recurrence", "note", "assignee_id", "must_complete_by",
  ]);
  try {
    return { managed_item: item, todo: createPayload(todo, now) };
  } catch (error) {
    throw renamed(error, "payload.todo");
  }
}

function todoDiffWithoutLink(todo: CreatePayload) {
  return Object.fromEntries(Object.entries(todoDiff(todo)).filter(([key]) => key !== "managed_item_id"));
}

export const managedItemWithTodoCreateHandler: CommandHandler = {
  normalize(context, request) {
    rejectTarget(request.target);
    return { command: "managed_item_with_todo.create", payload: combinedPayload(request.payload, context.now), target: null };
  },
  async plan(context: CommandContext, normalized: NormalizedCommand) {
    const payload = normalized.payload as CombinedPayload;
    const itemPlan = await planItem(context, payload.managed_item, "payload.managed_item");
    // 作る管理対象はまだ無いため、関連なしで確認し、buildで作る管理対象へ関連付ける。
    const todoPlan = await planTodo(context, payload.todo).catch((error: unknown) => {
      throw renamed(error, "payload.todo");
    });
    return {
      build({ recordedAt }) {
        const item = buildItem(context, payload.managed_item, itemPlan);
        const todo = buildTodoCreation(context, { ...payload.todo, managed_item_id: item.itemId }, {
          insert: { ...todoPlan.insert, managedItemId: item.itemId },
          managedItemName: payload.managed_item.name,
        });
        return {
          evidence: [...item.evidence, ...todo.evidence],
          result: { managed_item: item.result, recorded_at: recordedAt, todo: todo.result },
          revisionEntity: { id: item.itemId, kind: "managed_item" as const },
          // 続けて管理対象・Todoのどちらへ操作するときも、expected_revisionに使える。
          revisionPlacements: [
            { id: item.itemId, kind: "managed_item", path: "$.managed_item.revision" },
            { id: todo.occurrenceId, kind: "todo_occurrence", path: "$.todo.revision" },
          ],
          statements: [...item.statements, ...todo.statements],
        };
      },
      preview: {
        affected_entities: [
          { change: "create", id: null, kind: "managed_item", title: payload.managed_item.name },
          { change: "create", id: null, kind: "todo_rule", title: payload.todo.title },
        ],
        diff: { managed_item: itemDiff(payload.managed_item, itemPlan), todo: todoDiffWithoutLink(payload.todo) },
        schedule_effect: scheduleEffect(payload.todo, todoPlan.insert),
      },
    };
  },
};
