"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import {
  BOTLING_COLORS,
  type BotlingAppearance,
  type BotlingMood,
  type BotlingShape,
} from "./botling-options";

function flowerPath() {
  const points: string[] = [];
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = 39 + 5 * Math.cos(a * 8);
    points.push(`${(50 + r * Math.cos(a)).toFixed(2)} ${(52 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${points.join(" L")}Z`;
}

const SHAPES: Record<BotlingShape, { d: string; faceY: number }> = {
  round: { d: "M50 10 A42 42 0 1 1 49.99 10Z", faceY: 0 },
  blob: {
    d: "M52 8 C74 8 92 24 91 48 C90 70 80 92 52 93 C26 94 9 76 9 52 C9 26 28 8 52 8Z",
    faceY: 0,
  },
  square: { d: "M36 10 H64 A26 26 0 0 1 90 36 V66 A26 26 0 0 1 64 92 H36 A26 26 0 0 1 10 66 V36 A26 26 0 0 1 36 10Z", faceY: 0 },
  drop: { d: "M50 6 C68 28 88 40 88 60 A38 38 0 0 1 12 60 C12 40 32 28 50 6Z", faceY: 10 },
  ghost: {
    d: "M16 50 A34 34 0 0 1 84 50 V90 L73 82 L62 90 L50 82 L38 90 L27 82 L16 90Z",
    faceY: -2,
  },
  flower: { d: flowerPath(), faceY: 0 },
};

function Face({ mood, ink }: { mood: BotlingMood; ink: string }) {
  const stroke = { stroke: ink, strokeWidth: 3.6, strokeLinecap: "round" as const, fill: "none" };
  const eye = (cx: number, cy: number, right = false, rx = 4.2, ry = 5.6) => (
    <ellipse
      className={cn("botling-eye", right && "botling-eye-r")}
      cx={cx}
      cy={cy}
      rx={rx}
      ry={ry}
      fill={ink}
    />
  );

  switch (mood) {
    case "happy":
      return (
        <>
          <path d="M32 50 Q38 42 44 50" {...stroke} />
          <path d="M56 50 Q62 42 68 50" {...stroke} />
          <path d="M39 61 Q50 74 61 61" {...stroke} />
        </>
      );
    case "thinking":
      return (
        <>
          {eye(40, 46)}
          {eye(64, 46, true)}
          <path d="M45 65 Q52 62 58 64" {...stroke} />
          <circle cx="78" cy="30" r="2.4" fill={ink} opacity="0.55" />
          <circle cx="84" cy="22" r="3.4" fill={ink} opacity="0.55" />
        </>
      );
    case "focused":
      return (
        <>
          <path d="M32 42 L44 45" {...stroke} />
          <path d="M68 42 L56 45" {...stroke} />
          {eye(38, 51, false, 4, 3.4)}
          {eye(62, 51, true, 4, 3.4)}
          <path d="M44 65 H56" {...stroke} />
        </>
      );
    case "surprised":
      return (
        <>
          <circle className="botling-eye" cx="38" cy="47" r="5.6" fill={ink} />
          <circle className="botling-eye botling-eye-r" cx="62" cy="47" r="5.6" fill={ink} />
          <circle cx="50" cy="66" r="4.6" fill={ink} />
        </>
      );
    case "sleepy":
      return (
        <>
          <path d="M32 49 Q38 55 44 49" {...stroke} />
          <path d="M56 49 Q62 55 68 49" {...stroke} />
          <path d="M46 65 Q50 67 54 65" {...stroke} />
          <text x="72" y="30" fontSize="13" fontWeight="700" fill={ink} opacity="0.6">
            z
          </text>
        </>
      );
    case "worried":
      return (
        <>
          <path d="M31 41 L43 38" {...stroke} />
          <path d="M69 41 L57 38" {...stroke} />
          {eye(38, 49)}
          {eye(62, 49, true)}
          <path d="M41 67 Q50 59 59 67" {...stroke} />
        </>
      );
    case "wink":
      return (
        <>
          {eye(38, 48)}
          <path d="M56 49 Q62 43 68 49" {...stroke} />
          <path d="M39 61 Q50 72 61 61" {...stroke} />
        </>
      );
    case "neutral":
    default:
      return (
        <>
          {eye(38, 48)}
          {eye(62, 48, true)}
          <path d="M43 64 Q50 67 57 64" {...stroke} />
        </>
      );
  }
}

export function BotlingAvatar({
  appearance,
  size = 40,
  animated = false,
  className,
  title,
}: {
  appearance: BotlingAppearance;
  size?: number;
  animated?: boolean;
  className?: string;
  title?: string;
}) {
  const id = useId().replace(/:/g, "");
  const color = BOTLING_COLORS[appearance.color];
  const shape = SHAPES[appearance.shape];

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={cn("shrink-0 overflow-visible", animated && "botling-animated", className)}
    >
      <defs>
        <linearGradient id={`g-${id}`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={color.from} />
          <stop offset="1" stopColor={color.to} />
        </linearGradient>
        <radialGradient id={`h-${id}`} cx="0.32" cy="0.22" r="0.55">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="botling-body">
        <path d={shape.d} fill={`url(#g-${id})`} />
        <path d={shape.d} fill={`url(#h-${id})`} />
        <g transform={`translate(0 ${shape.faceY})`}>
          <Face mood={appearance.mood} ink={color.ink} />
        </g>
      </g>
    </svg>
  );
}
