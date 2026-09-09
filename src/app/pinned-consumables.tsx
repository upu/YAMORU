"use client";

import Link from "next/link";
import { useState } from "react";

import type { ConsumableSummary } from "../lib/d1/consumables";
import { QuickStockStatusControl } from "./consumables/stock-status-control";

const COLLAPSED_FAVORITES_COUNT = 5;

/* Issue #359: ホームのお気に入りは素早く確認・操作する領域なので表示密度を優先する。
   現在の在庫状態は状態変更ボタンのaria-pressedと配色が示すため、独立したバッジは置かない。
   状態変更は○△×で出し、名前が少し長くても1行に収まる幅にする。 */
function FavoriteConsumable({ favorite }: { favorite: ConsumableSummary }) {
  return (
    <article aria-label={favorite.name} className="pinned-consumable">
      <Link
        className="pinned-consumable-name"
        href={`/consumables/${encodeURIComponent(favorite.id)}`}
      >
        {favorite.name}
      </Link>
      <QuickStockStatusControl
        appearance="symbol"
        consumableId={favorite.id}
        label={`${favorite.name}の在庫状態を変更`}
        stockStatus={favorite.stockStatus}
      />
    </article>
  );
}

export function PinnedConsumablesSection({
  favorites,
}: {
  favorites: ConsumableSummary[];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasHiddenFavorites = favorites.length > COLLAPSED_FAVORITES_COUNT;
  const visibleFavorites = expanded
    ? favorites
    : favorites.slice(0, COLLAPSED_FAVORITES_COUNT);

  return (
    <section aria-labelledby="pinned-consumables-title" className="home-section favorites">
      <div className="section-heading">
        <h2 id="pinned-consumables-title">お気に入り</h2>
        <span aria-label={`${String(favorites.length)}件`} className="count">
          {favorites.length}
        </span>
      </div>
      <div className="pinned-consumable-list" id="pinned-consumable-list">
        {visibleFavorites.map((favorite) => (
          <FavoriteConsumable favorite={favorite} key={favorite.id} />
        ))}
      </div>
      {hasHiddenFavorites ? (
        <button
          aria-controls="pinned-consumable-list"
          aria-expanded={expanded}
          className="pinned-disclosure"
          onClick={() => {
            setExpanded((current) => !current);
          }}
          type="button"
        >
          {expanded
            ? "閉じる"
            : `ほか${String(favorites.length - COLLAPSED_FAVORITES_COUNT)}件を表示`}
        </button>
      ) : null}
    </section>
  );
}
