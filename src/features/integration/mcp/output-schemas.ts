import { z } from "zod";
import type { McpToolName } from "./catalog";
const record = z.record(z.string(), z.unknown());
const page = { next_cursor: z.string().nullable() };
const base = { schema_version: z.number(), request_id: z.string(), as_of: z.string() };
const output = {
  connection_get: z.looseObject({ ...base, user_id: z.string(), household_id: z.string(), connection_id: z.string(), status: z.string(), scopes: z.array(z.string()), capabilities: record }),
  entity_search: z.looseObject({ ...base, candidates: z.array(record), ...page, search_complete: z.boolean() }),
  entity_get: z.looseObject({ ...base, entity: record }),
  history_list: z.looseObject({ ...base, records: z.array(record), ...page }),
  attention_get: z.looseObject({ ...base, candidates: z.array(record), ...page, refresh_complete: z.boolean() }),
  notification_settings_get: z.looseObject({ ...base, settings: record, revision: z.number() }),
  delivery_list: z.looseObject({ ...base, items: z.array(record), ...page }),
  notification_context_get: z.looseObject({ ...base, delivery_id: z.string(), selection_required: z.boolean(), items: z.array(record), selected: record.nullable() }),
  command_prepare: z.looseObject({ operation_id: z.string(), status: z.string(), preview_id: z.string(), fingerprint: z.string(), expires_at: z.string(), affected_entities: z.array(record), diff: record, confirmation: record }),
  command_commit: z.looseObject({ operation_id: z.string(), status: z.string(), replayed: z.boolean(), recorded_at: z.string(), result: record }),
  operation_get: z.looseObject({ operation_id: z.string(), status: z.string() }),
} satisfies Record<McpToolName, z.ZodObject>;
export function mcpOutputSchema(name: McpToolName) { return output[name]; }
