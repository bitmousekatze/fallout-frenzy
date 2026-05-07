import { useEffect, useRef } from "react";

interface JoystickState {
  active: boolean;
  touchId: number | null;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
}

interface MobileControlsProps {
  onMove: (dx: number, dy: number) => void; // normalized -1..1
  onShootStart: () => void;
  onShootEnd: () => void;
}

const JOYSTICK_RADIUS = 56;
const KNOB_RADIUS = 22;
// Joystick zone: left 40% of screen width
const JOYSTICK_ZONE_FRACTION = 0.4;

export default function MobileControls({ onMove, onShootStart, onShootEnd }: MobileControlsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const joystick = useRef<JoystickState>({ active: false, touchId: null, originX: 120, originY: 0, dx: 0, dy: 0 });
  const shootTouchId = useRef<number | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Reset joystick origin to bottom-left area
      joystick.current.originX = 120;
      joystick.current.originY = window.innerHeight - 140;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const j = joystick.current;
      const ox = j.active ? j.originX : 120;
      const oy = j.active ? j.originY : canvas.height - 140;

      // Outer ring
      ctx.beginPath();
      ctx.arc(ox, oy, JOYSTICK_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Knob
      const kx = ox + j.dx * JOYSTICK_RADIUS;
      const ky = oy + j.dy * JOYSTICK_RADIUS;
      ctx.beginPath();
      ctx.arc(kx, ky, KNOB_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = j.active ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.20)";
      ctx.fill();

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const j = joystick.current;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const isLeftZone = t.clientX < window.innerWidth * JOYSTICK_ZONE_FRACTION;
        if (isLeftZone && !j.active) {
          j.active = true;
          j.touchId = t.identifier;
          j.originX = t.clientX;
          j.originY = t.clientY;
          j.dx = 0;
          j.dy = 0;
          onMove(0, 0);
        } else if (!isLeftZone && shootTouchId.current === null) {
          shootTouchId.current = t.identifier;
          onShootStart();
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const j = joystick.current;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === j.touchId) {
          const rawDx = t.clientX - j.originX;
          const rawDy = t.clientY - j.originY;
          const len = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
          if (len > 0) {
            j.dx = Math.min(rawDx / JOYSTICK_RADIUS, rawDx / len);
            j.dy = Math.min(rawDy / JOYSTICK_RADIUS, rawDy / len);
          } else {
            j.dx = 0;
            j.dy = 0;
          }
          onMove(j.dx, j.dy);
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      const j = joystick.current;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === j.touchId) {
          j.active = false;
          j.touchId = null;
          j.dx = 0;
          j.dy = 0;
          onMove(0, 0);
        }
        if (t.identifier === shootTouchId.current) {
          shootTouchId.current = null;
          onShootEnd();
        }
      }
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [onMove, onShootStart, onShootEnd]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-auto absolute inset-0 z-10"
      style={{ touchAction: "none" }}
    />
  );
}
