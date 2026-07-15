// Web App Manifest: lets members install the portal as an app (Android/iOS).
// Public on purpose: browsers fetch the manifest without cookies.
export const dynamic = "force-static";

export function GET() {
  return new Response(
    JSON.stringify({
      name: "Inventário Familiar",
      short_name: "Inventário",
      description: "Portal privado da família",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#FCFCFB",
      theme_color: "#0F172A",
      icons: [
        { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        { src: "/icon1", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
      ],
    }),
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
