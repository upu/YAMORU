"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { CompletionPanel } from "./completion-panel";
import { useDemoState } from "./demo-state";
import {
  HOME_SECTIONS,
  type HomeItem,
  type HomeSection,
} from "./home-data";
import {
  describeMaintenanceSchedule,
  getMaintenanceDisplayState,
  MAINTENANCE_DISPLAY_COPY,
} from "./task-schedule";

const FILTER_REPLACEMENT_ID = "cat-water-fountain-filter";
const FILTER_REPLACEMENT_HREF = "/managed-items/cat-water-fountain";
const OPEN_SECTION_IDS = new Set(["overdue", "today", "reminder", "upcoming"]);

const TONE_LABELS: Record<HomeItem["tone"], string> = {
  urgent: "要対応",
  today: "今日",
  upcoming: "予定",
  done: "完了",
  reminder: "そろそろ",
  caution: "要確認",
};

function useCompletionFeedbackFocus(isCompleted: boolean) {
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // 記録後に消えるボタンではなく、結果を伝える通知へ現在位置を移します。
    if (isCompleted) feedbackRef.current?.focus();
  }, [isCompleted]);

  return feedbackRef;
}

// 猫の浄水器のフィルター交換Todoは、まだ今回の交換が済んでいなければ
// 推奨期間の状態(YDR-017)に応じてreminderへ差し込みます。
// 「期限切れ」区分と対応状況の件数は厳密な期限(strict)専用のため、
// 推奨期間の上限超過(past-window)であってもoverdueへは入れません。
// 推奨期間前(before-window)は交換を急かさないため、どの区分にも表示しません。
function buildFilterReplacementPendingItem(
  isFilterReplacementCompleted: boolean,
  scheduledFor: Date,
  dueAt: Date,
): { sectionId: "reminder"; item: HomeItem } | null {
  if (isFilterReplacementCompleted) return null;

  const maintenanceWindow = { scheduledFor, dueAt };
  const state = getMaintenanceDisplayState(maintenanceWindow, new Date());

  if (state === "before-window") return null;

  const copy = MAINTENANCE_DISPLAY_COPY[state];

  return {
    sectionId: "reminder",
    item: {
      id: FILTER_REPLACEMENT_ID,
      title: "猫の浄水器のフィルター交換",
      detail: "猫の浄水器",
      meta: describeMaintenanceSchedule(state, maintenanceWindow),
      tone: copy.tone,
      detailHref: FILTER_REPLACEMENT_HREF,
    },
  };
}

function createHomeSections(
  isFilterReplacementCompleted: boolean,
  lastActivity: { date: string; member: string },
  scheduledFor: Date,
  dueAt: Date,
): HomeSection[] {
  const pending = buildFilterReplacementPendingItem(
    isFilterReplacementCompleted,
    scheduledFor,
    dueAt,
  );

  return HOME_SECTIONS.map((section) => {
    if (pending !== null && section.id === pending.sectionId) {
      return { ...section, items: [pending.item, ...section.items] };
    }

    if (section.id === "recent" && isFilterReplacementCompleted) {
      return {
        ...section,
        items: [
          {
            id: "cat-water-fountain-filter-latest-completion",
            title: "猫の浄水器のフィルター交換",
            detail: "猫の浄水器",
            meta: `${lastActivity.date} ・ ${lastActivity.member}が実施`,
            tone: "done",
            detailHref: FILTER_REPLACEMENT_HREF,
          },
          ...section.items.filter(
            (item) => item.detailHref !== FILTER_REPLACEMENT_HREF,
          ),
        ],
      };
    }

    return section;
  });
}

function TaskCard({
  item,
  onComplete,
}: {
  item: HomeItem;
  onComplete?: (occurredAt: Date) => void;
}) {
  return (
    <article className="task-card">
      <div className={`status-mark status-${item.tone}`} aria-hidden="true" />
      <div className="task-copy">
        <div className="task-title-row">
          <h3>
            {item.detailHref === undefined ? (
              item.title
            ) : (
              <Link href={item.detailHref}>{item.title}</Link>
            )}
          </h3>
          <span className={`tone-label tone-${item.tone}`}>
            {TONE_LABELS[item.tone]}
          </span>
        </div>
        <p className="item-detail">{item.detail}</p>
        <p className="item-meta">{item.meta}</p>
        {onComplete === undefined ? null : (
          <CompletionPanel onComplete={onComplete} taskTitle={item.title} />
        )}
      </div>
    </article>
  );
}

function HomeSectionView({ section }: { section: HomeSection }) {
  const { completeFilterReplacement } = useDemoState();

  return (
    <section
      aria-labelledby={`${section.id}-title`}
      className="home-section"
    >
      <div className="section-heading">
        <div>
          <h2 id={`${section.id}-title`}>{section.title}</h2>
          <p>{section.description}</p>
        </div>
        <span className="count" aria-label={`${String(section.items.length)}件`}>
          {section.items.length}
        </span>
      </div>

      <div className="card-list">
        {section.items.map((item) => (
          <TaskCard
            item={item}
            key={item.id}
            onComplete={
              item.id === FILTER_REPLACEMENT_ID
                ? completeFilterReplacement
                : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

function HomeHero({
  openItemCount,
  overdueItemCount,
}: {
  openItemCount: number;
  overdueItemCount: number;
}) {
  return (
    <header className="hero">
      <div className="brand-row">
        <div>
          <p className="eyebrow">HOME CARE</p>
          <h1>YAMORU</h1>
        </div>
        <div className="hero-actions">
          <span className="date-badge">8月12日 水</span>
          <Link className="account-link" href="/account" aria-label="アカウントを開く">
            アカウント
          </Link>
        </div>
      </div>
      <p className="tagline">暮らしの「いつだっけ？」をなくす。</p>

      <div className="summary" aria-label="対応状況">
        <div>
          <strong>{openItemCount}</strong>
          <span>件の予定</span>
        </div>
        <div>
          <strong>{overdueItemCount}</strong>
          <span>件が期限切れ</span>
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  const { dueAt, isFilterReplacementCompleted, lastActivity, scheduledFor } =
    useDemoState();
  const completionFeedbackRef = useCompletionFeedbackFocus(isFilterReplacementCompleted);
  const sections = createHomeSections(
    isFilterReplacementCompleted,
    lastActivity,
    scheduledFor,
    dueAt,
  );
  const openItemCount = sections.reduce(
    (total, section) =>
      total + (OPEN_SECTION_IDS.has(section.id) ? section.items.length : 0),
    0,
  );
  const overdueItemCount =
    sections.find((section) => section.id === "overdue")?.items.length ?? 0;

  return (
    <main>
      <HomeHero openItemCount={openItemCount} overdueItemCount={overdueItemCount} />

      <div className="section-list">
        {sections.map((section) => (
          <HomeSectionView key={section.id} section={section} />
        ))}
      </div>

      {isFilterReplacementCompleted ? (
        <p
          className="completion-feedback"
          ref={completionFeedbackRef}
          role="status"
          tabIndex={-1}
        >
          フィルター交換を記録しました。次回の予定を更新しました。
        </p>
      ) : null}

      <footer>
        <span className="footer-mark" aria-hidden="true">Y</span>
        <p>今日は、家のことが見えています。</p>
      </footer>
    </main>
  );
}
