import { auth, signOut } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ padding: 20, background: "var(--color-background-tertiary)" }}
    >
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>
          Settings
        </h1>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2, marginBottom: 18 }}>
          Account info and session controls. More settings coming soon.
        </p>

        <div
          className="bg-bg-primary rounded-[12px]"
          style={{ border: "0.5px solid var(--color-border-tertiary)", padding: 16, marginBottom: 12 }}
        >
          <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>
            Account
          </div>
          <dl style={{ fontSize: 12, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 18, rowGap: 6 }}>
            {user?.name && (
              <>
                <dt style={{ color: "var(--color-text-secondary)" }}>Name</dt>
                <dd style={{ color: "var(--color-text-primary)" }}>{user.name}</dd>
              </>
            )}
            {user?.email && (
              <>
                <dt style={{ color: "var(--color-text-secondary)" }}>Email</dt>
                <dd style={{ color: "var(--color-text-primary)" }}>{user.email}</dd>
              </>
            )}
            {!user && (
              <>
                <dt style={{ color: "var(--color-text-secondary)" }}>Status</dt>
                <dd style={{ color: "var(--color-text-primary)" }}>Not signed in</dd>
              </>
            )}
          </dl>
        </div>

        <div
          className="bg-bg-primary rounded-[12px]"
          style={{ border: "0.5px solid var(--color-border-tertiary)", padding: 16, marginBottom: 12 }}
        >
          <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>
            Session
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: "7px 14px",
                borderRadius: 6,
                background: "rgba(231, 106, 106, 0.12)",
                color: "#E76A6A",
                border: "0.5px solid rgba(231, 106, 106, 0.45)",
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </form>
        </div>

        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 18, lineHeight: 1.6 }}>
          Planned: notification preferences, watchlist defaults, theme, API key management.
        </div>
      </div>
    </div>
  );
}
