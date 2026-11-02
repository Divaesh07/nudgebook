import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nudgebook",
    short_name: "Nudgebook",
    description: "Log what you did. Get nudged when it's due again.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFBEB",
    theme_color: "#92400E",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Android: share any SMS / text into the app
    share_target: { action: "/", method: "GET", params: { title: "title", text: "text", url: "url" } },
  };
}
