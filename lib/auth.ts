// Full Auth.js v5 config with Prisma adapter + Whop access-pass verification.
// The signIn callback hits Whop's check-access endpoint and rejects users
// who don't hold an active membership for WHOP_ACCESS_PASS_ID.

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";
import authConfig from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  debug: true,
  logger: {
    error(error) {
      console.error("[auth][error]", error.message);
      const anyErr = error as unknown as {
        cause?: {
          err?: unknown;
          error?: unknown;
          error_description?: unknown;
          response?: { status?: number; statusText?: string; url?: string };
        };
        stack?: string;
      };
      if (anyErr.cause) {
        console.error("[auth][error.cause]", JSON.stringify(anyErr.cause, null, 2));
      }
      if (anyErr.stack) console.error("[auth][error.stack]", anyErr.stack);
    },
    warn(code) {
      console.warn("[auth][warn]", code);
    },
    debug(code, metadata) {
      console.log("[auth][debug]", code, metadata ? JSON.stringify(metadata).slice(0, 500) : "");
    },
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "whop") return false;

      const accessToken = account.access_token;
      const sub = profile?.sub;
      const passId = process.env.WHOP_ACCESS_PASS_ID;

      if (!accessToken || !sub || !passId) {
        console.error("[auth] missing accessToken/sub/passId on signIn");
        return false;
      }

      try {
        const res = await fetch(
          `https://api.whop.com/api/v1/users/${sub}/access/${passId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) {
          console.error(`[auth] Whop access check failed: ${res.status}`);
          return false;
        }
        const data = (await res.json()) as { has_access?: boolean };
        return Boolean(data.has_access);
      } catch (err) {
        console.error("[auth] Whop access check threw:", err);
        return false;
      }
    },
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.whopMembershipId = (user as { whopMembershipId?: string }).whopMembershipId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) {
        session.user.id = token.uid as string;
      }
      return session;
    },
  },
});
