import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "./dictionaries";

export async function getLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const accept = (await headers()).get("accept-language") ?? "";
  const preferred = accept.split(",").map((part) => part.split(";")[0].trim().slice(0, 2).toLowerCase());
  return preferred.find(isLocale) ?? defaultLocale;
}
