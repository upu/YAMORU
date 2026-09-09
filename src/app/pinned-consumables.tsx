"use client";

import Link from "next/link";
import { useState } from "react";

import type { ConsumableSummary } from "../lib/d1/consumables";
import { QuickStockStatusControl } from "./consumables/stock-status-control";
import styles from "./pinned-consumables.module.css";

const COLLAPSED_PINS_COUNT = 5;

/* Issue #359 / #375: ホームのピン留めは素早く確認・操作する領域なので表示密度を優先する。
   現在の在庫状態は状態変更ボタンのaria-pressedと配色が示すため、独立したバッジは置かない。
   状態変更は○△×で出し、名前が少し長くても1行に収まる幅にする。 */
function PinnedConsumable({ pin }: { pin: ConsumableSummary }) {
  return (
    <article aria-label={pin.name} className={styles.item}>
      <Link
        className={styles.name}
        href={`/consumables/${encodeURIComponent(pin.id)}`}
      >
        {pin.name}
      </Link>
      <QuickStockStatusControl
        appearance="symbol"
        consumableId={pin.id}
        label={`${pin.name}の在庫状態を変更`}
        stockStatus={pin.stockStatus}
      />
    </article>
  );
}

export function PinnedConsumablesSection({
  pins,
}: {
  pins: ConsumableSummary[];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasHiddenPins = pins.length > COLLAPSED_PINS_COUNT;
  const visiblePins = expanded
    ? pins
    : pins.slice(0, COLLAPSED_PINS_COUNT);

  return (
    <section aria-labelledby="pinned-consumables-title" className="home-section pins">
      <div className="section-heading">
        <h2 id="pinned-consumables-title">ピン留め</h2>
        <span aria-label={`${String(pins.length)}件`} className="count">
          {pins.length}
        </span>
      </div>
      <div className={styles.list} id="pinned-consumable-list">
        {visiblePins.map((pin) => (
          <PinnedConsumable key={pin.id} pin={pin} />
        ))}
      </div>
      {hasHiddenPins ? (
        <button
          aria-controls="pinned-consumable-list"
          aria-expanded={expanded}
          className={styles.disclosure}
          onClick={() => {
            setExpanded((current) => !current);
          }}
          type="button"
        >
          {expanded
            ? "閉じる"
            : `ほか${String(pins.length - COLLAPSED_PINS_COUNT)}件を表示`}
        </button>
      ) : null}
    </section>
  );
}
