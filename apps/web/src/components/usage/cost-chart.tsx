"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

type Day = { date: string; costUsd: number; tokens: number };

const HEIGHT = 200;
const PAD = { top: 12, right: 8, bottom: 24, left: 52 };

/** Rounds the axis maximum up to a clean value (1, 2, 2.5 or 5 × 10ⁿ). */
function niceMax(value: number) {
  if (value <= 0) return 0.01;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const step = [1, 2, 2.5, 5, 10].find((m) => m * base >= value) ?? 10;
  return step * base;
}

export function formatUsdAxis(value: number) {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(2)}`;
  return `$${value.toLocaleString("en", { maximumFractionDigits: 2 })}`;
}

/** Daily spend as columns: one series, so no legend; hover shows the exact values. */
export function CostChart({ days }: { days: Day[] }) {
  const { locale } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const max = niceMax(Math.max(...days.map((d) => d.costUsd)));
  const ticks = [0, max / 2, max];
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / days.length;
  const barW = Math.min(24, Math.max(2, slot - 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const label = (date: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${date}T12:00:00`).toLocaleDateString(locale, opts);
  const xLabels = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);
  const hovered = hover !== null ? days[hover] : null;

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={HEIGHT} role="img" aria-label="Daily spend" className="block">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-subtle text-[10px] tabular-nums">
              {formatUsdAxis(tick)}
            </text>
          </g>
        ))}

        {days.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const h = Math.max(0, y(0) - y(d.costUsd));
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={d.date}>
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + barW - r} Q${x + barW},${y(0) - h} ${x + barW},${y(0) - h + r} V${y(0)} Z`}
                  className="fill-accent transition-opacity"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {/* Hit target: the whole column, taller and wider than the bar. */}
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onTouchStart={() => setHover(i)}
              />
              {xLabels.has(i) && (
                <text
                  x={PAD.left + i * slot + slot / 2}
                  y={HEIGHT - 6}
                  textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}
                  className="fill-subtle text-[10px]"
                >
                  {label(d.date, { day: "numeric", month: "short" })}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-xl border border-border bg-elevated px-3 py-2 text-xs shadow-float"
          style={{
            left: Math.min(Math.max(PAD.left + hover * slot + slot / 2 - 70, 0), width - 140),
          }}
        >
          <p className="font-medium">{label(hovered.date, { weekday: "short", day: "numeric", month: "short" })}</p>
          <p className="mt-0.5 tabular-nums">{formatUsdAxis(hovered.costUsd)}</p>
          <p className="text-muted tabular-nums">{hovered.tokens.toLocaleString(locale)} tokens</p>
        </div>
      )}
    </div>
  );
}
