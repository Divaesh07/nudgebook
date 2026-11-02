import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refreshes the Supabase session cookie and sends signed-out visitors to /login. */
export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => res.headers.set(k, v));
      },
    },
  });
  const { data } = await db.auth.getClaims();
  const { pathname, search } = req.nextUrl;

  if (!data?.claims && !pathname.startsWith("/login")) {
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    if (pathname !== "/" || search) to.searchParams.set("next", pathname + search); // keep shared text
    return NextResponse.redirect(to);
  }
  return res;
}

export const config = {
  matcher: ["/((?!api|auth|_next/static|_next/image|sw.js|manifest.webmanifest|icon|apple-icon|favicon.ico).*)"],
};
