import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YAMORU",
    short_name: "YAMORU",
    description: "暮らしの「いつだっけ？」をなくす。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f2eb",
    theme_color: "#315c49",
    icons: [
      {
        src: "/pwa/yamoru-icon-v3-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/pwa/yamoru-icon-v3-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
