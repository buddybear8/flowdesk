import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Champagne Intelligence",
    short_name: "Champagne",
    description: "Trading analytics",
    start_url: "/",
    display: "standalone",
    // No orientation lock — the charts module benefits from landscape.
    background_color: "#0B1220",
    theme_color: "#0B1220",
    // No `maskable` entries yet: the artwork is full-bleed with no safe-zone
    // padding, so circular/squircle launcher masks would crop it. Add real
    // maskable variants (logo inset to the central 80%) before re-adding.
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
