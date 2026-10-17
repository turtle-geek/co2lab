import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function Qr({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#26321f", light: "#fffaf0" } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [value]);
  return (
    <div
      className="qr"
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
