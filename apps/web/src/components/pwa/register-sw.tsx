"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/push";

export function RegisterServiceWorker() {
  useEffect(() => {
    registerServiceWorker().catch(() => {});
  }, []);
  return null;
}
