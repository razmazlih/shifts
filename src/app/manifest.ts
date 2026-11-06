import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "משמרת — ניהול משמרות",
    short_name: "משמרת",
    description: "הצוות שלכם, מסודר",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f8fa",
    theme_color: "#123a40",
    lang: "he",
    dir: "rtl",
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
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
