/**
 * Level generation and geometry queries.
 *
 * Cell codes:
 *   0  rock (solid)              1-3  tunnel floor variants (walkable)
 *   4  exit floor (walkable)     11   rock rib (solid)
 *   13 exit frame (solid, green)
 */

export const MAP_W = 48;
export const MAP_H = 48;
export const CEILING = 2.85;
export const EYE_HEIGHT = 1.52;

/** Level 0 is the tutorial, levels 1-2 are compact mazes, and level 3 is Backrooms. */
export const LEVEL_COUNT = 4;
export const LEVEL_NAMES = [
  "Entry Bore",
  "The Drains",
  "The Roots",
  "The Backrooms",
];

export type Vec2 = { x: number; z: number };

export interface CaveMap {
  cells: Uint8Array;
  spawn: Vec2;
  spawnYaw: number;
  exit: Vec2;
  backrooms?: boolean;
  doors?: BackroomsDoor[];
  monsterSpawn?: Vec2;
}

export interface BackroomsDoor {
  id: number;
  x: number;
  z: number;
  normalX: number;
  normalZ: number;
  width: number;
  height: number;
  isExit: boolean;
}

export interface RayHit {
  dist: number;
  cell: number;
  wall: boolean;
  /** 0 = crossed a plane perpendicular to X, 1 = perpendicular to Z. */
  side: 0 | 1;
}

export const WALKABLE = (v: number) => v > 0 && v < 10;
export const SOLID = (v: number) => v === 0 || v >= 10;

export function hash2(x: number, z: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cellAt(map: CaveMap, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  if (ix < 0 || iz < 0 || ix >= MAP_W || iz >= MAP_H) return 0;
  return map.cells[iz * MAP_W + ix];
}

export function isSolid(map: CaveMap, x: number, z: number): boolean {
  return SOLID(cellAt(map, x, z));
}

export function isBlocked(map: CaveMap, x: number, z: number, radius = 0.26): boolean {
  return (
    isSolid(map, x - radius, z - radius) ||
    isSolid(map, x + radius, z - radius) ||
    isSolid(map, x - radius, z + radius) ||
    isSolid(map, x + radius, z + radius)
  );
}

/* ------------------------------------------------------------------ */
/* Ray casting (DDA through the cell grid)                             */
/* ------------------------------------------------------------------ */

export function castRay(
  map: CaveMap,
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDist: number,
): RayHit | null {
  if (Math.abs(dx) < 1e-8 && Math.abs(dz) < 1e-8) return null;
  let mapX = Math.floor(ox);
  let mapZ = Math.floor(oz);
  if (mapX < 0 || mapZ < 0 || mapX >= MAP_W || mapZ >= MAP_H) return null;

  const deltaX = Math.abs(dx) < 1e-8 ? 1e30 : Math.abs(1 / dx);
  const deltaZ = Math.abs(dz) < 1e-8 ? 1e30 : Math.abs(1 / dz);
  const stepX = dx < 0 ? -1 : 1;
  const stepZ = dz < 0 ? -1 : 1;
  const sideX = dx < 0 ? ox - mapX : mapX + 1 - ox;
  const sideZ = dz < 0 ? oz - mapZ : mapZ + 1 - oz;
  let tMaxX = Math.abs(dx) < 1e-8 ? 1e30 : sideX / Math.abs(dx);
  let tMaxZ = Math.abs(dz) < 1e-8 ? 1e30 : sideZ / Math.abs(dz);

  for (let i = 0; i < 128; i++) {
    let dist: number;
    let side: 0 | 1;
    if (tMaxX < tMaxZ) {
      dist = tMaxX;
      mapX += stepX;
      tMaxX += deltaX;
      side = 0;
    } else {
      dist = tMaxZ;
      mapZ += stepZ;
      tMaxZ += deltaZ;
      side = 1;
    }
    if (dist > maxDist) return null;
    if (mapX < 0 || mapZ < 0 || mapX >= MAP_W || mapZ >= MAP_H) return null;
    const cell = map.cells[mapZ * MAP_W + mapX];
    if (SOLID(cell)) return { dist, cell, wall: true, side };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Carving helpers                                                     */
/* ------------------------------------------------------------------ */

const inside = (ix: number, iz: number) => ix >= 1 && iz >= 1 && ix < MAP_W - 1 && iz < MAP_H - 1;

function carveDisc(cells: Uint8Array, cx: number, cz: number, r: number, seed: number) {
  const x0 = Math.floor(cx - r - 1);
  const x1 = Math.ceil(cx + r + 1);
  const z0 = Math.floor(cz - r - 1);
  const z1 = Math.ceil(cz + r + 1);
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      if (!inside(ix, iz)) continue;
      const dx = ix + 0.5 - cx;
      const dz = iz + 0.5 - cz;
      if (dx * dx + dz * dz > r * r) continue;
      const index = iz * MAP_W + ix;
      if (cells[index] !== 0) continue;
      const h = hash2(ix, iz, seed + 9);
      cells[index] = h > 0.93 ? 2 : h > 0.86 ? 3 : 1;
    }
  }
}

function carveSegment(cells: Uint8Array, a: Vec2, b: Vec2, phase: number, width: number, seed: number) {
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = width + 0.12 * Math.sin(t * Math.PI * 4 + phase);
    carveDisc(cells, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r, seed);
  }
}

/** Bony ribs jutting from the walls give surfaces some variety. */
function addRibs(cells: Uint8Array, seed: number) {
  for (let iz = 1; iz < MAP_H - 1; iz++) {
    for (let ix = 1; ix < MAP_W - 1; ix++) {
      const i = iz * MAP_W + ix;
      if (cells[i] !== 0) continue;
      const touches =
        WALKABLE(cells[i - 1]) || WALKABLE(cells[i + 1]) || WALKABLE(cells[i - MAP_W]) || WALKABLE(cells[i + MAP_W]);
      if (touches && hash2(ix, iz, seed + 21) > 0.955) cells[i] = 11;
    }
  }
}

/**
 * Light-green exit: a walkable 3x3 floor wrapped in a solid green frame.
 * Both only become visible once a sweep returns from them.
 */
function placeExit(cells: Uint8Array, ex: number, ez: number) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (inside(ex + dx, ez + dz)) cells[(ez + dz) * MAP_W + ex + dx] = 4;
    }
  }
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (!inside(ex + dx, ez + dz)) continue;
      const i = (ez + dz) * MAP_W + ex + dx;
      if (SOLID(cells[i])) cells[i] = 13;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Level 0: the tutorial tunnel                                        */
/* ------------------------------------------------------------------ */

// A short serpentine: east, down, west, down, and a final run to the exit.
const TUTORIAL_ROUTE: Vec2[] = [
  { x: 5.5, z: 4.5 },
  { x: 42.5, z: 4.5 },
  { x: 42.5, z: 12.5 },
  { x: 8.5, z: 12.5 },
  { x: 8.5, z: 20.5 },
  { x: 30.5, z: 20.5 },
];

function buildTutorial(): CaveMap {
  const seed = 7;
  const cells = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < TUTORIAL_ROUTE.length - 1; i++) {
    carveSegment(cells, TUTORIAL_ROUTE[i], TUTORIAL_ROUTE[i + 1], i * 1.7, 1.15, seed);
  }
  // One dead-end side passage so the "sweep the side passages" step has a target.
  carveSegment(cells, { x: 22.5, z: 12.5 }, { x: 22.5, z: 16.4 }, 0.5, 1.0, seed);
  addRibs(cells, seed);
  placeExit(cells, 30, 20);
  return {
    cells,
    spawn: { x: 5.5, z: 4.5 },
    spawnYaw: Math.PI / 2,
    exit: { x: 30.5, z: 20.5 },
  };
}

/* ------------------------------------------------------------------ */
/* Levels 1+: generated mazes                                          */
/* ------------------------------------------------------------------ */

function buildMaze(level: number): CaveMap {
  const seed = 1000 + level * 7919;
  const rand = mulberry32(seed);
  const cells = new Uint8Array(MAP_W * MAP_H);

  // Keep the campaign brisk: a 3x3 first maze grows only to 4x4.
  const n = Math.min(4, 2 + level);
  const spacing = 7;
  const span = (n - 1) * spacing;
  const origin = Math.floor((MAP_W - span) / 2) + 0.5;
  const jitter = 0.7;
  const nodes: Vec2[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      nodes.push({
        x: origin + i * spacing + (rand() * 2 - 1) * jitter,
        z: origin + j * spacing + (rand() * 2 - 1) * jitter,
      });
    }
  }

  // Depth-first "perfect maze" over the node grid: every node is reachable and
  // most branches end in dead ends.
  const adj: number[][] = Array.from({ length: n * n }, () => []);
  const visited = new Uint8Array(n * n);
  const stack = [0];
  visited[0] = 1;
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const ci = cur % n;
    const cj = Math.floor(cur / n);
    const options: number[] = [];
    for (const [di, dj] of DIRS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const k = nj * n + ni;
      if (!visited[k]) options.push(k);
    }
    if (!options.length) {
      stack.pop();
      continue;
    }
    const next = options[Math.floor(rand() * options.length)];
    visited[next] = 1;
    adj[cur].push(next);
    adj[next].push(cur);
    stack.push(next);
  }

  // Later levels get a few loops so there is more than one way around.
  const loops = Math.max(0, level - 2);
  for (let l = 0; l < loops; l++) {
    const a = Math.floor(rand() * n * n);
    const ai = a % n;
    const aj = Math.floor(a / n);
    for (const [di, dj] of DIRS) {
      const ni = ai + di;
      const nj = aj + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const b = nj * n + ni;
      if (adj[a].includes(b)) continue;
      adj[a].push(b);
      adj[b].push(a);
      break;
    }
  }

  for (let a = 0; a < nodes.length; a++) {
    for (const b of adj[a]) {
      if (b > a) carveSegment(cells, nodes[a], nodes[b], rand() * 6, 1.1, seed);
    }
  }
  for (const node of nodes) {
    carveDisc(cells, node.x, node.z, 1.15, seed);
    if (rand() < 0.22) carveDisc(cells, node.x, node.z, 1.6 + rand() * 0.3, seed);
  }

  // The exit goes at the node farthest from the start along the maze.
  const dist = new Int32Array(n * n).fill(-1);
  dist[0] = 0;
  const queue = [0];
  let exitNode = 0;
  while (queue.length) {
    const cur = queue.shift()!;
    if (dist[cur] > dist[exitNode]) exitNode = cur;
    for (const next of adj[cur]) {
      if (dist[next] !== -1) continue;
      dist[next] = dist[cur] + 1;
      queue.push(next);
    }
  }

  addRibs(cells, seed);
  const ex = Math.floor(nodes[exitNode].x);
  const ez = Math.floor(nodes[exitNode].z);
  placeExit(cells, ex, ez);

  const start = nodes[0];
  const facing = nodes[adj[0][0]];
  return {
    cells,
    spawn: { x: start.x, z: start.z },
    spawnYaw: Math.atan2(facing.x - start.x, facing.z - start.z),
    exit: { x: ex + 0.5, z: ez + 0.5 },
  };
}

/* ------------------------------------------------------------------ */
/* Final level: compact Backrooms                                      */
/* ------------------------------------------------------------------ */

function buildBackrooms(): CaveMap {
  const seed = 40981;
  const rand = mulberry32(seed);
  const cells = new Uint8Array(MAP_W * MAP_H);
  const n = 3;
  const spacing = 8.5;
  const origin = (MAP_W - (n - 1) * spacing) / 2 + 0.5;
  const nodes: Vec2[] = [];
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      nodes.push({
        x: origin + x * spacing + (rand() - 0.5) * 0.5,
        z: origin + z * spacing + (rand() - 0.5) * 0.5,
      });
    }
  }

  // A compact 3x3 office grid with broad, square rooms and a handful of
  // connecting corridors. The yellow wall returns are rendered as Backrooms
  // wallpaper by the scan palette, not as cave stone.
  const adj: number[][] = Array.from({ length: n * n }, () => []);
  const visited = new Uint8Array(n * n);
  const stack = [0];
  visited[0] = 1;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (stack.length) {
    const current = stack[stack.length - 1];
    const cx = current % n;
    const cz = Math.floor(current / n);
    const options: number[] = [];
    for (const [dx, dz] of dirs) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const next = nz * n + nx;
      if (!visited[next]) options.push(next);
    }
    if (!options.length) {
      stack.pop();
      continue;
    }
    const next = options[Math.floor(rand() * options.length)];
    visited[next] = 1;
    adj[current].push(next);
    adj[next].push(current);
    stack.push(next);
  }

  for (let a = 0; a < nodes.length; a++) {
    for (const b of adj[a]) {
      if (b > a) carveSegment(cells, nodes[a], nodes[b], rand() * 6, 1.45, seed);
    }
  }
  for (const node of nodes) carveDisc(cells, node.x, node.z, 2.45, seed);

  // The farthest leaf becomes the exit door. Other leaves get wrong black
  // doors, so a player must scan a door to distinguish the exit.
  const distances = new Int32Array(n * n).fill(-1);
  const queue = [0];
  distances[0] = 0;
  let exitNode = 0;
  while (queue.length) {
    const current = queue.shift()!;
    if (distances[current] > distances[exitNode]) exitNode = current;
    for (const next of adj[current]) {
      if (distances[next] !== -1) continue;
      distances[next] = distances[current] + 1;
      queue.push(next);
    }
  }

  const doors: BackroomsDoor[] = [];
  for (let nodeIndex = 1; nodeIndex < nodes.length; nodeIndex++) {
    const node = nodes[nodeIndex];
    const ix = nodeIndex % n;
    const iz = Math.floor(nodeIndex / n);
    const unconnected = dirs.filter(([dx, dz]) => {
      const nx = ix + dx;
      const nz = iz + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) return true;
      return !adj[nodeIndex].includes(nz * n + nx);
    });
    if (!unconnected.length) continue;
    // Bias door positions toward outside walls / dead ends, but keep them
    // within the walkable room so they can be scanned at close range.
    const [normalX, normalZ] = unconnected[Math.floor(rand() * unconnected.length)];
    const door: BackroomsDoor = {
      id: doors.length,
      x: node.x + normalX * 1.8,
      z: node.z + normalZ * 1.8,
      normalX,
      normalZ,
      width: 1.65,
      height: 2.35,
      isExit: nodeIndex === exitNode,
    };
    doors.push(door);
  }

  // A 3x3 spanning tree's farthest leaf always has a free wall; retain a safe
  // fallback in case a future topology change removes it.
  let exitDoor = doors.find((door) => door.isExit);
  if (!exitDoor) {
    const node = nodes[exitNode];
    exitDoor = {
      id: doors.length,
      x: node.x - 1.8,
      z: node.z,
      normalX: -1,
      normalZ: 0,
      width: 1.65,
      height: 2.35,
      isExit: true,
    };
    doors.push(exitDoor);
  }

  return {
    cells,
    spawn: { x: nodes[0].x, z: nodes[0].z },
    spawnYaw: Math.atan2(nodes[adj[0][0]].x - nodes[0].x, nodes[adj[0][0]].z - nodes[0].z),
    exit: { x: exitDoor.x, z: exitDoor.z },
    backrooms: true,
    doors,
    monsterSpawn: { x: nodes[exitNode].x, z: nodes[exitNode].z },
  };
}

export function generateLevel(level: number): CaveMap {
  if (level <= 0) return buildTutorial();
  if (level === LEVEL_COUNT - 1) return buildBackrooms();
  return buildMaze(level);
}

/* ------------------------------------------------------------------ */
/* Point classification for scan returns                               */
/* ------------------------------------------------------------------ */

export function pointKindForHit(
  cell: number,
  isWall: boolean,
  x: number,
  z: number,
  y: number,
  backrooms = false,
): number {
  // 9 = exit glow (light green).
  if (cell === 4 || cell === 13) return 9;
  if (backrooms) {
    if (!isWall) return y > CEILING - 0.08 ? 18 : 17;
    if (cell === 11) return 19;
    return hash2(Math.floor(x * 2.7), Math.floor(z * 2.7 + y * 9), cell) > 0.88 ? 19 : 16;
  }
  if (!isWall) {
    if (y > CEILING - 0.08) return 10;
    return cell === 2 ? 2 : 1;
  }
  if (cell === 11) return 13;
  const rnd = hash2(Math.floor(x * 2.7), Math.floor(z * 2.7 + y * 9), cell);
  return rnd > 0.84 ? 5 : 0;
}
