import "server-only";
import { headers } from "next/headers";
import { whopsdk } from "./whop-sdk";

export type WhopUser = { userId: string };
export type AccessResult = WhopUser & {
  hasAccess: boolean;
  accessLevel: string;
};

export async function getWhopUser(): Promise<WhopUser | null> {
  try {
    const h = await headers();
    if (!h.get("x-whop-user-token")) return null;
    const { userId } = await whopsdk.verifyUserToken(h);
    return { userId };
  } catch {
    return null;
  }
}

export async function requireAccess(user: WhopUser): Promise<AccessResult> {
  const passId = process.env.WHOP_ACCESS_PASS_ID;
  if (!passId) {
    return { ...user, hasAccess: false, accessLevel: "no_access" };
  }
  try {
    const res = await whopsdk.users.checkAccess(passId, { id: user.userId });
    const accessLevel = res.access_level ?? "no_access";
    return {
      ...user,
      hasAccess: (res.has_access ?? false) || accessLevel === "admin",
      accessLevel,
    };
  } catch {
    return { ...user, hasAccess: false, accessLevel: "no_access" };
  }
}
