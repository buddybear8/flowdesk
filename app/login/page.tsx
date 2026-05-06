// Pre-auth login page. Single "Continue with Whop" button. Renders an error
// banner if Auth.js redirected here with ?error=AccessDenied (Whop OAuth
// succeeded but the user doesn't hold the required access pass).

import Image from "next/image";
import { signIn } from "@/lib/auth";

type SearchParams = Promise<{ error?: string; from?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error, from } = await searchParams;

  return (
    <div
      className="min-h-screen w-screen flex items-center justify-center px-6"
      style={{ background: "var(--color-background-tertiary)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 flex flex-col items-center gap-6"
        style={{
          background: "var(--color-background-primary)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        <Image
          src="/logo.png"
          alt="Champagne Sessions"
          width={64}
          height={64}
          className="rounded-xl"
        />

        <div className="text-center">
          <h1
            className="text-2xl font-semibold"
            style={{ color: "var(--color-text-primary, #F5EFD9)" }}
          >
            Champagne Sessions
          </h1>
          <p
            className="text-sm mt-2"
            style={{ color: "var(--color-text-secondary, #B8C5D6)" }}
          >
            Sign in with your Whop account to continue.
          </p>
        </div>

        {error === "AccessDenied" && (
          <div
            className="w-full rounded-lg px-4 py-3 text-sm"
            style={{
              background: "rgba(220, 38, 38, 0.12)",
              color: "#FCA5A5",
              border: "1px solid rgba(220, 38, 38, 0.4)",
            }}
          >
            Your Whop account doesn&apos;t have access to Champagne Sessions.
            If you believe this is a mistake, reach out for support.
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("whop", { redirectTo: from || "/" });
          }}
          className="w-full"
        >
          <button
            type="submit"
            className="w-full rounded-lg px-4 py-3 font-medium transition-opacity hover:opacity-90"
            style={{
              background: "var(--color-brand-gold, #C9A55A)",
              color: "#0F2040",
            }}
          >
            Continue with Whop
          </button>
        </form>
      </div>
    </div>
  );
}
