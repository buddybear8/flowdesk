// Edge-safe Auth.js config (no Prisma imports — middleware runs on Vercel's
// edge runtime, which can't load PrismaClient). The full config in lib/auth.ts
// extends this with the adapter + signIn callback that hits Whop's API.

import type { NextAuthConfig } from "next-auth";

export default {
  providers: [
    {
      id: "whop",
      name: "Whop",
      type: "oidc",
      issuer: "https://api.whop.com",
      clientId: process.env.WHOP_CLIENT_ID,
      clientSecret: process.env.WHOP_CLIENT_SECRET,
      authorization: { params: { scope: "openid profile email" } },
      // Whop strictly enforces nonce for the openid scope. Auth.js v5
      // defaults to ["pkce", "state"] for OIDC providers; we add nonce here.
      checks: ["pkce", "state", "nonce"],
      profile(profile) {
        return {
          id: profile.sub as string,
          whopMembershipId: profile.sub as string,
          email: profile.email as string,
          name: (profile.name as string | undefined) ?? null,
          image: (profile.picture as string | undefined) ?? null,
        };
      },
    },
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
} satisfies NextAuthConfig;
