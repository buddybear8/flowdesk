// Module augmentation: tell Auth.js's User type about whopMembershipId so
// PrismaAdapter accepts it in profile() callback returns.

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    whopMembershipId?: string;
  }

  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    whopMembershipId?: string;
  }
}
