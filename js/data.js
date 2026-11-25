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
    name: 'Constitution Cruiser',
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
    name: 'Miranda Frigate',
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
    name: 'F5 Frigate',
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

export const MAPS = {
  void: {
    id: 'void',
    name: 'Open Void',
    cols: 9,
    rows: 9,
    moveCost: 1,
    blocked: [],
  },
  asteroids: {
    id: 'asteroids',
    name: 'Asteroid Field',
    cols: 9,
    rows: 9,
    moveCost: 1,
    blocked: [
      [3, 2], [4, 2], [5, 3], [2, 5], [6, 5], [4, 6], [3, 7],
    ],
  },
  nebula: {
    id: 'nebula',
    name: 'Nebula Drift',
    cols: 9,
    rows: 9,
    moveCost: 2,
    blocked: [],
  },
};

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
