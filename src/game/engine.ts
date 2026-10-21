import { AudioEngine } from "./audio";
import {
  CEILING,
  EYE_HEIGHT,
  LEVEL_COUNT,
  LEVEL_NAMES,
  MAP_W,
  MAP_H,
  type BackroomsDoor,
  type CaveMap,
  castRay,
  cellAt,
  generateLevel,
  hash2,
  isBlocked,
  isSolid,
  pointKindForHit,
  SOLID,
  WALKABLE,
} from "./world";

export type Phase = "playing" | "paused" | "won";
export type LogTone = "info" | "warn" | "good" | "danger";

export interface HudLog {
  id: number;
  text: string;
  tone: LogTone;
  stamp: string;
}

export interface TutorialItem {
  text: string;
  done: boolean;
}

export interface HudState {
  phase: Phase;
  level: number;
  /** Number of real levels, not counting the tutorial. */
  levelCount: number;
  levelName: string;
  isTutorial: boolean;
  backrooms: boolean;
  doorsSeen: number;
  doorsTotal: number;
  showBanner: boolean;
  bannerKicker: string;
  energy: number;
  scans: number;
  levelScans: number;
  points: number;
  levelTime: number;
  runTime: number;
  muted: boolean;
  scanning: boolean;
  scanProgress: number;
  scanId: number;
  cooldownLeft: number;
  exitSeen: boolean;
  exitDistance: number;
  exitBearing: number;
  heading: number;
  walked: number;
  prompt: string | null;
  sprinting: boolean;
  tutorial: TutorialItem[];
  tutorialStep: number;
  log: HudLog[];
}

export const EMPTY_HUD: HudState = {
  phase: "playing",
  level: 0,
  levelCount: LEVEL_COUNT - 1,
  levelName: LEVEL_NAMES[0],
  isTutorial: true,
  backrooms: false,
  doorsSeen: 0,
  doorsTotal: 0,
  showBanner: false,
  bannerKicker: "",
  energy: 100,
  scans: 0,
  levelScans: 0,
  points: 0,
  levelTime: 0,
  runTime: 0,
  muted: false,
  scanning: false,
  scanProgress: 0,
  scanId: 0,
  cooldownLeft: 0,
  exitSeen: false,
  exitDistance: 0,
  exitBearing: 0,
  heading: 0,
  walked: 0,
  prompt: null,
  sprinting: false,
  tutorial: [],
  tutorialStep: 0,
  log: [],
};

const HFOV = (76 * Math.PI) / 180;
const SCAN_HFOV = (142 * Math.PI) / 180;
const POINT_CAP = 160000;
const SCAN_ROWS = 100;
const SCAN_COLS = 352;
const SCAN_DURATION = 1000;
const SCAN_COOLDOWN = 1300;
const SCAN_GRID = 0.07;
const RANGE = 26;
const WALK_SPEED = 2.35;
const RUN_SPEED = 3.75;
const EYE_BASE = EYE_HEIGHT;
const BANNER_MS = 5000;
const TRANSITION_MS = 900;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const normAngle = (a: number) => {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
};
const stampFor = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

interface PointBuffers {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  kind: Uint8Array;
  bright: Uint8Array;
  born: Float64Array;
  seed: Uint8Array;
  keys: Float64Array;
}

interface ScanState {
  ox: number;
  oz: number;
  yaw: number;
  pitch: number;
  vFov: number;
  started: number;
  nextRow: number;
}

interface DoorRayHit {
  t: number;
  x: number;
  y: number;
  z: number;
  door: BackroomsDoor;
}

export class LidarEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onHud: (hud: HudState) => void;
  private audio = new AudioEngine();

  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  private base: Uint8ClampedArray | null = null;
  private iw = 640;
  private ih = 360;

  private map: CaveMap;
  private points: PointBuffers;
  private head = 0;
  private count = 0;
  private pointKeys = new Map<number, number>();

  private player = { x: 5.5, z: 4.5, yaw: Math.PI / 2, pitch: 0 };
  private spawn = { x: 5.5, z: 4.5 };

  phase: Phase = "playing";
  private level = 0;
  private levelStartedAt = 0;
  private bannerUntil = 0;
  private levelTime = 0;
  private runTime = 0;
  private levelScans = 0;
  private totalScans = 0;
  private totalWalked = 0;

  private scanState: ScanState | null = null;
  private scanReadyAt = 0;
  private scanId = 0;
  private lastCooldownLog = 0;
  private lastScanSound = 0;

  private logs: HudLog[] = [];
  private logId = 1;
  private flavorAt = 0;
  private flavorIndex = 0;

  private exitSeen = false;
  private seenDoors = new Set<number>();
  private moved = false;
  private footAccum = 0;
  private bob = 0;
  private sprinting = false;

  // Backrooms monster (The Stalker)
  private monsterSpawn = { x: 0, z: 0 };
  private monsterActive = false;
  private monsterSeenUntil = 0;
  private monsterX = 0;
  private monsterZ = 0;

  private keys = new Set<string>();
  private touchMove = { x: 0, y: 0 };
  private mouseDragging = false;
  private lastTouch = { x: 0, y: 0, id: -1 };
  private hadPointerLock = false;
  private lockStartedAt = 0;

  private raf = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private resizeObs: ResizeObserver | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, onHud: (hud: HudState) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.onHud = onHud;

    this.off = document.createElement("canvas");
    this.offCtx = this.off.getContext("2d", { alpha: false })!;

    this.map = generateLevel(0);
    this.points = {
      x: new Float32Array(POINT_CAP),
      y: new Float32Array(POINT_CAP),
      z: new Float32Array(POINT_CAP),
      kind: new Uint8Array(POINT_CAP),
      bright: new Uint8Array(POINT_CAP),
      born: new Float64Array(POINT_CAP),
      seed: new Uint8Array(POINT_CAP),
      keys: new Float64Array(POINT_CAP),
    };
  }

  init() {
    this.resize();
    this.ctx.imageSmoothingEnabled = false;
    this.bind();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.canvas);
    this.loadLevel(0);
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    return this;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unbind();
    this.resizeObs?.disconnect();
    this.audio.dispose();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /* ---------------------------------------------------------------- */
  /* Levels                                                            */
  /* ---------------------------------------------------------------- */

  private loadLevel(index: number) {
    const now = performance.now();
    this.level = index;
    this.map = generateLevel(index);
    this.spawn = { x: this.map.spawn.x, z: this.map.spawn.z };
    this.player = { x: this.spawn.x, z: this.spawn.z, yaw: this.map.spawnYaw, pitch: 0 };
    this.resetPoints();
    this.phase = "playing";
    this.scanState = null;
    this.scanReadyAt = 0;
    this.levelScans = 0;
    this.levelTime = 0;
    this.levelStartedAt = now;
    this.bannerUntil = index === 0 ? 0 : now + BANNER_MS;
    this.footAccum = 0;
    this.exitSeen = false;
    this.seenDoors.clear();
    this.moved = false;
    this.logs = [];
    this.flavorAt = now + 20000;
    if (index === 0) {
      this.addLog("NEURAL LIDAR ONLINE // TUNNEL PROBE 07", "good");
      this.addLog("TUNNEL IS PITCH BLACK // SWEEP TO SEE", "info");
    } else if (this.map.backrooms) {
      this.addLog("THE BACKROOMS // YELLOW WALLPAPER / FLUORESCENT HUM", "warn");
      this.addLog("BLACK DOORS DETECTED // SCAN EACH TO FIND THE EXIT", "info");
      this.paintBackroomsWalls(now);
      this.monsterSpawn = { x: this.map.monsterSpawn?.x ?? 10, z: this.map.monsterSpawn?.z ?? 10 };
      this.monsterX = this.monsterSpawn.x;
      this.monsterZ = this.monsterSpawn.z;
      this.monsterActive = true;
      this.monsterSeenUntil = 0;
    } else {
      this.addLog(`${LEVEL_NAMES[index].toUpperCase()} // ENTERED`, "good");
      this.addLog(
        this.map.backrooms ? "OBJECTIVE // SCAN THE BLACK DOORS FOR THE EXIT" : "OBJECTIVE // FIND THE LIGHT-GREEN EXIT",
        "info",
      );
    }
    this.lastHud = 0;
    this.emitHud();
  }

  /** Pre-paint Backrooms wall surfaces so they are visible without scanning.
   *  Door openings are left empty so they only appear when a sweep hits them.
   *  Walls are painted densely so they look like solid surfaces, not dots.
   */
  private paintBackroomsWalls(now: number) {
    if (!this.map.backrooms) return;
    const doors = this.map.doors ?? [];

    // Paint dense wall surfaces (every 0.08 units for solid appearance)
    const WALL_STEP = 0.08;
    for (let z = 1; z < MAP_H - 1; z++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        const cell = cellAt(this.map, x, z);
        if (!SOLID(cell)) continue;
        const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dz] of dirs) {
          if (!WALKABLE(cellAt(this.map, x + dx, z + dz))) continue;
          const px = dx !== 0 ? (dx > 0 ? x + 1 : x) : x + 0.5;
          const pz = dz !== 0 ? (dz > 0 ? z + 1 : z) : z + 0.5;
          // Skip positions occupied by doors so they stay hidden until scanned.
          const isDoor = doors.some((d) => Math.abs(d.x - px) < 0.95 && Math.abs(d.z - pz) < 0.95);
          if (isDoor) continue;
          // Paint densely from floor to ceiling
          for (let y = 0.05; y < CEILING - 0.05; y += WALL_STEP) {
            const kind = pointKindForHit(cell, true, px, pz, y, true);
            const bright = 160 + Math.random() * 70;
            this.spawnPoint(px, y, pz, kind, bright, now, this.scanKey(px, y, pz));
          }
        }
      }
    }

    // Paint ceiling lights as bright rectangular grids
    const lightSpacing = 2.5;
    for (let lz = 4; lz < MAP_H - 4; lz += lightSpacing) {
      for (let lx = 4; lx < MAP_W - 4; lx += lightSpacing) {
        // Only place lights in walkable areas (below a ceiling cell)
        const cellBelow = cellAt(this.map, lx, lz);
        const cellAbove = cellAt(this.map, lx, lz + 1);
        if (!SOLID(cellAbove)) continue;
        if (!WALKABLE(cellBelow)) continue;
        const isDoorArea = doors.some((d) => Math.abs(d.x - lx) < 1.2 && Math.abs(d.z - lz) < 1.2);
        if (isDoorArea) continue;
        for (let ly = CEILING - 0.15; ly < CEILING - 0.02; ly += 0.04) {
          for (let dx = -0.6; dx <= 0.6; dx += 0.15) {
            for (let dz = -0.3; dz <= 0.3; dz += 0.15) {
              const bright = 230 + Math.random() * 25;
              this.spawnPoint(lx + dx, ly, lz + dz, 16, bright, now, this.scanKey(lx + dx, ly, lz + dz));
            }
          }
        }
      }
    }

    // Paint floor grain sparsely
    const FLOOR_STEP = 0.15;
    for (let fz = 1; fz < MAP_H - 1; fz += FLOOR_STEP) {
      for (let fx = 1; fx < MAP_W - 1; fx += FLOOR_STEP) {
        const cell = cellAt(this.map, fx, fz);
        if (!WALKABLE(cell)) continue;
        // Skip door areas
        const isDoorArea = doors.some((d) => Math.abs(d.x - fx) < 1.0 && Math.abs(d.z - fz) < 1.0);
        if (isDoorArea) continue;
        if (Math.random() < 0.15) {
          const bright = 90 + Math.random() * 40;
          this.spawnPoint(fx, 0.02, fz, 17, bright, now, this.scanKey(fx, 0.02, fz));
        }
      }
    }
  }

  private completeLevel() {
    if (this.level >= LEVEL_COUNT - 1) {
      this.phase = "won";
      this.audio.win();
      this.releasePointer();
      this.emitHud();
      return;
    }
    // No pause, no screen: the next tunnel loads straight away and the
    // objective banner takes over.
    this.audio.win();
    this.loadLevel(this.level + 1);
  }

  /** Restart the current level from its spawn point. */
  restartLevel() {
    this.loadLevel(this.level);
    this.lockPointer();
  }

  /** Start a fresh run from the given level (0 = tutorial). */
  newRun(startLevel = 1) {
    this.runTime = 0;
    this.totalScans = 0;
    this.totalWalked = 0;
    this.loadLevel(clamp(startLevel, 0, LEVEL_COUNT - 1));
    this.lockPointer();
  }

  pause() {
    if (this.phase !== "playing") return;
    this.phase = "paused";
    this.releasePointer();
    this.emitHud();
  }

  resume() {
    if (this.phase !== "paused") return;
    this.phase = "playing";
    this.emitHud();
    this.lockPointer();
  }

  toggleMuted() {
    this.audio.setMuted(!this.audio.muted);
    this.audio.unlock();
    this.emitHud();
  }

  unlockAudio() {
    this.audio.unlock();
    this.audio.startAmbient();
  }

  setTouchMove(x: number, y: number) {
    this.touchMove.x = clamp(x, -1, 1);
    this.touchMove.y = clamp(y, -1, 1);
  }

  startScanHold() {
    this.triggerScan();
  }

  private lockPointer() {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(() => undefined);
    } catch {
      /* drag-look remains available */
    }
  }

  private releasePointer() {
    this.hadPointerLock = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.mouseDragging = false;
    this.touchMove = { x: 0, y: 0 };
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  private bind() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("blur", this.onBlur);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
  }

  private unbind() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
  }

  private onPointerLockChange = () => {
    if (document.pointerLockElement === this.canvas) {
      this.hadPointerLock = true;
      this.lockStartedAt = performance.now();
      return;
    }
    // Losing the lock after holding it is the browser's own pause gesture.
    if (this.phase !== "playing" || !this.hadPointerLock) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    this.hadPointerLock = false;
    this.pause();
  };

  private onContextMenu = (event: Event) => event.preventDefault();

  private onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) this.triggerScan();
      return;
    }
    if (event.code === "Escape") {
      this.pause();
      return;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.mouseDragging = false;
    this.touchMove = { x: 0, y: 0 };
    this.pause();
  };

  private onPointerDown = (event: PointerEvent) => {
    if (this.phase !== "playing") return;
    if (event.pointerType === "touch") {
      this.lastTouch = { x: event.clientX, y: event.clientY, id: event.pointerId };
      return;
    }
    this.lockPointer();
    this.mouseDragging = true;
    if (event.button === 0) this.triggerScan();
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.phase !== "playing" || event.pointerType !== "touch") return;
    if (this.lastTouch.id !== event.pointerId) return;
    const dx = event.clientX - this.lastTouch.x;
    const dy = event.clientY - this.lastTouch.y;
    this.lastTouch = { x: event.clientX, y: event.clientY, id: event.pointerId };
    this.look(dx * 0.0044, dy * 0.0036);
  };

  private onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === "touch" && this.lastTouch.id === event.pointerId) {
      this.lastTouch = { x: 0, y: 0, id: -1 };
    }
    this.mouseDragging = false;
  };

  private onMouseMove = (event: MouseEvent) => {
    if (this.phase !== "playing") return;
    const locked = document.pointerLockElement === this.canvas;
    if (!locked && !this.mouseDragging) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    // The first relative delta after locking can be enormous; ignore it.
    if (locked && performance.now() - this.lockStartedAt < 280) return;
    const dx = clamp(event.movementX, -80, 80);
    const dy = clamp(event.movementY, -80, 80);
    this.look(dx * 0.0021, dy * 0.0019);
  };

  private onMouseUp = () => {
    this.mouseDragging = false;
  };

  private look(dx: number, dy: number) {
    this.player.yaw = normAngle(this.player.yaw + dx);
    this.player.pitch = clamp(this.player.pitch - dy, -1.08, 1.02);
  }

  /* ---------------------------------------------------------------- */
  /* Simulation                                                        */
  /* ---------------------------------------------------------------- */

  private loop = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    if (this.phase === "playing") this.updatePlaying(dt, now);
    if (this.scanState) this.processScan(now);
    this.render(now);
    if ((this.phase === "playing" || this.scanState) && now - this.lastHud > 110) {
      this.lastHud = now;
      this.emitHud();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private updatePlaying(dt: number, now: number) {
    this.levelTime += dt;
    this.runTime += dt;

    const keys = this.keys;
    let forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0) + this.touchMove.y;
    let strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + this.touchMove.x;
    if (keys.has("ArrowLeft")) this.player.yaw -= 1.65 * dt;
    if (keys.has("ArrowRight")) this.player.yaw += 1.65 * dt;
    if (keys.has("ArrowUp")) this.player.pitch = clamp(this.player.pitch + 0.9 * dt, -1.08, 1.02);
    if (keys.has("ArrowDown")) this.player.pitch = clamp(this.player.pitch - 0.9 * dt, -1.08, 1.02);

    const magnitude = Math.hypot(forward, strafe);
    this.sprinting = (keys.has("ShiftLeft") || keys.has("ShiftRight")) && magnitude > 0.15;
    const speed = this.sprinting ? RUN_SPEED : WALK_SPEED;
    if (magnitude > 0.05) {
      forward /= magnitude;
      strafe /= magnitude;
      const sin = Math.sin(this.player.yaw);
      const cos = Math.cos(this.player.yaw);
      const dx = (sin * forward + cos * strafe) * speed * dt;
      const dz = (cos * forward - sin * strafe) * speed * dt;
      const beforeX = this.player.x;
      const beforeZ = this.player.z;
      this.tryMove(dx, dz);
      const stepLength = Math.hypot(this.player.x - beforeX, this.player.z - beforeZ);
      this.footAccum += stepLength;
      this.totalWalked += stepLength;
      this.bob += dt * (this.sprinting ? 13 : 8.2);
      if (this.footAccum > (this.sprinting ? 1.25 : 1.55)) {
        this.footAccum = 0;
        this.audio.step(cellAt(this.map, this.player.x, this.player.z) === 2);
      }
    } else {
      this.bob += dt * 1.2;
    }

    if (Math.hypot(this.player.x - this.spawn.x, this.player.z - this.spawn.z) > 2.5) this.moved = true;

    // Backrooms monster AI: stalk the player, freeze when directly looked at
    if (this.map.backrooms && this.monsterActive) {
      const mx = this.monsterX;
      const mz = this.monsterZ;
      const distToPlayer = Math.hypot(this.player.x - mx, this.player.z - mz);

      const angleToMonster = Math.atan2(mx - this.player.x, mz - this.player.z);
      let yawDiff = Math.abs(normAngle(angleToMonster - this.player.yaw));
      if (yawDiff > Math.PI) yawDiff = Math.PI * 2 - yawDiff;
      const lookingAtMonster = yawDiff < 0.55 && distToPlayer < 22;

      if (lookingAtMonster) {
        this.monsterSeenUntil = now + 600;
      }

      const frozen = now < this.monsterSeenUntil;
      if (!frozen && distToPlayer > 1.5) {
        const moveSpeed = distToPlayer > 8 ? 1.1 : 0.7;
        const stepX = (this.player.x - mx) / distToPlayer * moveSpeed * dt;
        const stepZ = (this.player.z - mz) / distToPlayer * moveSpeed * dt;
        if (!isBlocked(this.map, mx + stepX, mz, 0.25)) this.monsterX += stepX;
        if (!isBlocked(this.map, mx, mz + stepZ, 0.25)) this.monsterZ += stepZ;
      }

      if (distToPlayer < 0.95 && !lookingAtMonster) {
        this.phase = "won";
        this.audio.death();
        this.addLog("THE STALKER CAUGHT YOU", "danger");
        this.releasePointer();
      }
    }

    const insideBackroomsExit =
      this.map.backrooms &&
      this.exitSeen &&
      Math.hypot(this.player.x - this.map.exit.x, this.player.z - this.map.exit.z) < 1.25;
    if (cellAt(this.map, this.player.x, this.player.z) === 4 || insideBackroomsExit) {
      this.completeLevel();
      return;
    }

    if (now > this.flavorAt) {
      const flavor = [
        "SOMETHING DRIPS BEHIND THE WALL",
        "THE AIR IS GROWING COLDER",
        "YOUR FOOTSTEPS RETURN LATE",
        "THE TUNNEL IS LONGER THAN IT WAS",
        "SURVEY UNIT 06 TRANSPONDER // SILENT",
      ];
      this.addLog(flavor[this.flavorIndex % flavor.length], this.flavorIndex % 2 ? "warn" : "info");
      this.flavorIndex++;
      this.flavorAt = now + 22000 + Math.random() * 12000;
    }
  }

  private tryMove(dx: number, dz: number) {
    const radius = 0.27;
    if (!isBlocked(this.map, this.player.x + dx, this.player.z, radius)) this.player.x += dx;
    if (!isBlocked(this.map, this.player.x, this.player.z + dz, radius)) this.player.z += dz;
  }

  /* ---------------------------------------------------------------- */
  /* Scanner                                                            */
  /* ---------------------------------------------------------------- */

  private readiness(now = performance.now()) {
    if (this.scanState) return 0;
    return clamp(1 - Math.max(0, this.scanReadyAt - now) / SCAN_COOLDOWN, 0, 1);
  }

  private triggerScan() {
    if (this.phase !== "playing" || this.scanState) return;
    const now = performance.now();
    if (now < this.scanReadyAt) {
      if (now - this.lastCooldownLog > 1100) {
        this.lastCooldownLog = now;
        this.addLog("PULSE ARRAY // COOLING", "warn");
      }
      return;
    }
    this.levelScans++;
    this.totalScans++;
    const vFov = 2 * Math.atan(this.ih / 2 / this.focal());
    this.scanState = {
      ox: this.player.x,
      oz: this.player.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      vFov,
      started: now,
      nextRow: 0,
    };
    this.scanReadyAt = now + SCAN_DURATION + SCAN_COOLDOWN;
    this.scanId++;
    if (now - this.lastScanSound > 180) {
      this.lastScanSound = now;
      this.audio.scan();
    }
    this.emitHud();
  }

  private processScan(now: number) {
    const scan = this.scanState;
    if (!scan) return;
    const progress = clamp((now - scan.started) / SCAN_DURATION, 0, 1);
    const target = Math.min(SCAN_ROWS, Math.ceil(progress * SCAN_ROWS));
    while (scan.nextRow < target) {
      this.spawnRow(scan, scan.nextRow);
      scan.nextRow++;
    }
    if (progress >= 1) {
      this.scanState = null;
      this.emitHud();
    }
  }

  private spawnRow(scan: ScanState, row: number) {
    const ay = (0.5 - row / (SCAN_ROWS - 1)) * scan.vFov;
    for (let col = 0; col < SCAN_COLS; col++) {
      const ax = (col / (SCAN_COLS - 1) - 0.5) * SCAN_HFOV;
      const yaw = scan.yaw + ax;
      const pitch = scan.pitch + ay;
      const cp = Math.cos(pitch);
      this.castPoint(scan.ox, scan.oz, Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    }
  }

  private intersectDoor(ox: number, oz: number, dx: number, dy: number, dz: number): DoorRayHit | null {
    const doors = this.map.doors;
    if (!this.map.backrooms || !doors?.length) return null;
    let nearest: DoorRayHit | null = null;
    for (const door of doors) {
      const denom = dx * door.normalX + dz * door.normalZ;
      if (Math.abs(denom) < 1e-7) continue;
      const t = ((door.x - ox) * door.normalX + (door.z - oz) * door.normalZ) / denom;
      if (t <= 0.2 || t > RANGE || (nearest && t >= nearest.t)) continue;
      const x = ox + dx * t;
      const z = oz + dz * t;
      const y = EYE_BASE + dy * t;
      const tangent = (x - door.x) * -door.normalZ + (z - door.z) * door.normalX;
      if (Math.abs(tangent) > door.width / 2 || y < 0.04 || y > door.height) continue;
      nearest = { t, x, y, z, door };
    }
    return nearest;
  }

  private castPoint(ox: number, oz: number, dx: number, dy: number, dz: number) {
    const doorHit = this.intersectDoor(ox, oz, dx, dy, dz);
    const wall = castRay(this.map, ox, oz, dx, dz, RANGE);
    let floorT = Infinity;
    if (dy > 0.0002) floorT = (CEILING - EYE_BASE) / dy;
    else if (dy < -0.0002) floorT = -EYE_BASE / dy;
    const wallT = wall ? wall.dist : Infinity;
    const doorSurface = Boolean(doorHit && doorHit.t < wallT && doorHit.t < floorT);

    let t = 0;
    let y = 0;
    let cell = 0;
    let isWall = false;
    let side: 0 | 1 = 0;

    if (doorSurface && doorHit) {
      t = doorHit.t;
      y = doorHit.y;
      cell = doorHit.door.isExit ? 4 : 14;
      isWall = true;
      side = Math.abs(doorHit.door.normalX) > 0 ? 0 : 1;
    } else if (floorT < wallT && floorT < RANGE) {
      t = floorT;
      y = dy > 0 ? CEILING : 0;
      cell = cellAt(this.map, ox + dx * t, oz + dz * t);
    } else if (wall && wall.dist < RANGE) {
      t = wall.dist;
      const rawY = EYE_BASE + dy * t;
      if (rawY < -0.1 || rawY > CEILING + 0.1) return;
      y = clamp(rawY, 0, CEILING);
      cell = wall.cell;
      isWall = true;
      side = wall.side;
    } else {
      return;
    }
    if (t < 0.35 || t > RANGE) return;

    const isExit = cell === 4 || cell === 13;
    // Floors and ceilings are sparse grain; walls and the exit always return.
    if (!isWall && !isExit && Math.random() > (y < CEILING / 2 ? 0.46 : 0.4)) return;

    const rawX = ox + dx * t;
    const rawZ = oz + dz * t;
    const snap = (v: number) => Math.round(v / SCAN_GRID) * SCAN_GRID;
    let px = snap(rawX);
    let pz = snap(rawZ);
    let py = snap(y);

    if (isWall) {
      // Axis-aligned geometry: snap to the integer wall plane, then add a tiny
      // deterministic grain so the stacked dots look organic, not gridded.
      if (doorSurface && doorHit) {
        px = doorHit.x;
        pz = doorHit.z;
      } else if (side === 0) px = Math.round(rawX);
      else pz = Math.round(rawZ);
      py = clamp(py, 0.02, CEILING - 0.02);
      const gx = Math.round(px * 10);
      const gz = Math.round(pz * 10);
      const gy = Math.round(py * 10);
      if (!doorSurface) {
        if (side === 0) pz += (hash2(gz, gy, 5) - 0.5) * 0.018;
        else px += (hash2(gx, gy, 5) - 0.5) * 0.018;
        py += (hash2(gx + gz, gy, 9) - 0.5) * 0.012;
      }
    } else {
      py = y > CEILING / 2 ? CEILING : 0;
    }

    const now = performance.now();

    if (doorSurface && doorHit) {
      const door = doorHit.door;
      if (!this.seenDoors.has(door.id)) {
        this.seenDoors.add(door.id);
        this.addLog(
          door.isExit ? "BLACK DOOR SCANNED // GREEN EXIT RETURN" : "BLACK DOOR SCANNED // NO EXIT SIGNAL",
          door.isExit ? "good" : "warn",
        );
      }
      if (door.isExit && !this.exitSeen) {
        this.exitSeen = true;
        this.addLog("EXIT LOCATED BEHIND THE BLACK DOOR", "good");
        this.audio.pickup();
      }
      const doorKind = door.isExit ? 9 : 14;
      const doorBrightness = door.isExit ? 252 : 226;
      this.spawnPoint(px, py, pz, doorKind, doorBrightness, now, this.scanKey(px, py, pz));
      return;
    }

    if (isExit) {
      if (!this.exitSeen) {
        this.exitSeen = true;
        this.addLog("EXIT SIGNATURE LOCATED // FOLLOW THE GREEN LIGHT", "good");
        this.audio.pickup();
      }
      this.spawnPoint(px, py, pz, 9, 246, now, this.scanKey(px, py, pz));
      return;
    }

    const kind = pointKindForHit(cell, isWall, px, pz, py, this.map.backrooms ?? false);
    const grain = 0.62 + hash2(Math.floor(px * 13), Math.floor(pz * 13 + py * 31), 17) * 0.5;
    let bright = isWall ? (this.map.backrooms ? 156 : 128) + Math.random() * 44 : (66 + Math.random() * 30) * grain;
    if (!isWall && y > CEILING - 0.08) bright = 34 + Math.random() * 24;
    if (cell === 2 && !isWall) bright = 118 + Math.random() * 40;
    if (!isWall && t < 2.4) bright *= 0.6;
    if (isWall) {
      // Wall returns beside open space mark the tunnel boundary.
      const reach = 0.45;
      const openNear =
        !isSolid(this.map, px + reach, pz) ||
        !isSolid(this.map, px - reach, pz) ||
        !isSolid(this.map, px, pz + reach) ||
        !isSolid(this.map, px, pz - reach);
      if (openNear) bright = 236;
    }
    this.spawnPoint(px, py, pz, kind, bright, now, this.scanKey(px, py, pz));

    // Walls grow short vertical and tangential runs of the same lattice keys,
    // so repeated sweeps reinforce the same points into solid-looking surfaces.
    if (isWall && t > 0.7) {
      const seedValue = hash2(Math.round(px * 31), Math.round(pz * 31), Math.round(py * 10));
      if (seedValue > 0.18) {
        const run = 1 + ((seedValue * 6) | 0);
        for (let n = 1; n <= run; n++) {
          const h = clamp(py + n * SCAN_GRID * 1.5, 0.05, CEILING - 0.03);
          const tangent = (hash2(n, Math.round(px * 17), 12) - 0.5) * SCAN_GRID * 3.2;
          const hx = px + (side === 0 ? 0 : tangent);
          const hz = pz + (side === 0 ? tangent : 0);
          this.spawnPoint(
            hx,
            h,
            hz,
            pointKindForHit(cell, true, hx, hz, h, this.map.backrooms ?? false),
            bright * (0.62 + hash2(n, n, 4) * 0.3),
            now,
            this.scanKey(hx, h, hz),
          );
        }
      }
    }
  }

  private scanKey(x: number, y: number, z: number) {
    const ix = Math.round(x / SCAN_GRID) + 2000;
    const iy = Math.round(y / SCAN_GRID) + 20;
    const iz = Math.round(z / SCAN_GRID) + 2000;
    return (ix * 10000 + iz) * 1000 + iy;
  }

  private spawnPoint(
    x: number,
    y: number,
    z: number,
    kind: number,
    bright: number,
    born: number,
    key: number | null = null,
  ) {
    if (key !== null) {
      const existing = this.pointKeys.get(key);
      if (existing !== undefined) {
        this.points.bright[existing] = Math.min(255, this.points.bright[existing] + 54);
        this.points.born[existing] = born;
        return;
      }
    }
    const i = this.head;
    const previous = this.points.keys[i];
    if (previous !== 0) this.pointKeys.delete(previous);
    this.points.x[i] = x;
    this.points.y[i] = y;
    this.points.z[i] = z;
    this.points.kind[i] = kind;
    this.points.bright[i] = clamp(bright, 0, 255);
    this.points.born[i] = born;
    this.points.seed[i] = (Math.random() * 255) | 0;
    this.points.keys[i] = key ?? 0;
    if (key !== null) this.pointKeys.set(key, i);
    this.head = (this.head + 1) % POINT_CAP;
    this.count = Math.min(POINT_CAP, this.count + 1);
  }

  private resetPoints() {
    this.head = 0;
    this.count = 0;
    this.pointKeys.clear();
    this.points.keys.fill(0);
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                          */
  /* ---------------------------------------------------------------- */

  private focal() {
    return this.iw / 2 / Math.tan(HFOV / 2);
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(rect.width * dpr);
    const pixelHeight = Math.round(rect.height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const aspect = rect.width / rect.height;
    const budget = Math.min(
      window.matchMedia("(pointer: coarse)").matches || rect.width < 760 ? 205000 : 300000,
      300000 * Math.min(1.55, Math.max(0.8, aspect)),
    );
    let iw = Math.round(Math.sqrt(budget * aspect));
    let ih = Math.round(iw / aspect);
    iw = Math.round(clamp(iw, 310, 900));
    ih = Math.round(clamp(ih, 300, 950));
    if (iw !== this.iw || ih !== this.ih || !this.image) {
      this.iw = iw;
      this.ih = ih;
      this.off.width = iw;
      this.off.height = ih;
      this.image = this.offCtx.createImageData(iw, ih);
      this.buildBackground();
    }
  }

  private buildBackground() {
    if (!this.image) return;
    const w = this.iw;
    const h = this.ih;
    const data = this.image.data;
    for (let y = 0; y < h; y++) {
      const ty = y / (h - 1);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const vignette = 1 - Math.pow(Math.abs(x / w - 0.5) * 1.35, 2) * 0.5;
        const horizon = Math.max(0, 1 - Math.abs(ty - 0.55) * 9) * 2.2;
        const glow = Math.max(0, 1 - Math.hypot(x / w - 0.5, ty - 0.58) * 1.45) * 3.2;
        data[i] = (2 + (1 - ty) * 2.4 + glow * 0.4 + horizon * 0.35) * vignette;
        data[i + 1] = (7 + (1 - ty) * 3.2 + glow * 0.9 + horizon * 0.62) * vignette;
        data[i + 2] = (9 + (1 - ty) * 4.2 + glow + horizon * 0.8) * vignette;
        data[i + 3] = 255;
      }
    }
    this.base = new Uint8ClampedArray(data);
  }

  private render(now: number) {
    if (!this.image || !this.base) return;
    const data = this.image.data;
    data.set(this.base);
    const cam = this.player;
    const sinY = Math.sin(cam.yaw);
    const cosY = Math.cos(cam.yaw);
    const sinP = Math.sin(cam.pitch);
    const cosP = Math.cos(cam.pitch);
    const focal = this.focal();
    const W = this.iw;
    const H = this.ih;
    const eye = EYE_BASE + (this.phase === "playing" ? Math.sin(this.bob) * 0.026 : 0);
    const flash = this.scanState ? 1 - clamp((now - this.scanState.started) / SCAN_DURATION, 0, 1) : 0;

    const add = (sx: number, sy: number, r: number, g: number, b: number) => {
      const ix = sx | 0;
      const iy = sy | 0;
      if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
      const idx = (iy * W + ix) * 4;
      const red = data[idx] + r;
      const green = data[idx + 1] + g;
      const blue = data[idx + 2] + b;
      data[idx] = red > 255 ? 255 : red;
      data[idx + 1] = green > 255 ? 255 : green;
      data[idx + 2] = blue > 255 ? 255 : blue;
    };

    // The persistent point cloud is the only thing on screen. Nothing exists
    // in the tunnel until a sweep has returned from it.
    for (let i = 0; i < this.count; i++) {
      const kind = this.points.kind[i];
      const tint = this.kindTint(kind);
      if (!tint) continue;
      const rx = this.points.x[i] - cam.x;
      const rz = this.points.z[i] - cam.z;
      const ry = this.points.y[i] - eye;
      if (Math.abs(rx) > 34 || Math.abs(rz) > 34) continue;
      const horiz = rx * sinY + rz * cosY;
      if (horiz < -2) continue;
      const forward = horiz * cosP + ry * sinP;
      if (forward < 0.1) continue;
      const right = rx * cosY - rz * sinY;
      const up = ry * cosP - horiz * sinP;
      const inv = focal / forward;
      const sx = (W / 2 + right * inv) | 0;
      if (sx < 0 || sx >= W) continue;
      const sy = (H / 2 - up * inv) | 0;
      if (sy < 0 || sy >= H) continue;
      const distance = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (distance > RANGE + 1.5) continue;
      const fog = Math.max(0, 1 - distance / RANGE);
      const seed = this.points.seed[i];
      const flicker = 0.92 + 0.08 * Math.sin(now * 0.0024 + seed * 2.1);
      const hot = Math.max(0, 1 - (now - this.points.born[i]) / 640);
      const isExit = kind === 9;
      const surface = isExit ? 1.35 : kind === 10 ? 0.74 : kind === 1 ? 0.62 : kind === 2 ? 0.84 : 1;
      const baseFade = (0.18 + Math.pow(fog, isExit ? 0.8 : 1.18) * 1.02) * surface;
      let amount = (this.points.bright[i] / 255) * baseFade * flicker * (0.9 + flash * 0.3) * 1.12;
      amount += hot * 1.22;
      if (amount < 0.03) continue;
      const r = tint[0] * amount + hot * 145;
      const g = tint[1] * amount + hot * 180;
      const b = tint[2] * amount + hot * 195;
      add(sx, sy, r, g, b);
      const structured =
        isExit || kind === 0 || kind === 5 || kind === 13 || kind === 14 || kind === 16 || kind === 19;
      if (structured && distance < 22) {
        add(sx + 1, sy, r * 0.44, g * 0.44, b * 0.44);
        add(sx, sy + 1, r * 0.38, g * 0.38, b * 0.38);
      }
      if (isExit) {
        add(sx - 1, sy, r * 0.3, g * 0.3, b * 0.3);
        add(sx, sy - 1, r * 0.3, g * 0.3, b * 0.3);
      }
      if (hot > 0.3) {
        add(sx + 1, sy, r * 0.4, g * 0.4, b * 0.4);
        add(sx, sy + 1, r * 0.32, g * 0.32, b * 0.32);
      }
    }

    // Backrooms monster: rendered as red stick-figure points when scanned,
    // faintly visible as ambient red when close.
    if (this.map.backrooms && this.monsterActive) {
      const mx = this.monsterX;
      const mz = this.monsterZ;
      const distToPlayer = Math.hypot(this.player.x - mx, this.player.z - mz);

      // Only render monster when scanning OR very close (faint ambient)
      const isScanning = this.scanState && distToPlayer < RANGE;
      const renderMonster = isScanning || (distToPlayer < 6 && now - this.monsterSeenUntil < 200);
      if (renderMonster) {
        // Stick figure points: head, torso, arms, legs
        const mParts: Array<{x: number, y: number, z: number}> = [];
        // Head
        for (let a = 0; a < Math.PI * 2; a += 0.25) mParts.push({x: mx + Math.cos(a) * 0.12, y: 1.85, z: mz + Math.sin(a) * 0.12});
        // Neck
        mParts.push({x: mx, y: 1.7, z: mz});
        // Torso (spine)
        for (let y = 1.1; y <= 1.7; y += 0.15) mParts.push({x: mx, y, z: mz});
        // Shoulders
        for (let sx = -0.25; sx <= 0.25; sx += 0.12) mParts.push({x: mx + sx, y: 1.6, z: mz});
        // Left arm
        for (let t = 0; t <= 1; t += 0.1) mParts.push({x: mx - 0.25 + t * 0.3, y: 1.6 - t * 0.15, z: mz + t * 0.2});
        // Right arm
        for (let t = 0; t <= 1; t += 0.1) mParts.push({x: mx + 0.25 - t * 0.3, y: 1.6 - t * 0.15, z: mz + t * 0.2});
        // Left leg
        for (let t = 0; t <= 1; t += 0.1) mParts.push({x: mx - 0.12 + t * 0.08, y: 1.1 - t * 1.0, z: mz + t * 0.1});
        // Right leg
        for (let t = 0; t <= 1; t += 0.1) mParts.push({x: mx + 0.12 - t * 0.08, y: 1.1 - t * 1.0, z: mz + t * 0.1});

        const scanIntensity = isScanning ? 1.0 : 0.15;
        for (const p of mParts) {
          const rx = p.x - this.player.x;
          const rz = p.z - this.player.z;
          const ry = p.y - eye;
          const horiz = rx * sinY + rz * cosY;
          if (horiz < -1) continue;
          const forward = horiz * cosP + ry * sinP;
          if (forward < 0.1 || forward > RANGE) continue;
          const right = rx * cosY - rz * sinY;
          const up = ry * cosP - horiz * sinP;
          const inv = focal / forward;
          const sx2 = (W / 2 + right * inv) | 0;
          if (sx2 < 0 || sx2 >= W) continue;
          const sy2 = (H / 2 - up * inv) | 0;
          if (sy2 < 0 || sy2 >= H) continue;
          const distance = Math.sqrt(rx * rx + ry * ry + rz * rz);
          const fog = Math.max(0, 1 - distance / RANGE);
          const baseAmt = scanIntensity * 0.9 * fog;
          const flicker = 0.85 + 0.15 * Math.sin(now * 0.005);
          const amt = baseAmt * flicker;
          if (amt < 0.02) continue;
          // Dark red monster color
          add(sx2, sy2, 120 * amt, 20 * amt, 15 * amt);
          if (amt > 0.3) {
            add(sx2 + 1, sy2, 90 * amt, 15 * amt, 10 * amt);
            add(sx2, sy2 + 1, 90 * amt, 15 * amt, 10 * amt);
          }
        }
      }
    }

    if (this.scanState) {
      const progress = clamp((now - this.scanState.started) / SCAN_DURATION, 0, 1);
      const lineY = Math.min(H - 2, Math.floor(progress * (H - 1)));
      for (let x = 0; x < W; x++) {
        const edge = 1 - Math.pow(Math.abs(x / W - 0.5) * 2, 3);
        const i0 = (lineY * W + x) * 4;
        data[i0] = Math.min(255, data[i0] + 80 * edge + 20);
        data[i0 + 1] = Math.min(255, data[i0 + 1] + 152 * edge + 30);
        data[i0 + 2] = Math.min(255, data[i0 + 2] + 162 * edge + 34);
        if (lineY + 1 < H) {
          const i1 = ((lineY + 1) * W + x) * 4;
          data[i1] = Math.min(255, data[i1] + 42 * edge);
          data[i1 + 1] = Math.min(255, data[i1 + 1] + 84 * edge);
          data[i1 + 2] = Math.min(255, data[i1 + 2] + 94 * edge);
        }
      }
      for (let y = Math.max(0, lineY - 16); y < lineY; y++) {
        const fade = (1 - (lineY - y) / 16) * 5;
        for (let x = 0; x < W; x += 3) {
          const index = (y * W + x) * 4;
          data[index + 1] = Math.min(255, data[index + 1] + fade);
          data[index + 2] = Math.min(255, data[index + 2] + fade * 1.2);
        }
      }
      for (let x = 0; x < W; x += 24) {
        const index = (lineY * W + x) * 4;
        data[index + 1] = Math.min(255, data[index + 1] + 40);
      }
    }

    // Brief green wash when a new level loads, as if stepping out of the light.
    const sinceLoad = now - this.levelStartedAt;
    if (this.level > 0 && sinceLoad < TRANSITION_MS) {
      const wash = Math.pow(1 - sinceLoad / TRANSITION_MS, 2);
      const r = 40 * wash;
      const g = 120 * wash;
      const b = 70 * wash;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, data[i] + r);
        data[i + 1] = Math.min(255, data[i + 1] + g);
        data[i + 2] = Math.min(255, data[i + 2] + b);
      }
    }

    for (let i = 0; i < 440; i++) {
      const x = (Math.random() * W) | 0;
      const y = (Math.random() * H) | 0;
      const index = (y * W + x) * 4;
      const amount = Math.random() * 7;
      data[index + 1] = Math.min(255, data[index + 1] + amount);
      data[index + 2] = Math.min(255, data[index + 2] + amount * 1.4);
    }

    this.offCtx.putImageData(this.image, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
  }

  private kindTint(kind: number): number[] | null {
    switch (kind) {
      case 0:
        return [104, 233, 255];
      case 1:
        return [51, 137, 161];
      case 2:
        return [150, 250, 255];
      case 5:
        return [78, 145, 158];
      case 9:
        return [120, 255, 160];
      case 10:
        return [64, 118, 136];
      case 13:
        return [229, 244, 223];
      case 14:
        // Scanned Backrooms door: dark enough to read as black against yellow
        // wallpaper, but still an emissive point return on the black canvas.
        return [62, 49, 31];
      case 16:
        return [204, 180, 104];
      case 17:
        return [111, 85, 55];
      case 18:
        return [111, 102, 70];
      case 19:
        return [168, 145, 86];
      default:
        return null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* HUD                                                                */
  /* ---------------------------------------------------------------- */

  private addLog(text: string, tone: LogTone) {
    this.logs.push({ id: this.logId++, text, tone, stamp: stampFor(this.levelTime) });
    if (this.logs.length > 7) this.logs.shift();
  }

  private emitHud() {
    const now = performance.now();
    const exitDx = this.map.exit.x - this.player.x;
    const exitDz = this.map.exit.z - this.player.z;
    const exitDistance = Math.hypot(exitDx, exitDz);
    const exitBearing = (normAngle(Math.atan2(exitDx, exitDz) - this.player.yaw) * 180) / Math.PI;
    const heading = ((this.player.yaw * 180) / Math.PI + 360) % 360;
    const isTutorial = this.level === 0;
    const prompt =
      this.phase !== "playing"
        ? null
        : this.map.backrooms
          ? this.exitSeen && exitDistance < 2.7
            ? "ENTER THE GREEN EXIT DOOR"
            : null
          : this.exitSeen && exitDistance < 3.2
            ? "WALK INTO THE GREEN LIGHT"
            : null;

    const tutorial: TutorialItem[] = isTutorial
      ? [
          { text: "Press SPACE or click to fire a LiDAR sweep", done: this.levelScans >= 1 },
          { text: "The tunnel only exists where you have scanned. Walk forward with W", done: this.moved },
          { text: "Wait for the array to recharge, then sweep again", done: this.levelScans >= 2 },
          { text: "Turn with the mouse and sweep the side passage", done: this.levelScans >= 4 },
          { text: "Find the light-green EXIT. It is invisible until a sweep hits it", done: this.exitSeen },
          { text: "Walk into the green light to finish the tutorial", done: false },
        ]
      : [];

    this.onHud({
      phase: this.phase,
      level: this.level,
      levelCount: LEVEL_COUNT - 1,
      levelName: LEVEL_NAMES[this.level],
      isTutorial,
      backrooms: Boolean(this.map.backrooms),
      doorsSeen: this.seenDoors.size,
      doorsTotal: this.map.doors?.length ?? 0,
      showBanner: now < this.bannerUntil,
      bannerKicker:
        this.level === 1
          ? "Tutorial complete"
          : this.map.backrooms
            ? "Level 3 // the backrooms"
            : `Level ${this.level - 1} cleared`,
      energy: Math.round(this.readiness(now) * 100),
      scans: this.totalScans,
      levelScans: this.levelScans,
      points: this.count,
      levelTime: this.levelTime,
      runTime: this.runTime,
      muted: this.audio.muted,
      scanning: Boolean(this.scanState),
      scanProgress: this.scanState ? clamp((now - this.scanState.started) / SCAN_DURATION, 0, 1) : 0,
      scanId: this.scanId,
      cooldownLeft: Math.max(0, Math.round((this.scanReadyAt - now) / 100) / 10),
      exitSeen: this.exitSeen,
      exitDistance: Math.round(exitDistance * 10) / 10,
      exitBearing: Math.round(exitBearing),
      heading: Math.round(heading),
      walked: Math.round(this.totalWalked),
      prompt,
      sprinting: this.sprinting,
      tutorial,
      tutorialStep: tutorial.findIndex((item) => !item.done),
      log: [...this.logs],
    });
  }
}
