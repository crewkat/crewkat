import { useEffect, useRef, useState } from "react";

/**
 * Draw-to-sign pad (desktop mouse/pen). Emits the raw base64 PNG the
 * server actions expect (saveDocument / signDocumentWithDrawnSignature).
 * A fresh drawing is required for every signing, exactly like the phone —
 * no stored signature is ever reused.
 */
export function SignaturePad({
  onChange,
  height = 170,
}: {
  onChange: (base64Png: string) => void;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inkRef = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 560;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#16232e";
  }, [height]);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const emit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onChange(dataUrl.split(",")[1] ?? "");
  };

  return (
    <div className="sigpad">
      <canvas
        ref={canvasRef}
        className="sigpad-canvas"
        style={{ height }}
        onPointerDown={(e) => {
          drawing.current = true;
          last.current = pos(e);
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
          if (!inkRef.current) { inkRef.current = true; setHasInk(true); }
        }}
        onPointerUp={() => {
          if (drawing.current && inkRef.current) emit();
          drawing.current = false;
          last.current = null;
        }}
        onPointerLeave={() => {
          drawing.current = false;
          last.current = null;
        }}
      />
      <div className="sigpad-foot">
        <span className="muted small">{hasInk ? "Signature captured — it is saved when you save the document." : "Draw the signature with the mouse or pen."}</span>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d");
            if (canvas && ctx) {
              ctx.save();
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.restore();
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
            }
            inkRef.current = false;
            setHasInk(false);
            onChange("");
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
