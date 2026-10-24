import type { MetadataRoute } from "next";

/**
 * Makes the app installable: "Install app" in Chrome or Edge on Windows, Mac and Linux, and "Add to
 * Home Screen" on a phone. The installed app is a window on this server, so the server must be running
 * and reachable (on a phone: over Tailscale, see README → Use it on your phone).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Better than GrokBot",
    short_name: "Better than GrokBot",
    description: "Your AI team, each bot with its own computer.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#F7F7F6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
