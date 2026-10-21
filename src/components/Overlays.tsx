import type { HudState, LidarEngine } from "../game/engine";
import { PlayIcon, RestartIcon, ScanMark, SoundOff, SoundOn } from "./Icons";

const primary =
  "clip-notch group inline-flex h-12 items-center justify-center gap-3 bg-signal px-6 font-mono text-[10px] uppercase tracking-[0.18em] text-[#04120e] transition-all hover:bg-[#d1ffed] hover:shadow-[0_0_34px_rgba(169,245,214,0.18)]";
const secondary =
  "clip-notch inline-flex h-12 items-center justify-center gap-2.5 border border-white/15 bg-black/25 px-5 font-mono text-[10px] uppercase tracking-[0.15em] text-bone/80 transition-colors hover:border-signal/40 hover:text-bone";

function mmss(seconds: number) {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="border border-white/10 bg-black/25 px-3.5 py-3">
      <div className="mono-label-sm text-fog-dim">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="font-mono text-xl font-light tabular text-bone">{value}</span>
        {unit && <span className="mono-label-sm text-fog">{unit}</span>}
      </div>
    </div>
  );
}

export function PauseOverlay({ hud, engine }: { hud: HudState; engine: LidarEngine | null }) {
  const levelLabel = hud.isTutorial ? "Tutorial" : `Level ${hud.level} of ${hud.levelCount}`;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto p-4 py-8">
      <div className="absolute inset-0 bg-[#020806]/85 backdrop-blur-[5px]" />
      <div className="grain scanlines panel-edge relative w-full max-w-[640px] overflow-hidden border border-signal/20 bg-[#04100d]/95 p-6 shadow-[0_40px_120px_rgba(0,0,0,0.7)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-ember" />
              <span className="mono-label text-ember">
                Paused · {levelLabel} · {hud.levelName}
              </span>
            </div>
            <h2 className="mt-3 font-serif text-5xl font-normal italic leading-none text-bone sm:text-6xl">
              Hold still<span className="text-ember">.</span>
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-fog">
              {hud.backrooms
                ? "The yellow halls stay quiet while paused. Scan the black doors; only the exit returns in light green."
                : "The tunnel stays dark while paused. Nothing you have not scanned exists."}
            </p>
          </div>
          <button
            onClick={() => engine?.toggleMuted()}
            aria-label={hud.muted ? "Enable sound" : "Mute sound"}
            className="flex h-9 w-9 shrink-0 items-center justify-center border border-white/15 text-fog transition-colors hover:border-signal/40 hover:text-signal"
          >
            {hud.muted ? <SoundOff /> : <SoundOn />}
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Level time" value={mmss(hud.levelTime)} />
          <Stat label="Sweeps" value={String(hud.levelScans).padStart(2, "0")} />
          <Stat label="Walked" value={String(hud.walked)} unit="M" />
          <Stat label="Exit" value={hud.exitSeen ? "LOCATED" : "HIDDEN"} />
        </div>

        <div className="mt-6 grid gap-5 border-t border-white/10 pt-5 sm:grid-cols-2">
          <div>
            <div className="mono-label text-signal/80">Objective</div>
            <p className="mt-2 text-[13px] leading-relaxed text-bone/85">
              {hud.backrooms
                ? `Scan each black door. The correct one returns in light green (${hud.doorsSeen}/${hud.doorsTotal} scanned). Walk through it to finish.`
                : "Find the light-green exit. It only shows up once a sweep hits it, so scan ahead, check side passages, then walk into the green light to move on to the next tunnel."}
            </p>
          </div>
          <div>
            <div className="mono-label text-signal/80">Controls</div>
            <div className="mt-2 space-y-1.5">
              {[
                ["WASD", "Walk the tunnel"],
                ["Mouse", "Look / capture pointer"],
                ["Space / LMB", "Emit one sweep"],
                ["Shift", "Run"],
                ["Esc", "Pause"],
              ].map(([key, action]) => (
                <div key={key} className="flex items-center justify-between gap-3 font-mono text-[10px]">
                  <span className="min-w-11 border border-white/15 bg-black/30 px-1.5 py-0.5 text-center text-bone/80">
                    {key}
                  </span>
                  <span className="flex-1 text-right text-fog">{action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2.5 border-t border-white/10 pt-5">
          <button onClick={() => engine?.resume()} className={primary}>
            <PlayIcon /> Resume
          </button>
          <button onClick={() => engine?.restartLevel()} className={secondary}>
            <RestartIcon /> Restart level
          </button>
          {!hud.isTutorial && (
            <button onClick={() => engine?.newRun(0)} className={`${secondary} sm:ml-auto`}>
              Replay tutorial
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function WinOverlay({ hud, engine }: { hud: HudState; engine: LidarEngine | null }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto p-4 py-8">
      <div className="absolute inset-0 bg-[#020807]/92 backdrop-blur-[4px]" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 30%, rgba(120,255,160,0.16), transparent 60%)" }}
      />
      <div className="grain relative w-full max-w-[640px]">
        <div className="flex items-center justify-between border-b border-signal/20 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            <span className="mono-label text-signal">All {hud.levelCount} levels cleared</span>
          </div>
          <span className="mono-label-sm text-fog-dim">Probe 07 · recovered</span>
        </div>

        <div className="mt-8 flex flex-col items-center text-center">
          <ScanMark className="h-12 w-12 text-signal" />
          <div className="mono-label mt-6 text-fog-dim">Daylight through the last green light</div>
          <h2 className="mt-3 font-sans text-[clamp(2.8rem,8vw,4.8rem)] font-light leading-[0.9] tracking-[-0.04em] text-bone">
            You made it
            <span className="block font-serif italic text-signal">out of the dark.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-fog">
            Behind you, every tunnel is still only what you remember scanning.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Total time" value={mmss(hud.runTime)} />
          <Stat label="Sweeps" value={String(hud.scans).padStart(2, "0")} />
          <Stat label="Walked" value={String(hud.walked)} unit="M" />
          <Stat label="Levels" value={`${hud.levelCount}/${hud.levelCount}`} />
        </div>

        <div className="mt-6 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <button onClick={() => engine?.newRun(1)} className={primary}>
            <RestartIcon /> Play again
          </button>
          <button onClick={() => engine?.newRun(0)} className={secondary}>
            Replay tutorial
          </button>
        </div>
      </div>
    </div>
  );
}
