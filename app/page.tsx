import { redirect } from "next/navigation";

export default function Home() {
  // Daily Watches temporarily removed 2026-10-20 — land on Options GEX.
  redirect("/gex");
}
