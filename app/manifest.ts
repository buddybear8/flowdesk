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
      // Dedicated safe-zone variants for launcher masks (circle/squircle):
      // artwork inset to the central 80% on the #0B1220 brand background.
      {
        src: "/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
