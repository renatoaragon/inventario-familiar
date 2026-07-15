// 512px icon for the manifest (Android install): same star as the apple-icon.
import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

const STAR =
  "polygon(50% 2%, 61% 36%, 97% 36%, 68% 58%, 79% 94%, 50% 72%, 21% 94%, 32% 58%, 3% 36%, 39% 36%)";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)",
        }}
      >
        <div
          style={{
            width: "72%",
            height: "72%",
            background: "linear-gradient(180deg, #FBBF24 0%, #D97706 100%)",
            clipPath: STAR,
          }}
        />
      </div>
    ),
    size,
  );
}
