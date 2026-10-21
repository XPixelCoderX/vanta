import { useEffect, useRef, useState } from "react";
import { EMPTY_HUD, LidarEngine, type HudState } from "./game/engine";
import { Hud } from "./components/Hud";
import { PauseOverlay, WinOverlay } from "./components/Overlays";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<LidarEngine | null>(null);
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new LidarEngine(canvas, setHud);
    engineRef.current = engine;
    engine.init();

    const pointerCoarse = window.matchMedia("(pointer: coarse)");
    setIsTouch(pointerCoarse.matches);
    const onPointerMode = (event: MediaQueryListEvent) => setIsTouch(event.matches);
    pointerCoarse.addEventListener?.("change", onPointerMode);

    // Browsers only allow audio after a user gesture; unlock on the first one.
    const unlock = () => engine.unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    return () => {
      pointerCoarse.removeEventListener?.("change", onPointerMode);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink">
      <canvas
        ref={canvasRef}
        className="game-canvas fixed inset-0 z-0 h-full w-full"
        aria-label="First-person LiDAR tunnel view"
      />

      <div className="pointer-events-none fixed inset-0 z-[2]">
        <div className="hud-vignette absolute inset-0 opacity-80" />
      </div>
      <div className="grain pointer-events-none fixed inset-0 z-[3] opacity-80" />
      <div className="scanlines pointer-events-none fixed inset-0 z-[4] opacity-35" />

      {hud.phase === "playing" && <Hud hud={hud} engine={engineRef.current} isTouch={isTouch} />}
      {hud.phase === "paused" && <PauseOverlay hud={hud} engine={engineRef.current} />}
      {hud.phase === "won" && <WinOverlay hud={hud} engine={engineRef.current} />}
    </div>
  );
}
