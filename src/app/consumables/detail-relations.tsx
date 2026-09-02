"use client";

import Link from "next/link";
import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
  useTransition,
} from "react";

import type {
  ConsumableRelationOption,
  ConsumableTaskRuleNextOccurrence,
  ConsumableTaskRuleOption,
} from "../../lib/d1/consumables";
import { formatTokyoDateInput, formatTokyoMonthDay } from "../time-zone";
import {
  searchConsumableManagedItems,
  searchConsumableTaskRules,
  setConsumableManagedItemRelation,
  setConsumableTaskRuleRelation,
  type ConsumableRelationUpdateResult,
} from "./relation-actions";
import {
  describeManagedItem,
  describeTaskRule,
  RelationPickerDialog,
  type CandidateSearch,
  type RelationCandidate,
} from "./relation-picker";

// Issue #311: 関連を確認している場所からそのまま追加・解除できるようにする。
// 候補の検索と選択は#292のダイアログをそのまま使い、詳細画面には「見出しの
// 横の＋」と「各項目の×」だけを足す。解除を編集モードの中へ隠す案もあったが、
// 追加と解除の入口が離れるため、フォームの選択済み一覧(#292)と同じ×に揃えた。
type RelationSave = (
  relatedId: string,
  related: boolean,
) => Promise<ConsumableRelationUpdateResult>;

// サーバーアクションの呼び出し自体が失敗した(通信が切れたなど)ときの言葉。
// アクションが返す失敗と同じ場所に同じ調子で出す。
const UNEXPECTED_ERROR_MESSAGE = "関連を更新できませんでした。時間をおいて再度お試しください。";

// 詳細画面で追加したTodoは、次回予定をまだサーバーから受け取っていない。
// 予定の行を出さないことで、未取得を「予定なし」と言い切らない。
type DetailTaskRule = ConsumableTaskRuleOption & {
  nextOccurrence?: ConsumableTaskRuleNextOccurrence | null;
};

function nextScheduleLabel(occurrence: ConsumableTaskRuleNextOccurrence | null): string {
  if (occurrence === null) return "次回予定なし";
  const { dueAt, scheduledFor } = occurrence;
  if (scheduledFor === null && dueAt === null) return "次回: 未定";
  if (scheduledFor === null || dueAt === null) {
    throw new Error("Todoの予定日と期限の組み合わせが不正です。");
  }
  const scheduledLabel = formatTokyoMonthDay(scheduledFor);
  if (formatTokyoDateInput(scheduledFor) === formatTokyoDateInput(dueAt)) {
    return `次回: ${scheduledLabel}`;
  }
  return `次回: ${scheduledLabel}〜${formatTokyoMonthDay(dueAt)}`;
}

function RelationHeading({
  kicker,
  onAdd,
  titleId,
  triggerRef,
  unit,
}: {
  kicker: string;
  onAdd: () => void;
  titleId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  unit: string;
}) {
  return (
    <div className="detail-section-heading">
      <div>
        <p className="detail-kicker">{kicker}</p>
        <h2 id={titleId}>関連する{unit}</h2>
      </div>
      <button
        aria-label={`${unit}を追加`}
        className="icon-button"
        onClick={onAdd}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true">＋</span>
      </button>
    </div>
  );
}

function RelationList<T extends RelationCandidate>({
  describe,
  isSaving,
  items,
  onRemove,
  renderItem,
  unit,
}: {
  describe: (item: T) => string;
  isSaving: boolean;
  items: T[];
  onRemove: (item: T) => void;
  renderItem: (item: T) => ReactNode;
  unit: string;
}) {
  if (items.length === 0) {
    return <p className="ledger-empty">関連する{unit}はありません。</p>;
  }
  return (
    <ul className="ledger-list">
      {items.map((item) => (
        <li key={item.id}>
          {renderItem(item)}
          <button
            aria-label={`${describe(item)}を関連から外す`}
            className="relation-chip-remove"
            disabled={isSaving}
            onClick={() => { onRemove(item); }}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// 追加・解除はサーバーへ反映できたときだけ一覧へ映す。失敗したときは一覧を
// 変えず、理由をその場に出す。
// 続けて操作したときに保存の完了順が入れ替わっても取りこぼさないよう、
// 反映は操作を始めた時点の一覧ではなく、そのときの最新の一覧から作る。
function useRelationEditor<T extends RelationCandidate>(
  onChange: Dispatch<SetStateAction<T[]>>,
  save: RelationSave,
) {
  const [message, setMessage] = useState("");
  const [isSaving, startSaving] = useTransition();

  function apply(item: T, related: boolean) {
    // 理由を消すのは新しい操作を始めるときだけにする。並行する保存が
    // 成功したときに消さないことで、失敗した操作の理由が流れない。
    setMessage("");
    startSaving(async () => {
      let result: ConsumableRelationUpdateResult;
      try {
        result = await save(item.id, related);
      } catch {
        setMessage(UNEXPECTED_ERROR_MESSAGE);
        return;
      }
      if (result.status === "error") {
        setMessage(result.message);
        return;
      }
      onChange((current) => {
        if (!related) return current.filter((selected) => selected.id !== item.id);
        return current.some((selected) => selected.id === item.id)
          ? current
          : [...current, item];
      });
    });
  }

  return { apply, isSaving, message };
}

// 件数の変化はスクリーンリーダーへ読み上げ、失敗はその場の警告として出す。
function RelationStatus({
  count,
  message,
  unit,
}: {
  count: number;
  message: string;
  unit: string;
}) {
  return (
    <>
      <p aria-live="polite" className="sr-only">
        関連する{unit}は{count}件です。
      </p>
      {message === "" ? null : (
        <p className="auth-feedback" role="alert">{message}</p>
      )}
    </>
  );
}

function RelationSection<T extends RelationCandidate>({
  describe,
  items,
  kicker,
  onChange,
  renderItem,
  save,
  search,
  titleId,
  unit,
}: {
  describe: (item: T) => string;
  items: T[];
  kicker: string;
  onChange: Dispatch<SetStateAction<T[]>>;
  renderItem: (item: T) => ReactNode;
  save: RelationSave;
  search: CandidateSearch<T>;
  titleId: string;
  unit: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { apply, isSaving, message } = useRelationEditor(onChange, save);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedIds = new Set(items.map((item) => item.id));

  function close() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <section aria-labelledby={titleId} className="detail-card">
      <RelationHeading
        kicker={kicker}
        onAdd={() => { setIsOpen(true); }}
        titleId={titleId}
        triggerRef={triggerRef}
        unit={unit}
      />
      <RelationList
        describe={describe}
        isSaving={isSaving}
        items={items}
        onRemove={(item) => { apply(item, false); }}
        renderItem={renderItem}
        unit={unit}
      />
      <RelationStatus count={items.length} message={message} unit={unit} />
      {isOpen ? (
        <RelationPickerDialog
          describe={describe}
          onClose={close}
          onToggle={(item) => { apply(item, !selectedIds.has(item.id)); }}
          search={search}
          selectedIds={selectedIds}
          unit={unit}
        />
      ) : null}
    </section>
  );
}

function renderManagedItem(item: ConsumableRelationOption): ReactNode {
  return (
    <Link href={`/managed-items/${encodeURIComponent(item.id)}`}>{item.name}</Link>
  );
}

function renderTaskRule(rule: DetailTaskRule): ReactNode {
  return (
    <span className="consumable-related-todo">
      <span>{rule.title}</span>
      {rule.managedItemName === null ? null : (
        <span className="input-help">{rule.managedItemName}</span>
      )}
      {rule.nextOccurrence === undefined ? null : (
        <span className="input-help">{nextScheduleLabel(rule.nextOccurrence)}</span>
      )}
    </span>
  );
}

// Todoの候補は関連する管理対象を手掛かりに並べ替えるため、管理対象の増減に
// 合わせて検索関数を作り直す(#292のフォームと同じ扱い)。
function useTaskRuleSearch(
  managedItems: ConsumableRelationOption[],
): CandidateSearch<DetailTaskRule> {
  const relatedIdsKey = managedItems.map((item) => item.id).join(",");
  return useCallback(
    (query: string) => searchConsumableTaskRules(
      query,
      relatedIdsKey === "" ? [] : relatedIdsKey.split(","),
    ),
    [relatedIdsKey],
  );
}

function useRelationSaves(consumableId: string): {
  saveManagedItem: RelationSave;
  saveTaskRule: RelationSave;
} {
  return {
    saveManagedItem: useCallback<RelationSave>(
      (managedItemId, related) => setConsumableManagedItemRelation(
        consumableId,
        managedItemId,
        related,
      ),
      [consumableId],
    ),
    saveTaskRule: useCallback<RelationSave>(
      (taskRuleId, related) => setConsumableTaskRuleRelation(
        consumableId,
        taskRuleId,
        related,
      ),
      [consumableId],
    ),
  };
}

export function ConsumableRelations({
  consumableId,
  managedItems: initialManagedItems,
  taskRules: initialTaskRules,
}: {
  consumableId: string;
  managedItems: ConsumableRelationOption[];
  taskRules: DetailTaskRule[];
}) {
  const [managedItems, setManagedItems] = useState(initialManagedItems);
  const [taskRules, setTaskRules] = useState(initialTaskRules);
  const searchTaskRules = useTaskRuleSearch(managedItems);
  const { saveManagedItem, saveTaskRule } = useRelationSaves(consumableId);

  return (
    <>
      <RelationSection
        describe={describeManagedItem}
        items={managedItems}
        kicker="MANAGED ITEMS"
        onChange={setManagedItems}
        renderItem={renderManagedItem}
        save={saveManagedItem}
        search={searchConsumableManagedItems}
        titleId="consumable-managed-items-title"
        unit="管理対象"
      />
      <RelationSection
        describe={describeTaskRule}
        items={taskRules}
        kicker="TODOS"
        onChange={setTaskRules}
        renderItem={renderTaskRule}
        save={saveTaskRule}
        search={searchTaskRules}
        titleId="consumable-task-rules-title"
        unit="Todo"
      />
    </>
  );
}
