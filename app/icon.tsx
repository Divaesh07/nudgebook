import { ImageResponse } from "next/og";

export function generateImageMetadata() {
  return [192, 512].map((s) => ({ id: String(s), contentType: "image/png", size: { width: s, height: s } }));
}

/** Brown square, open book with a dot: the "nudge". Glyph sits in the maskable safe zone. */
export default async function Icon({ id }: { id: Promise<string | number> }) {
  const s = Number(await id);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#92400E" }}>
        <div style={{ display: "flex", position: "relative", width: s * 0.5, height: s * 0.38 }}>
          <div style={{ width: "50%", height: "100%", background: "#FFFBEB", borderRadius: `${s * 0.04}px 0 0 ${s * 0.04}px`, marginRight: s * 0.012 }} />
          <div style={{ width: "50%", height: "100%", background: "#FEF3C7", borderRadius: `0 ${s * 0.04}px ${s * 0.04}px 0` }} />
          <div style={{ position: "absolute", right: -s * 0.06, top: -s * 0.08, width: s * 0.17, height: s * 0.17, borderRadius: 999, background: "#818CF8", border: `${s * 0.025}px solid #92400E` }} />
        </div>
      </div>
    ),
    { width: s, height: s },
  );
}
