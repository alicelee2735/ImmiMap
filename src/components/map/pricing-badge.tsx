"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PricingLabel } from "@/types/immimap";

const PRICING_LABEL_TO_KEY: Record<
  PricingLabel,
  "pro_bono" | "low_cost" | "paid"
> = {
  "Pro bono": "pro_bono",
  "Low-cost": "low_cost",
  Paid: "paid",
};

type PricingBadgeProps = {
  pricing?: PricingLabel;
  className?: string;
};

/**
 * Confirmed Pro bono / Low-cost / Paid tags stay navy. Unknown pricing uses
 * the same dashed-amber treatment as assumed-English, never a Low-cost badge.
 */
export function PricingBadge({ pricing, className }: PricingBadgeProps) {
  const tPrice = useTranslations("Pricing");

  if (!pricing) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "h-auto max-w-[11rem] shrink-0 whitespace-normal rounded-sm border border-dashed border-amber-300 bg-amber-50/70 text-center font-medium uppercase leading-snug tracking-wide text-amber-800",
          className,
        )}
      >
        {tPrice("unconfirmed")}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 rounded-sm border border-route-blue/30 bg-paper font-medium uppercase tracking-wide text-ink-navy",
        className,
      )}
    >
      {tPrice(PRICING_LABEL_TO_KEY[pricing])}
    </Badge>
  );
}
