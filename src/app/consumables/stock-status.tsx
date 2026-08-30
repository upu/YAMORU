import type { ConsumableStockStatus } from "../../lib/d1/consumables";

const STOCK_STATUS_LABELS: Record<ConsumableStockStatus, string> = {
  available: "ある",
  low: "少ない",
  out: "ない",
};

export function stockStatusLabel(status: ConsumableStockStatus): string {
  return STOCK_STATUS_LABELS[status];
}

export function StockStatusBadge({
  stockStatus,
}: {
  stockStatus: ConsumableStockStatus;
}) {
  return (
    <span className={`stock-status-badge stock-status-${stockStatus}`}>
      {stockStatusLabel(stockStatus)}
    </span>
  );
}
