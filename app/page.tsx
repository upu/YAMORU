"use client";

import Link from "next/link";
import { type SyntheticEvent, useState } from "react";

import { formatDateTimeInput, useDemoState } from "./demo-state";
import {
  HOME_SECTIONS,
  type HomeItem,
  type HomeSection,
} from "./home-data";

const FILTER_REPLACEMENT_ID = "cat-water-fountain-filter";
const FILTER_REPLACEMENT_HREF = "/managed-items/cat-water-fountain";

const TONE_LABELS: Record<HomeItem["tone"], string> = {
  urgent: "要対応",
  today: "今日",
  upcoming: "予定",
  done: "完了",
};

function CompletionActions({
  onComplete,
}: {
  onComplete: (occurredAt: Date) => void;
}) {
  const [isDateTimeVisible, setIsDateTimeVisible] = useState(false);
  const [dateTime, setDateTime] = useState("");

  function toggleDateTimeInput() {
    if (!isDateTimeVisible) {
      setDateTime(formatDateTimeInput(new Date()));
    }
    setIsDateTimeVisible((current) => !current);
  }

  function submitWithDateTime(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const occurredAt = new FormData(event.currentTarget).get("occurredAt");

    if (typeof occurredAt === "string" && occurredAt !== "") {
      onComplete(new Date(occurredAt));
    }
  }

  return (
    <div className="completion-actions">
      <button
        className="complete-button"
        onClick={() => { onComplete(new Date()); }}
        type="button"
      >
        フィルター交換を完了
      </button>
      <button
        aria-controls="filter-completion-date-time"
        aria-expanded={isDateTimeVisible}
        className="date-time-toggle"
        onClick={toggleDateTimeInput}
        type="button"
      >
        実施日時を変更
      </button>
      {isDateTimeVisible ? (
        <form
          aria-label="実施日時を指定して完了"
          className="date-time-form"
          id="filter-completion-date-time"
          onSubmit={submitWithDateTime}
        >
          <label htmlFor="filter-completed-at">実施日時</label>
          <input
            id="filter-completed-at"
            max={formatDateTimeInput(new Date())}
            name="occurredAt"
            required
            type="datetime-local"
            defaultValue={dateTime}
          />
          <button type="submit">指定した日時で完了</button>
        </form>
      ) : null}
    </div>
  );
}

function createHomeSections(
  isFilterReplacementCompleted: boolean,
  lastActivity: { date: string; member: string },
): HomeSection[] {
  return HOME_SECTIONS.map((section) => {
    if (section.id === "overdue" && isFilterReplacementCompleted) {
      return {
        ...section,
        items: section.items.filter((item) => item.id !== FILTER_REPLACEMENT_ID),
      };
    }

    if (section.id === "recent" && isFilterReplacementCompleted) {
      return {
        ...section,
        items: [
          {
            id: "cat-water-fountain-filter-completed-now",
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
          <CompletionActions onComplete={onComplete} />
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

export default function Home() {
  const {
    isFilterReplacementCompleted,
    lastActivity,
  } = useDemoState();
  const sections = createHomeSections(
    isFilterReplacementCompleted,
    lastActivity,
  );
  const openItemCount = sections.slice(0, 3).reduce(
    (total, section) => total + section.items.length,
    0,
  );
  const overdueItemCount = sections[0]?.items.length ?? 0;

  return (
    <main>
      <header className="hero">
        <div className="brand-row">
          <div>
            <p className="eyebrow">HOME CARE</p>
            <h1>YAMORU</h1>
          </div>
          <span className="date-badge">8月12日 水</span>
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

      <div className="section-list">
        {sections.map((section) => (
          <HomeSectionView key={section.id} section={section} />
        ))}
      </div>

      {isFilterReplacementCompleted ? (
        <p className="completion-feedback" role="status">
          フィルター交換を完了しました。次回期限を更新しました。
        </p>
      ) : null}

      <footer>
        <span className="footer-mark" aria-hidden="true">Y</span>
        <p>今日は、家のことが見えています。</p>
      </footer>
    </main>
  );
}
