/** Factions, ship types, map presets — simplified Starfleet Battles slice. */

export const FACTIONS = {
  federation: {
    id: 'federation',
    name: 'United Federation of Planets',
    short: 'Federation',
    color: '#3db8e8',
    accent: '#9ad9f2',
  },
  klingon: {
    id: 'klingon',
    name: 'Klingon Empire',
    short: 'Klingon',
    color: '#d45a2a',
    accent: '#f0a078',
  },
};

/**
 * Ship stats are intentionally small for a playable first slice.
 * facing: 0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE (flat-top hex)
 * arcs: relative facing offsets that can be targeted (0 = forward)
 */
export const SHIP_TYPES = {
  ca: {
    id: 'ca',
    name: 'Constitution-class',
    faction: 'federation',
    cost: 75,
    hull: 10,
    shields: 8,
    move: 3,
    weapons: [
      { id: 'phaser', name: 'Phasers', damage: 2, range: 3, arcs: [0, 1, 5] },
      { id: 'photon', name: 'Photon Torpedoes', damage: 4, range: 4, arcs: [0] },
    ],
  },
  ff: {
    id: 'ff',
    name: 'Miranda-class',
    faction: 'federation',
    cost: 45,
    hull: 6,
    shields: 5,
    move: 4,
    weapons: [
      { id: 'phaser', name: 'Phasers', damage: 2, range: 3, arcs: [0, 1, 5] },
      { id: 'photon', name: 'Photon Torpedoes', damage: 3, range: 3, arcs: [0] },
    ],
  },
  d7: {
    id: 'd7',
    name: 'D7 Battlecruiser',
    faction: 'klingon',
    cost: 75,
    hull: 9,
    shields: 7,
    move: 3,
    weapons: [
      { id: 'disruptor', name: 'Disruptors', damage: 3, range: 3, arcs: [0, 1, 5] },
      { id: 'photon', name: 'Photon Torpedoes', damage: 4, range: 4, arcs: [0] },
    ],
  },
  f5: {
    id: 'f5',
    name: 'Bird of Prey',
    faction: 'klingon',
    cost: 45,
    hull: 5,
    shields: 4,
    move: 4,
    weapons: [
      { id: 'disruptor', name: 'Disruptors', damage: 2, range: 3, arcs: [0, 1, 5] },
      { id: 'drone', name: 'Drone Rack', damage: 3, range: 3, arcs: [0] },
    ],
  },
};

/** Selectable hex-grid sizes (cols × rows). */
export const BOARD_SIZES = {
  skirmish: { id: 'skirmish', name: 'Skirmish — 9×9', cols: 9, rows: 9 },
  standard: { id: 'standard', name: 'Standard — 12×12', cols: 12, rows: 12 },
  fleet: { id: 'fleet', name: 'Fleet — 15×15', cols: 15, rows: 15 },
  sector: { id: 'sector', name: 'Sector — 18×14', cols: 18, rows: 14 },
};

const MAP_BASE = {
  void: {
    id: 'void',
    name: 'Open Void',
    moveCost: 1,
    blockedFrac: [],
  },
  asteroids: {
    id: 'asteroids',
    name: 'Asteroid Field',
    moveCost: 1,
    blockedFrac: [
      [0.33, 0.22],
      [0.44, 0.22],
      [0.55, 0.33],
      [0.22, 0.55],
      [0.66, 0.55],
      [0.44, 0.66],
      [0.33, 0.77],
      [0.5, 0.4],
      [0.7, 0.3],
      [0.28, 0.38],
      [0.6, 0.72],
      [0.75, 0.48],
      [0.4, 0.5],
      [0.52, 0.58],
    ],
  },
  nebula: {
    id: 'nebula',
    name: 'Nebula Drift',
    moveCost: 2,
    blockedFrac: [],
  },
};

/** @deprecated Prefer buildMap — kept for UI name lookups */
export const MAPS = Object.fromEntries(
  Object.entries(MAP_BASE).map(([id, m]) => [
    id,
    { ...m, cols: 12, rows: 12, blocked: [] },
  ])
);

function uniqueCells(cells, cols, rows) {
  const seen = new Set();
  const out = [];
  for (const [c, r] of cells) {
    if (c < 1 || r < 1 || c >= cols - 1 || r >= rows - 1) continue;
    const k = `${c},${r}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([c, r]);
  }
  return out;
}

/** Build a concrete map for the chosen terrain + board size. */
export function buildMap(mapId, sizeId = 'standard') {
  const base = MAP_BASE[mapId] || MAP_BASE.void;
  const size = BOARD_SIZES[sizeId] || BOARD_SIZES.standard;
  const cols = size.cols;
  const rows = size.rows;
  const maxFrac = cols >= 15 ? 1 : cols >= 12 ? 0.75 : 0.5;
  const fracs = (base.blockedFrac || []).slice(
    0,
    Math.max(0, Math.ceil((base.blockedFrac || []).length * maxFrac))
  );
  const blocked = uniqueCells(
    fracs.map(([fx, fy]) => [Math.round(fx * (cols - 1)), Math.round(fy * (rows - 1))]),
    cols,
    rows
  );
  return {
    id: base.id,
    name: base.name,
    cols,
    rows,
    moveCost: base.moveCost,
    blocked,
    sizeId: size.id,
    sizeName: size.name,
  };
}

export function shipsForFaction(factionId) {
  return Object.values(SHIP_TYPES).filter((s) => s.faction === factionId);
}

export function opposingFaction(factionId) {
  return factionId === 'federation' ? 'klingon' : 'federation';
}

/** Arc labels for UI */
export const ARC_LABELS = {
  0: 'Forward',
  1: 'Fore-starboard',
  2: 'Aft-starboard',
  3: 'Aft',
  4: 'Aft-port',
  5: 'Fore-port',
};
