import {
  HOME_SECTIONS,
  type HomeItem,
  type HomeSection,
} from "./home-data";

const TONE_LABELS: Record<HomeItem["tone"], string> = {
  urgent: "要対応",
  today: "今日",
  upcoming: "予定",
  done: "完了",
};

function TaskCard({ item }: { item: HomeItem }) {
  return (
    <article className="task-card">
      <div className={`status-mark status-${item.tone}`} aria-hidden="true" />
      <div className="task-copy">
        <div className="task-title-row">
          <h3>{item.title}</h3>
          <span className={`tone-label tone-${item.tone}`}>
            {TONE_LABELS[item.tone]}
          </span>
        </div>
        <p className="item-detail">{item.detail}</p>
        <p className="item-meta">{item.meta}</p>
      </div>
    </article>
  );
}

function HomeSectionView({ section }: { section: HomeSection }) {
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
            key={`${section.id}-${item.title}`}
          />
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const openItemCount = HOME_SECTIONS.slice(0, 3).reduce(
    (total, section) => total + section.items.length,
    0,
  );

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
            <strong>1</strong>
            <span>件が期限切れ</span>
          </div>
        </div>
      </header>

      <div className="section-list">
        {HOME_SECTIONS.map((section) => (
          <HomeSectionView key={section.id} section={section} />
        ))}
      </div>

      <footer>
        <span className="footer-mark" aria-hidden="true">Y</span>
        <p>今日は、家のことが見えています。</p>
      </footer>
    </main>
  );
}
