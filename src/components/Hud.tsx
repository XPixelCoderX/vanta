import { useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import type { HudState, LidarEngine } from "../game/engine";
import { PauseIcon, ScanIcon, ScanMark, SoundOff, SoundOn } from "./Icons";

interface HudProps {
  hud: HudState;
  engine: LidarEngine | null;
  isTouch: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pad = (n: number, width = 2) => String(Math.floor(n)).padStart(width, "0");
const mmss = (seconds: number) => `${pad(seconds / 60)}:${pad(seconds % 60)}`;

function Key({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center border border-white/20 bg-black/40 px-1 font-mono text-[9px] text-bone/85">
      {children}
    </span>
  );
}

function Joystick({ engine }: { engine: LidarEngine | null }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef(false);

  const update = (clientX: number, clientY: number) => {
    const el = baseRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = rect.width * 0.34;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    setKnob({ x: dx, y: dy });
    engine?.setTouchMove(dx / max, -dy / max);
  };

  const finish = () => {
    active.current = false;
    setKnob({ x: 0, y: 0 });
    engine?.setTouchMove(0, 0);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={baseRef}
        role="group"
        aria-label="Movement joystick"
        className="relative h-[104px] w-[104px] touch-none rounded-full border border-signal/25 bg-black/35 backdrop-blur-sm"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          active.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          update(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (!active.current) return;
          e.preventDefault();
          update(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          finish();
        }}
        onPointerCancel={finish}
        onPointerLeave={() => {
          if (active.current) finish();
        }}
      >
        <span className="absolute inset-3 rounded-full border border-white/[0.07]" />
        <span
          className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-signal/50 bg-signal/10 shadow-[0_0_20px_rgba(169,245,214,0.12)]"
          style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
        >
          <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal" />
        </span>
      </div>
      <span className="mono-label-sm text-fog-dim">Move</span>
    </div>
  );
}

function TouchControls({ hud, engine }: { hud: HudState; engine: LidarEngine | null }) {
  const ready = hud.energy >= 99;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-end justify-between px-4 pb-5">
      <div className="pointer-events-auto">
        <Joystick engine={engine} />
      </div>
      <button
        aria-label="Emit a LiDAR sweep"
        className={`pointer-events-auto relative flex h-[86px] w-[86px] touch-none select-none flex-col items-center justify-center rounded-full border bg-black/40 backdrop-blur-sm transition-all active:scale-95 ${
          ready ? "border-signal/60 text-signal" : "border-ember/35 text-ember/70"
        }`}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          engine?.startScanHold();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="absolute inset-1.5 rounded-full border border-signal/20" />
        <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.65"
            strokeWidth="2"
            strokeDasharray={`${(hud.energy / 100) * 283} 283`}
          />
        </svg>
        <ScanIcon className="h-5 w-5" />
        <span className="mono-label-sm mt-1">{hud.scanning ? "Sweep" : ready ? "Scan" : "Cooling"}</span>
        <span className="mt-0.5 font-mono text-[8px] tabular text-fog">
          {hud.scanning ? `${Math.round(hud.scanProgress * 100)}%` : ready ? "RDY" : `${hud.cooldownLeft.toFixed(1)}s`}
        </span>
      </button>
    </div>
  );
}

export function Hud({ hud, engine, isTouch }: HudProps) {
  const cooling = hud.energy < 99;
  const exitBearingPos = clamp(50 + (hud.exitBearing / 90) * 25, 4, 96);
  const logs = hud.log.slice(-4);
  const headingName =
    hud.heading < 45 || hud.heading >= 315 ? "N" : hud.heading < 135 ? "E" : hud.heading < 225 ? "S" : "W";
  const currentTutorial = hud.isTutorial && hud.tutorialStep >= 0 ? hud.tutorial[hud.tutorialStep] : null;
  const doneCount = hud.tutorial.filter((item) => item.done).length;
  const levelLabel = hud.isTutorial ? "Tutorial" : `Level ${hud.level} of ${hud.levelCount}`;

  const scanDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    engine?.startScanHold();
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden select-none">
      {hud.scanning && (
        <div className="pointer-events-none absolute left-1/2 top-[62%] z-[6] -translate-x-1/2">
          <span className="mono-label-sm flex items-center gap-2 border border-signal/20 bg-[#04110e]/70 px-2 py-1 text-signal/90 backdrop-blur-sm">
            <span className="h-1 w-1 animate-pulse rounded-full bg-signal" />
            Sweeping · {Math.round(hud.scanProgress * 100)}%
          </span>
        </div>
      )}

      <div className="hud-vignette pointer-events-none absolute inset-0" />

      {/* Top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-4 pt-4 md:px-6 md:pt-5">
        <div className="pointer-events-auto flex items-center gap-3">
          <ScanMark className="h-7 w-7 text-signal/90" />
          <div className="leading-none">
            <div className="font-mono text-[11px] font-semibold tracking-[0.34em] text-bone">VANTA</div>
            <div className="mono-label-sm mt-1.5 text-fog-dim">Tunnel probe · live</div>
          </div>
          <span className="mx-1 hidden h-6 w-px bg-white/12 sm:block" />
          <div className="hidden sm:block">
            <div className="mono-label-sm text-fog-dim">{levelLabel}</div>
            <div className="mono-label mt-1 text-bone/85">{hud.levelName}</div>
          </div>
        </div>

        <div className="absolute left-1/2 top-4 hidden w-[300px] -translate-x-1/2 md:block lg:w-[360px]">
          <div className="flex items-center justify-between px-1">
            <span className="mono-label-sm text-fog-dim">W · 270°</span>
            <span className="font-mono text-[10px] tabular text-bone/75">
              {String(hud.heading).padStart(3, "0")}° {headingName}
            </span>
            <span className="mono-label-sm text-fog-dim">E · 090°</span>
          </div>
          <div className="compass mt-1.5 h-3.5" />
          <div className="relative -mt-[13px] h-3">
            {hud.exitSeen && (
              <span className="absolute top-0 -translate-x-1/2" style={{ left: `${exitBearingPos}%` }} aria-hidden="true">
                <span className="block h-1.5 w-1.5 rotate-45 border border-signal bg-signal/80" />
              </span>
            )}
            <span className="absolute left-1/2 top-0 h-2.5 w-px -translate-x-1/2 bg-signal" />
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            <span className={`h-1.5 w-1.5 rotate-45 ${hud.exitSeen ? "bg-signal" : "bg-white/25"}`} />
            <span className={`mono-label-sm tabular ${hud.exitSeen ? "text-signal/90" : "text-fog-dim"}`}>
              {hud.exitSeen ? `EXIT · ${hud.exitDistance.toFixed(1)} m` : "EXIT · UNLOCATED"}
            </span>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <div className="mono-label-sm mr-1 hidden items-center gap-2 border border-white/10 bg-black/30 px-2.5 py-2 text-fog backdrop-blur-sm sm:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${hud.exitSeen ? "bg-signal" : "bg-white/30"}`} />
            {hud.exitSeen ? "Exit located" : "Exit hidden"}
          </div>
          <button
            onClick={() => engine?.toggleMuted()}
            aria-label={hud.muted ? "Enable sound" : "Mute sound"}
            className="flex h-9 w-9 items-center justify-center border border-white/12 bg-black/30 text-fog backdrop-blur-sm transition-colors hover:border-signal/40 hover:text-signal"
          >
            {hud.muted ? <SoundOff /> : <SoundOn />}
          </button>
          <button
            onClick={() => engine?.pause()}
            aria-label="Pause"
            className="flex h-9 w-9 items-center justify-center border border-white/12 bg-black/30 text-fog backdrop-blur-sm transition-colors hover:border-signal/40 hover:text-signal"
          >
            <PauseIcon />
          </button>
        </div>
      </header>

      {/* Mobile mission strip */}
      <div className="absolute inset-x-0 top-[74px] flex items-center justify-between gap-3 px-4 sm:hidden">
        <div className="mono-label-sm flex items-center gap-2 border border-white/10 bg-black/30 px-2 py-1.5 text-fog backdrop-blur-sm">
          <span className={`h-1.5 w-1.5 rotate-45 ${hud.exitSeen ? "bg-signal" : "border border-white/30"}`} />
          {hud.exitSeen ? `EXIT ${hud.exitDistance.toFixed(1)} m` : "EXIT HIDDEN"}
        </div>
        <div className="mono-label-sm border border-white/10 bg-black/30 px-2 py-1.5 tabular text-fog backdrop-blur-sm">
          {hud.isTutorial ? "TUTORIAL" : `LVL ${hud.level}/${hud.levelCount}`} · {mmss(hud.levelTime)}
        </div>
      </div>

      {/* New-level banner: appears the moment the next tunnel loads */}
      {hud.showBanner && (
        <div className="absolute inset-x-0 top-[30%] flex justify-center px-6">
          <div key={hud.level} className="animate-banner flex flex-col items-center text-center">
            <div className="mono-label text-signal/85">{hud.bannerKicker}</div>
            <div className="mt-3 flex items-center gap-3">
              <span className="h-px w-10 bg-signal/40" />
              <span className="mono-label-sm text-fog">
                Level {hud.level} of {hud.levelCount}
              </span>
              <span className="h-px w-10 bg-signal/40" />
            </div>
            <h2 className="mt-2 font-sans text-[clamp(2.2rem,6vw,3.6rem)] font-light leading-none tracking-[-0.035em] text-bone drop-shadow-[0_2px_20px_rgba(3,8,7,0.9)]">
              {hud.levelName}
            </h2>
            <div className="mt-4 flex items-center gap-2.5 border border-signal/40 bg-[#04110e]/80 px-4 py-2 backdrop-blur-md">
              <span className="h-2 w-2 rotate-45 bg-[#78ffa0]" />
              <span className="mono-label text-bone">
                {hud.backrooms ? "Objective: scan the black doors" : "Objective: find the exit"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Persistent objective card for every level after the tutorial */}
      {!hud.isTutorial && (
        <div className="absolute left-1/2 top-[118px] w-[min(92vw,460px)] -translate-x-1/2 md:top-[96px]">
          <div className="flex items-center gap-3 border border-signal/30 bg-[#04110e]/85 px-4 py-2.5 backdrop-blur-md">
            <span
              className={`h-2.5 w-2.5 shrink-0 rotate-45 ${
                hud.exitSeen ? "bg-[#78ffa0] shadow-[0_0_12px_rgba(120,255,160,0.7)]" : "border border-[#78ffa0]/70"
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="mono-label-sm text-signal/80">Objective · {levelLabel}</div>
              <p className="mt-0.5 font-sans text-[15px] leading-snug text-bone">
                {hud.backrooms ? "Scan the black doors" : "Find the light-green exit"}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-fog-dim">
                {hud.backrooms
                  ? hud.exitSeen
                    ? "One door returned green. Follow the marker and walk through it."
                    : `${hud.doorsSeen}/${hud.doorsTotal} doors scanned · scan each black door to find the exit.`
                  : hud.exitSeen
                    ? "Exit located. Follow the green marker on the compass."
                    : "It stays invisible until a sweep hits it."}
              </p>
            </div>
            <span className={`mono-label-sm shrink-0 tabular ${hud.exitSeen ? "text-[#78ffa0]" : "text-fog-dim"}`}>
              {hud.exitSeen ? `${hud.exitDistance.toFixed(1)} m` : hud.backrooms ? `${hud.doorsSeen}/${hud.doorsTotal}` : "Hidden"}
            </span>
          </div>
        </div>
      )}

      {/* Tutorial card: always shows the current objective */}
      {currentTutorial && (
        <div className="absolute left-1/2 top-[118px] w-[min(92vw,520px)] -translate-x-1/2 md:top-[96px]">
          <div className="border border-signal/30 bg-[#04110e]/85 px-4 py-3 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <span className="mono-label-sm text-signal/80">
                Tutorial · step {hud.tutorialStep + 1} of {hud.tutorial.length}
              </span>
              <span className="mono-label-sm tabular text-fog-dim">
                {doneCount}/{hud.tutorial.length}
              </span>
            </div>
            <p className="mt-1.5 font-sans text-[15px] leading-snug text-bone">{currentTutorial.text}</p>
          </div>
        </div>
      )}

      {/* Left panel: tutorial checklist, or level info afterwards */}
      <aside className="absolute left-6 top-[122px] hidden w-[260px] flex-col gap-3 lg:flex">
        {!hud.isTutorial && (
          <div className="panel-edge border border-signal/15 bg-[#040d0b]/60 p-4 backdrop-blur-[3px]">
            <div className="flex items-center justify-between">
              <span className="mono-label text-signal/80">{levelLabel}</span>
              <span className="mono-label-sm tabular text-fog-dim">{mmss(hud.levelTime)}</span>
            </div>
            <h2 className="mt-2 font-sans text-[17px] font-normal leading-tight text-bone">{hud.levelName}</h2>
            <div className="mt-3 flex gap-1">
              {Array.from({ length: hud.levelCount }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 ${
                    i + 1 < hud.level ? "bg-signal/70" : i + 1 === hud.level ? "bg-[#78ffa0]" : "bg-white/10"
                  }`}
                />
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="mono-label-sm text-fog-dim">Sweeps this level</span>
              <span className="font-mono text-[11px] tabular text-bone/85">{pad(hud.levelScans)}</span>
            </div>
          </div>
        )}
        {hud.isTutorial && (
        <div className="panel-edge border border-signal/15 bg-[#040d0b]/60 p-4 backdrop-blur-[3px]">
          <div className="flex items-center justify-between">
            <span className="mono-label text-signal/80">Objectives</span>
            <span className="mono-label-sm text-fog-dim">
              {doneCount}/{hud.tutorial.length}
            </span>
          </div>
          <ul className="mt-3 space-y-2.5">
            {hud.tutorial.map((item, i) => {
              const current = i === hud.tutorialStep;
              return (
                <li key={item.text} className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${
                      item.done ? "border-signal bg-signal/80" : current ? "border-ember" : "border-white/20"
                    }`}
                  >
                    {item.done && <span className="h-1.5 w-1.5 bg-[#062019]" />}
                  </span>
                  <span
                    className={`text-[12px] leading-snug ${
                      item.done ? "text-fog-dim line-through" : current ? "text-bone" : "text-fog"
                    }`}
                  >
                    {item.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        )}

        <div className="border border-white/10 bg-[#040d0b]/45 px-4 py-3 backdrop-blur-[3px]">
          <div className="flex items-center justify-between">
            <span className="mono-label-sm text-fog-dim">Exit signal</span>
            <span className={`mono-label-sm ${hud.exitSeen ? "text-signal" : "text-fog-dim"}`}>
              {hud.exitSeen ? "LOCATED" : "UNLOCATED"}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="mono-label-sm text-fog-dim">Distance walked</span>
            <span className="font-mono text-[12px] tabular text-bone/85">{hud.walked} m</span>
          </div>
        </div>
      </aside>

      {/* Right telemetry panel */}
      <aside className="absolute right-6 top-[122px] hidden w-[228px] flex-col gap-3 xl:flex">
        <div className="border border-signal/15 bg-[#040d0b]/55 px-4 py-3 backdrop-blur-[3px]">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="mono-label text-signal/80">Scan telemetry</span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-1 animate-pulse rounded-full bg-signal" />
              <span className="mono-label-sm text-fog-dim">Live</span>
            </span>
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="mono-label-sm text-fog-dim">Return points</span>
            <span className="font-mono text-[11px] tabular text-bone/85">{hud.points.toLocaleString()}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="mono-label-sm text-fog-dim">Sweeps issued</span>
            <span className="font-mono text-[11px] tabular text-bone/85">{pad(hud.scans, 3)}</span>
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="mono-label-sm text-fog-dim">Pulse cooldown</span>
            <span className={`font-mono text-[10px] tabular ${cooling ? "text-ember" : "text-signal"}`}>
              {hud.scanning ? "SWEEP" : cooling ? `${hud.cooldownLeft.toFixed(1)}s` : "READY"}
            </span>
          </div>
          <div className="mt-1 flex gap-0.5">
            {Array.from({ length: 20 }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 ${
                  i < Math.round(hud.energy / 5) ? (cooling ? "bg-ember" : "bg-signal/70") : "bg-white/10"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="border border-white/10 bg-[#040d0b]/55 px-4 py-3 backdrop-blur-[3px]">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="mono-label text-fog">Event log</span>
            <span className="mono-label-sm text-fog-dim">{pad(hud.log.length)}</span>
          </div>
          <div className="mt-2 min-h-[76px] space-y-1.5">
            {logs.length === 0 && <p className="font-mono text-[9px] text-fog-dim">AWAITING TELEMETRY…</p>}
            {logs.map((entry) => (
              <div key={entry.id} className="flex gap-2 font-mono text-[9px] leading-snug">
                <span className="shrink-0 text-fog-dim">{entry.stamp}</span>
                <span
                  className={
                    entry.tone === "danger"
                      ? "text-danger"
                      : entry.tone === "good"
                        ? "text-signal"
                        : entry.tone === "warn"
                          ? "text-ember/90"
                          : "text-fog"
                  }
                >
                  {entry.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Center crosshair */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative h-12 w-12 opacity-70">
          <span className="absolute left-1/2 top-1/2 h-px w-2 -translate-x-1/2 -translate-y-1/2 bg-signal/70" />
          <span className="absolute left-1/2 top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-signal/70" />
          <span className="absolute inset-[15px] rounded-full border border-signal/30" />
          <span className="absolute inset-0 rounded-full border border-white/[0.08]" />
        </div>
      </div>

      {/* Exit prompt */}
      {hud.prompt && (
        <div className="absolute bottom-[148px] left-1/2 -translate-x-1/2 md:bottom-[156px]">
          <div className="flex items-center gap-3 border border-signal/50 bg-[#04150f]/85 px-4 py-2.5 backdrop-blur-md">
            <span className="mono-label text-signal">{hud.prompt}</span>
          </div>
        </div>
      )}

      {/* Desktop scan controls */}
      {!isTouch && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-[#020706]/85 via-[#020706]/30 to-transparent px-4 pb-5 pt-14">
          <div className="flex items-center gap-5">
            <div className="hidden items-center gap-1.5 lg:flex">
              <Key>W</Key>
              <Key>A</Key>
              <Key>S</Key>
              <Key>D</Key>
              <span className="mono-label-sm ml-1 text-fog-dim">Move</span>
            </div>
            <button
              onPointerDown={scanDown}
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Emit a LiDAR sweep"
              className={`group relative flex h-[62px] min-w-[230px] touch-none items-center justify-between gap-5 overflow-hidden border px-5 backdrop-blur-md transition-colors ${
                cooling
                  ? "border-ember/35 bg-[#150e07]/70 text-ember"
                  : "border-signal/50 bg-[#06140f]/75 text-signal hover:bg-[#0a2018]/85"
              }`}
            >
              <span
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-signal/65 transition-[width] duration-150"
                style={{ width: `${hud.energy}%` }}
              />
              <span className="absolute -left-px -top-px h-2 w-2 border-l border-t border-signal/70" />
              <span className="absolute -bottom-px -right-px h-2 w-2 border-b border-r border-signal/70" />
              <div className="flex items-center gap-3">
                <ScanIcon className={`h-5 w-5 ${cooling ? "text-ember/80" : "text-signal"}`} />
                <div className="text-left">
                  <div className="mono-label">{hud.scanning ? "Scanning…" : cooling ? "Cooling down" : "Emit sweep"}</div>
                  <div className="mono-label-sm mt-1 text-fog-dim">
                    {hud.scanning
                      ? `Top-to-bottom · ${Math.round(hud.scanProgress * 100)}%`
                      : cooling
                        ? "Array recharging · one sweep per press"
                        : "Space / left click · 26 m"}
                  </div>
                </div>
              </div>
              <span className="mono-label-sm tabular text-bone/80">
                {hud.scanning ? `${Math.round(hud.scanProgress * 100)}%` : cooling ? `${hud.cooldownLeft.toFixed(1)}s` : "READY"}
              </span>
            </button>
            <div className="hidden items-center gap-3 xl:flex">
              <div className="flex items-center gap-1.5">
                <Key>Shift</Key>
                <span className="mono-label-sm text-fog-dim">Run</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Key>Esc</Key>
                <span className="mono-label-sm text-fog-dim">Pause</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`h-1 w-1 rotate-45 ${hud.exitSeen ? "bg-signal" : "bg-ember/80"}`} />
            <span className="mono-label-sm tabular text-fog">
              {currentTutorial
                ? `Next: ${currentTutorial.text}`
                : hud.exitSeen
                  ? `Objective: reach the exit · ${hud.exitDistance.toFixed(1)} m`
                  : hud.backrooms
                    ? `Objective: scan the black doors · ${hud.doorsSeen}/${hud.doorsTotal} checked`
                    : "Objective: sweep the tunnels to find the light-green exit"}
            </span>
          </div>
        </div>
      )}

      {isTouch && hud.isTutorial && hud.levelTime < 10 && (
        <div className="absolute inset-x-0 bottom-[208px] flex justify-center">
          <span className="mono-label-sm border border-white/10 bg-black/40 px-3 py-1.5 text-fog backdrop-blur-sm">
            Drag anywhere to look · tap scan to sweep
          </span>
        </div>
      )}

      {isTouch && <TouchControls hud={hud} engine={engine} />}
    </div>
  );
}
