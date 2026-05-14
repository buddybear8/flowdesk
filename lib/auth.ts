// Auth.js v5 with JWT sessions + Whop access-pass verification. No Prisma
// adapter — we mint sessions from the JWT and upsert the User row explicitly
// in the signIn callback. The adapter's createUser/linkAccount flow would
// trip on schema fields it doesn't know about (whopMembershipId) and break
// first-time logins for new users.

import NextAuth from "next-auth";
import { prisma } from "./prisma";
import authConfig from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
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
        if (!data.has_access) return false;
      } catch (err) {
        console.error("[auth] Whop access check threw:", err);
        return false;
      }

      // Upsert the User row so the `users` table is the source of truth for
      // who's signed in, and refresh lastLoginAt + membershipCheckedAt on
      // every login.
      try {
        const email = typeof profile.email === "string" ? profile.email : `${sub}@user.whop.local`;
        const name = typeof profile.name === "string" ? profile.name : null;
        const image = typeof profile.picture === "string" ? profile.picture : null;

        await prisma.user.upsert({
          where: { whopMembershipId: sub },
          create: {
            whopMembershipId: sub,
            email,
            name,
            image,
            lastLoginAt: new Date(),
            membershipCheckedAt: new Date(),
          },
          update: {
            email,
            name,
            image,
            lastLoginAt: new Date(),
            membershipCheckedAt: new Date(),
          },
        });
      } catch (err) {
        // Don't block sign-in on a DB hiccup — JWT cookie is still authoritative.
        console.error("[auth] User upsert failed:", err);
      }

      return true;
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
