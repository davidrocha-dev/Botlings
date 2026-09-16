import { ImageResponse } from "next/og";
import { BrandIcon } from "@/lib/brand-icon";

const SIZES = new Set([192, 512]);

export async function GET(request: Request, ctx: RouteContext<"/pwa-icon/[size]">) {
  const size = Number((await ctx.params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const maskable = new URL(request.url).searchParams.has("maskable");

  return new ImageResponse(<BrandIcon size={size} padded={maskable} />, {
    width: size,
    height: size,
    headers: { "Cache-Control": "public, max-age=86400, immutable" },
  });
}
