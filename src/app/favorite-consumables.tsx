"use client";

import Link from "next/link";
import { useState } from "react";

import type { ConsumableSummary } from "../lib/d1/consumables";
import { QuickStockStatusControl } from "./consumables/stock-status-control";
import { StockStatusBadge } from "./consumables/stock-status";

const COLLAPSED_FAVORITES_COUNT = 5;

function FavoriteConsumable({ favorite }: { favorite: ConsumableSummary }) {
  return (
    <article aria-label={favorite.name} className="favorite-consumable">
      <div className="favorite-consumable-heading">
        <Link href={`/consumables/${encodeURIComponent(favorite.id)}`}>
          {favorite.name}
        </Link>
        <StockStatusBadge stockStatus={favorite.stockStatus} />
      </div>
      <QuickStockStatusControl
        consumableId={favorite.id}
        label={`${favorite.name}の在庫状態を変更`}
        stockStatus={favorite.stockStatus}
      />
    </article>
  );
}

export function FavoriteConsumablesSection({
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
    <section aria-labelledby="favorite-consumables-title" className="home-section favorites">
      <div className="section-heading">
        <div>
          <h2 id="favorite-consumables-title">お気に入り</h2>
          <p>あなたがよく使う消耗品です。在庫状態の変更は家族全員に反映されます</p>
        </div>
        <span aria-label={`${String(favorites.length)}件`} className="count">
          {favorites.length}
        </span>
      </div>
      <div className="favorite-consumable-list" id="favorite-consumable-list">
        {visibleFavorites.map((favorite) => (
          <FavoriteConsumable favorite={favorite} key={favorite.id} />
        ))}
      </div>
      {hasHiddenFavorites ? (
        <button
          aria-controls="favorite-consumable-list"
          aria-expanded={expanded}
          className="favorite-disclosure"
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
