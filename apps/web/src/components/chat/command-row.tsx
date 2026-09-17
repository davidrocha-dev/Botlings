"use client";

import { motion } from "motion/react";
import { SquareSlash } from "lucide-react";
import type { Message } from "@/lib/types";
import { Markdown } from "./markdown";

/** The server's answer to a slash command: compact, and clearly not the agent talking. */
export function CommandRow({ message }: { message: Message }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 ml-9 flex max-w-[85%] gap-2.5 rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-sm md:max-w-md"
    >
      <SquareSlash className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1 leading-snug break-words">
        <Markdown text={message.text} />
      </div>
    </motion.div>
  );
}
