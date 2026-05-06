// Gate every request behind Auth.js. Three policies:
//   - /api/auth/*  → always pass through (sign-in callbacks)
//   - /api/*       → 401 JSON if not signed in
//   - everything else → redirect to /login if not signed in
// Signed-in users hitting /login bounce back to /.
//
// Edge-safe: imports lib/auth.config (no Prisma).

import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;

  if (path.startsWith("/api/auth/")) return;

  if (path === "/login") {
    if (isLoggedIn) return NextResponse.redirect(new URL("/", req.nextUrl));
    return;
  }

  if (path.startsWith("/api/")) {
    if (!isLoggedIn) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return;
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl);
    if (path !== "/") loginUrl.searchParams.set("from", path);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  // Run on every request except Next internals + static files (anything with a dot in the last segment).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\..*).*)"],
};
