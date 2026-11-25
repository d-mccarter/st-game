import {
  FACTIONS,
  SHIP_TYPES,
  MAPS,
  buildMap,
  opposingFaction,
  ARC_LABELS,
} from './data.js';
import {
  neighbors,
  key,
  facingToward,
  facingDelta,
  relativeArc,
  hexInFacing,
  hexDistance,
  drawBoard,
  resizeCanvas,
  eventToLogic,
  screenToGrid,
  computeOrigin,
  fitTiles,
  createCamera,
  zoomAt,
} from './board.js';
import {
  createFx,
  fxBusy,
  enqueueFx,
  startMoveTween,
  startFireTween,
  tickFx,
  waitMs,
} from './fx.js';

let uid = 1;
const nextId = () => `ship-${uid++}`;

function blockedSetFromMap(map) {
  return new Set(map.blocked.map(([c, r]) => key(c, r)));
}

function occupiedSet(ships, exceptId = null) {
  const s = new Set();
  for (const ship of ships) {
    if (!ship.alive) continue;
    if (ship.id === exceptId) continue;
    s.add(key(ship.col, ship.row));
  }
  return s;
}

/**
 * Place a fleet on one edge of the map with no overlapping hexes.
 * West = left columns facing east; east = right columns facing west.
 * Prefers a 1-hex gap between ships, then packs tighter if the fleet is large.
 */
function spawnLine(faction, fleetCounts, side, map) {
  const ships = [];
  const facing = side === 'west' ? 0 : 3; // E / W
  const blocked = new Set((map.blocked || []).map(([c, r]) => key(c, r)));
  const occupied = new Set();

  const roster = [];
  for (const [typeId, count] of Object.entries(fleetCounts)) {
    const def = SHIP_TYPES[typeId];
    if (!def || def.faction !== faction || !count) continue;
    for (let i = 0; i < count; i++) roster.push(typeId);
  }
  if (!roster.length) return ships;

  const midRow = (map.rows - 1) / 2;
  // Use up to ~1/3 of the board depth so large fleets still fit
  const maxDepth = Math.max(2, Math.min(Math.floor(map.cols / 2) - 1, Math.ceil(roster.length / Math.max(1, map.rows - 2)) + 1));

  const candidates = [];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const col = side === 'west' ? depth : map.cols - 1 - depth;
    if (col < 1 || col > map.cols - 2) continue;
    for (let row = 1; row <= map.rows - 2; row++) {
      candidates.push({ col, row });
    }
  }
  // Prefer near the edge, then rows closest to the vertical center
  candidates.sort((a, b) => {
    const da = side === 'west' ? a.col : map.cols - 1 - a.col;
    const db = side === 'west' ? b.col : map.cols - 1 - b.col;
    if (da !== db) return da - db;
    return Math.abs(a.row - midRow) - Math.abs(b.row - midRow);
  });

  const adjacentOccupied = (col, row) => {
    for (const [dc, dr] of [
      [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [1, 1], [-1, -1], [-1, 1],
    ]) {
      if (occupied.has(key(col + dc, row + dr))) return true;
    }
    return false;
  };

  const claim = (preferGap) => {
    for (const cell of candidates) {
      const k = key(cell.col, cell.row);
      if (blocked.has(k) || occupied.has(k)) continue;
      if (preferGap && adjacentOccupied(cell.col, cell.row)) continue;
      occupied.add(k);
      return cell;
    }
    return null;
  };

  // Last-resort scan of the whole half-board (still unique hexes)
  const claimAnywhere = () => {
    const cols =
      side === 'west'
        ? [...Array(Math.floor(map.cols / 2)).keys()].map((c) => c + 1)
        : [...Array(Math.floor(map.cols / 2)).keys()].map((c) => map.cols - 2 - c);
    const rows = [...Array(map.rows - 2).keys()].map((r) => r + 1);
    rows.sort((a, b) => Math.abs(a - midRow) - Math.abs(b - midRow));
    for (const col of cols) {
      for (const row of rows) {
        const k = key(col, row);
        if (blocked.has(k) || occupied.has(k)) continue;
        occupied.add(k);
        return { col, row };
      }
    }
    return null;
  };

  let skipped = 0;
  for (const typeId of roster) {
    const def = SHIP_TYPES[typeId];
    const cell = claim(true) || claim(false) || claimAnywhere();
    if (!cell) {
      // Board truly full on this side — skip rather than stack
      skipped += 1;
      continue;
    }
    ships.push({
      id: nextId(),
      typeId,
      name: def.name,
      faction,
      col: cell.col,
      row: cell.row,
      facing,
      hull: def.hull,
      hullMax: def.hull,
      shields: def.shields,
      shieldsMax: def.shields,
      moveLeft: 0,
      hexesSinceTurn: 0,
      fired: false,
      activated: false,
      alive: true,
      overload: false,
    });
  }
  ships._skipped = skipped;
  return ships;
}

const MIRROR_TYPE = { ca: 'd7', ff: 'f5', d7: 'ca', f5: 'ff' };

function mirrorFleet(playerFaction, counts) {
  const enemy = opposingFaction(playerFaction);
  const mirror = {};
  for (const [typeId, count] of Object.entries(counts)) {
    if (!count) continue;
    const outType = MIRROR_TYPE[typeId];
    if (!outType) continue;
    mirror[outType] = (mirror[outType] || 0) + count;
  }
  return { faction: enemy, counts: mirror };
}

export function createGame(settings) {
  const map = buildMap(settings.map, settings.boardSize || 'standard');
  const playerFaction = settings.faction;
  const enemy = mirrorFleet(playerFaction, settings.fleet);

  const playerSide = playerFaction === 'federation' ? 'west' : 'east';
  const enemySide = playerSide === 'west' ? 'east' : 'west';

  const playerShips = spawnLine(playerFaction, settings.fleet, playerSide, map);
  const enemyShips = spawnLine(enemy.faction, enemy.counts, enemySide, map);
  const skipped = (playerShips._skipped || 0) + (enemyShips._skipped || 0);
  delete playerShips._skipped;
  delete enemyShips._skipped;
  const ships = [...playerShips, ...enemyShips];

  const game = {
    settings,
    map,
    cols: map.cols,
    rows: map.rows,
    blockedSet: blockedSetFromMap(map),
    ships,
    playerFaction,
    enemyFaction: enemy.faction,
    selectedId: null,
    mode: 'select', // select | move | fire
    activeWeaponId: null,
    round: 1,
    activationIndex: 0,
    log: [],
    winner: null,
    camera: createCamera(),
    fx: createFx(),
  };
  if (skipped) {
    log(
      game,
      `Fleet too large for this board — ${skipped} ship(s) could not be placed.`,
      'alert'
    );
  }
  return game;
}

export function shipDef(ship) {
  return SHIP_TYPES[ship.typeId];
}

export function log(game, text, kind = '') {
  game.log.unshift({ text, kind, t: Date.now() });
  if (game.log.length > 40) game.log.length = 40;
}

function living(game, faction = null) {
  return game.ships.filter((s) => s.alive && (!faction || s.faction === faction));
}

export function activationOrder(game) {
  if (game.settings.ruleAlternating) {
    const players = living(game, game.playerFaction);
    const enemies = living(game, game.enemyFaction);
    const order = [];
    const n = Math.max(players.length, enemies.length);
    for (let i = 0; i < n; i++) {
      if (players[i]) order.push(players[i].id);
      if (enemies[i]) order.push(enemies[i].id);
    }
    return order;
  }
  return [
    ...living(game, game.playerFaction).map((s) => s.id),
    ...living(game, game.enemyFaction).map((s) => s.id),
  ];
}

export function currentActor(game) {
  const order = activationOrder(game).filter((id) => {
    const s = game.ships.find((x) => x.id === id);
    return s && s.alive && !s.activated;
  });
  return order[0] ? game.ships.find((s) => s.id === order[0]) : null;
}

export function beginRound(game) {
  for (const s of game.ships) {
    if (!s.alive) continue;
    const def = shipDef(s);
    const overloadPenalty = s.overload ? 1 : 0;
    s.moveLeft = Math.max(1, def.move - overloadPenalty);
    // SFB: turn mode is satisfied at the start of the turn
    s.hexesSinceTurn = def.turnMode || 1;
    s.fired = false;
    s.activated = false;
    s.overload = false;
  }
  game.selectedId = null;
  game.mode = 'select';
  log(game, `Round ${game.round} — allocate movement and fire.`, '');
}

/**
 * SFB-style movement: only straight ahead along current facing.
 * Turns are separate orders (see turnShip).
 */
export function legalMovesFor(game, ship) {
  if (!ship || !ship.alive || ship.moveLeft <= 0) return [];
  const occ = occupiedSet(game.ships, ship.id);
  const moveCost = game.map.moveCost;
  const maxSteps = Math.floor(ship.moveLeft / moveCost);
  if (maxSteps <= 0) return [];

  const results = [];
  let col = ship.col;
  let row = ship.row;
  for (let step = 1; step <= maxSteps; step++) {
    const next = hexInFacing(col, row, ship.facing, game.cols, game.rows);
    if (!next) break;
    const k = key(next.col, next.row);
    if (game.blockedSet.has(k) || occ.has(k)) break;
    col = next.col;
    row = next.row;
    results.push({ col, row, dist: step });
  }
  return results;
}

/** True if the ship can spend 1 MP on a 60° facing change under SFB turn mode. */
export function canTurnShip(game, ship) {
  if (!ship || !ship.alive || fxBusy(game.fx)) return false;
  const actor = currentActor(game);
  if (!actor || actor.id !== ship.id || ship.faction !== game.playerFaction) return false;
  if (ship.moveLeft < 1) return false;
  const tm = shipDef(ship).turnMode || 1;
  return (ship.hexesSinceTurn || 0) >= tm;
}

export function fireTargetsFor(game, ship, weapon) {
  if (!ship || !weapon || ship.fired) return [];
  const arcs = new Set(weapon.arcs);
  const targets = [];
  for (const other of living(game)) {
    if (other.faction === ship.faction) continue;
    const dist = hexDistance(ship, other);
    if (dist < 1 || dist > weapon.range) continue;
    // Must be reachable via arc cells — check relative arc of target cell
    const arc = relativeArc(ship, { col: other.col, row: other.row });
    if (!arcs.has(arc)) continue;
    // Line roughly clear of asteroids (simplified: skip if any blocked on short path)
    if (blockedBetween(game, ship, other)) continue;
    targets.push({ col: other.col, row: other.row, shipId: other.id, dist });
  }
  return targets;
}

function blockedBetween(game, a, b) {
  // Sample midpoint cell(s)
  const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
  for (let i = 1; i < steps; i++) {
    const c = Math.round(a.col + ((b.col - a.col) * i) / steps);
    const r = Math.round(a.row + ((b.row - a.row) * i) / steps);
    if (game.blockedSet.has(key(c, r))) return true;
  }
  return false;
}

export function selectShip(game, shipId) {
  const ship = game.ships.find((s) => s.id === shipId && s.alive);
  if (!ship) return;
  const actor = currentActor(game);
  // Can inspect any ship; only actor can take orders if player's
  game.selectedId = ship.id;
  game.mode = 'select';
  if (actor && actor.id === ship.id && ship.faction === game.playerFaction) {
    game.mode = ship.moveLeft > 0 ? 'move' : ship.fired ? 'select' : 'fire';
  }
}

export function moveShip(game, col, row) {
  if (fxBusy(game.fx)) return false;
  const ship = game.ships.find((s) => s.id === game.selectedId);
  if (!ship) return false;
  const actor = currentActor(game);
  if (!actor || actor.id !== ship.id || ship.faction !== game.playerFaction) return false;
  const legal = legalMovesFor(game, ship);
  const hit = legal.find((m) => m.col === col && m.row === row);
  if (!hit) return false;
  const cost = hit.dist * game.map.moveCost;
  const from = { col: ship.col, row: ship.row };
  // Facing is unchanged by forward movement (SFB: turns are separate)
  ship.col = col;
  ship.row = row;
  ship.moveLeft = Math.max(0, ship.moveLeft - cost);
  ship.hexesSinceTurn = (ship.hexesSinceTurn || 0) + hit.dist;
  log(game, `${ship.name} moved to ${col},${row}.`, '');
  game.mode = ship.fired ? 'select' : 'fire';
  const moving = startMoveTween(game.fx, ship, from);
  game._fxPulse?.();
  enqueueFx(game.fx, async () => {
    await moving;
    game._fxPulse?.();
  });
  return true;
}

/**
 * Change facing by one hexside (60°).
 * @param {number} dir -1 = port (left / counterclockwise on the hex), +1 = starboard
 */
export function turnShip(game, dir) {
  if (fxBusy(game.fx)) return false;
  const ship = game.ships.find((s) => s.id === game.selectedId);
  if (!ship || !canTurnShip(game, ship)) return false;
  const step = dir < 0 ? -1 : 1;
  ship.facing = (((ship.facing + step) % 6) + 6) % 6;
  ship.moveLeft = Math.max(0, ship.moveLeft - 1);
  ship.hexesSinceTurn = 0;
  const label = ['E', 'NE', 'NW', 'W', 'SW', 'SE'][ship.facing];
  log(
    game,
    `${ship.name} turns ${step < 0 ? 'port' : 'starboard'} → ${label}.`,
    ''
  );
  game.mode = ship.moveLeft > 0 ? 'move' : ship.fired ? 'select' : 'fire';
  game._fxPulse?.();
  return true;
}

function isEdge(game, ship) {
  return (
    ship.col === 0 ||
    ship.row === 0 ||
    ship.col === game.cols - 1 ||
    ship.row === game.rows - 1
  );
}

function planShot(ship, target, weapon, overloadBonus = 0) {
  let dmg = weapon.damage + overloadBonus;
  const absorbed = Math.min(target.shields, dmg);
  const hullDmg = Math.max(0, dmg - absorbed);
  const destroyed = target.hull - hullDmg <= 0;
  const shieldOnly = hullDmg === 0;
  let label;
  let kind;
  if (destroyed) {
    label = 'Destroyed!';
    kind = 'kill';
  } else if (shieldOnly) {
    label = `−${absorbed} shield`;
    kind = 'shield';
  } else if (absorbed > 0) {
    label = `−${absorbed} sh / −${hullDmg} hu`;
    kind = 'hit';
  } else {
    label = `−${hullDmg} hull`;
    kind = 'hit';
  }
  return { absorbed, hullDmg, destroyed, shieldOnly, label, kind };
}

function applyShot(target, plan) {
  target.shields = Math.max(0, target.shields - plan.absorbed);
  target.hull = Math.max(0, target.hull - plan.hullDmg);
  // Keep the token on the board until the burst finishes (caller clears alive)
}

export function fireAt(game, targetShipId, weaponId) {
  if (fxBusy(game.fx)) return false;
  const ship = game.ships.find((s) => s.id === game.selectedId);
  const target = game.ships.find((s) => s.id === targetShipId && s.alive);
  if (!ship || !target || ship.fired) return false;
  const actor = currentActor(game);
  if (!actor || actor.id !== ship.id || ship.faction !== game.playerFaction) return false;
  const def = shipDef(ship);
  const weapon = def.weapons.find((w) => w.id === weaponId) || def.weapons[0];
  const targets = fireTargetsFor(game, ship, weapon);
  if (!targets.some((t) => t.shipId === target.id)) return false;

  if (game.settings.ruleOverload) ship.overload = true;
  const plan = planShot(ship, target, weapon, ship.overload ? 1 : 0);
  ship.fired = true;
  game.mode = 'select';

  const firing = startFireTween(game.fx, ship, target, weapon, plan);
  game._fxPulse?.();
  enqueueFx(game.fx, async () => {
    await firing;
    applyShot(target, plan);
    if (plan.hullDmg > 0) {
      log(
        game,
        `${ship.name} hits ${target.name} with ${weapon.name} for ${plan.absorbed} shield / ${plan.hullDmg} hull.`,
        'alert'
      );
    } else {
      log(game, `${ship.name}'s ${weapon.name} splash against ${target.name}'s shields.`, '');
    }
    if (plan.destroyed) log(game, `${target.name} destroyed!`, 'bad');
    await waitMs(plan.destroyed ? 480 : 180);
    if (plan.destroyed) target.alive = false;
    checkVictory(game);
    if (!game.winner && ship.moveLeft <= 0) {
      ship.activated = true;
      game.selectedId = null;
      afterActivation(game);
    } else if (!game.winner) {
      // Still this ship's activation — keep it selected for movement
      selectShip(game, ship.id);
      game.activeWeaponId = shipDef(ship).weapons[0].id;
      game.mode = ship.moveLeft > 0 ? 'move' : 'select';
    }
    // If afterActivation handed the turn to the player’s next ship, select it
    const actor = currentActor(game);
    if (
      !game.winner &&
      actor &&
      actor.faction === game.playerFaction &&
      (!game.selectedId || game.ships.find((s) => s.id === game.selectedId)?.activated)
    ) {
      selectShip(game, actor.id);
      game.activeWeaponId = shipDef(actor).weapons[0].id;
      game.mode = 'move';
    }
    game._fxPulse?.();
  });
  game._fxPulse?.();
  return true;
}

export function holdOrders(game) {
  if (fxBusy(game.fx)) return false;
  const actor = currentActor(game);
  if (!actor || actor.faction !== game.playerFaction) return false;
  // Prefer selected ship if it's the actor; otherwise end the current actor
  let ship = game.ships.find((s) => s.id === game.selectedId);
  if (!ship || ship.id !== actor.id) ship = actor;
  ship.moveLeft = 0;
  ship.fired = true;
  ship.activated = true;
  log(game, `${ship.name} ends activation.`, '');
  game.selectedId = null;
  game.mode = 'select';
  afterActivation(game);
  return true;
}

export function endActivation(game) {
  if (fxBusy(game.fx)) return;
  holdOrders(game);
}

function afterActivation(game) {
  checkVictory(game);
  if (game.winner) return;
  const next = currentActor(game);
  if (!next) {
    game.round += 1;
    beginRound(game);
    // AI takes all enemy activations interleaved via loop after player — handled in AI pass
    return;
  }
  if (next.faction !== game.playerFaction) {
    runAiActivation(game, next);
  }
}

function finishAiShip(game, ship) {
  ship.activated = true;
  ship.moveLeft = 0;
  ship.fired = true;
  game.selectedId = null;
  checkVictory(game);
  if (game.winner) {
    game._fxPulse?.();
    return;
  }
  const next = currentActor(game);
  if (!next) {
    game.round += 1;
    beginRound(game);
    const n2 = currentActor(game);
    if (n2 && n2.faction !== game.playerFaction) runAiActivation(game, n2);
    else game._fxPulse?.();
  } else if (next.faction !== game.playerFaction) {
    runAiActivation(game, next);
  } else {
    game._fxPulse?.();
  }
}

function aiCanTurn(ship) {
  const tm = shipDef(ship).turnMode || 1;
  return ship.moveLeft >= 1 && (ship.hexesSinceTurn || 0) >= tm;
}

function runAiActivation(game, ship) {
  // Animate AI turn / move / fire on the FX queue so player input stays locked
  enqueueFx(game.fx, async () => {
    const enemies = living(game, game.playerFaction);
    if (!enemies.length) {
      finishAiShip(game, ship);
      return;
    }
    enemies.sort((a, b) => hexDistance(ship, a) - hexDistance(ship, b));
    const prey = enemies[0];
    game.selectedId = ship.id;

    // Turn toward the prey (SFB: 1 MP + turn mode per hexside)
    const desired = facingToward(ship, prey);
    let guard = 0;
    while (ship.facing !== desired && aiCanTurn(ship) && guard++ < 6) {
      const cw = facingDelta(ship.facing, desired);
      const step = cw <= 3 ? 1 : -1;
      ship.facing = (((ship.facing + step) % 6) + 6) % 6;
      ship.moveLeft -= 1;
      ship.hexesSinceTurn = 0;
      log(
        game,
        `${ship.name} turns ${step < 0 ? 'port' : 'starboard'} → ${['E', 'NE', 'NW', 'W', 'SW', 'SE'][ship.facing]}.`,
        ''
      );
      game._fxPulse?.();
      await waitMs(220);
    }

    // Advance straight ahead if that closes distance
    const moves = legalMovesFor(game, ship);
    if (moves.length) {
      moves.sort(
        (a, b) =>
          hexDistance({ col: a.col, row: a.row }, prey) -
          hexDistance({ col: b.col, row: b.row }, prey)
      );
      const best = moves[0];
      const here = hexDistance(ship, prey);
      const there = hexDistance(best, prey);
      if (there < here || there === here) {
        const from = { col: ship.col, row: ship.row };
        const cost = best.dist * game.map.moveCost;
        ship.col = best.col;
        ship.row = best.row;
        ship.moveLeft = Math.max(0, ship.moveLeft - cost);
        ship.hexesSinceTurn = (ship.hexesSinceTurn || 0) + best.dist;
        log(game, `${ship.name} closes to ${best.col},${best.row}.`, '');
        const moving = startMoveTween(game.fx, ship, from);
        game._fxPulse?.();
        await moving;
      }
    }

    const def = shipDef(ship);
    const weapon = [...def.weapons].sort((a, b) => b.damage - a.damage)[0];
    const targets = fireTargetsFor(game, ship, weapon);
    if (targets.length) {
      const t = game.ships.find((s) => s.id === targets[0].shipId && s.alive);
      if (t) {
        const plan = planShot(ship, t, weapon, 0);
        const firing = startFireTween(game.fx, ship, t, weapon, plan);
        game._fxPulse?.();
        await firing;
        applyShot(t, plan);
        log(
          game,
          `${ship.name} fires ${weapon.name} at ${t.name} (${plan.absorbed} sh / ${plan.hullDmg} hu).`,
          'alert'
        );
        if (plan.destroyed) log(game, `${t.name} destroyed!`, 'bad');
        await waitMs(plan.destroyed ? 480 : 160);
        if (plan.destroyed) t.alive = false;
      }
    }

    finishAiShip(game, ship);
  });
  game._fxPulse?.();
}

function checkVictory(game) {
  const p = living(game, game.playerFaction).length;
  const e = living(game, game.enemyFaction).length;
  if (e === 0) {
    game.winner = 'player';
    log(game, 'All hostile vessels destroyed. Victory!', 'good');
  } else if (p === 0) {
    game.winner = 'enemy';
    log(game, 'Your fleet has been eliminated.', 'bad');
  }
}

export function getBoardView(game) {
  const selected = game.ships.find((s) => s.id === game.selectedId && s.alive);
  const def = selected ? shipDef(selected) : null;
  const weapon =
    selected && def
      ? def.weapons.find((w) => w.id === game.activeWeaponId) || def.weapons[0]
      : null;

  let legalMoves = [];
  let fireTargets = [];
  let showArcsWeapon = null;
  if (selected) {
    const actor = currentActor(game);
    const controllable =
      actor && actor.id === selected.id && selected.faction === game.playerFaction;
    // One highlight mode at a time so colors stay readable
    if (controllable && game.mode === 'move') {
      legalMoves = legalMovesFor(game, selected);
    } else if (controllable && game.mode === 'fire' && weapon) {
      fireTargets = fireTargetsFor(game, selected, weapon);
      showArcsWeapon = weapon;
    } else if (controllable && game.mode === 'select' && selected.moveLeft > 0) {
      // Default to move previews when an active ship is first selected
      legalMoves = legalMovesFor(game, selected);
    }
  }

  return {
    cols: game.cols,
    rows: game.rows,
    blockedSet: game.blockedSet,
    ships: game.ships,
    selectedId: game.selectedId,
    legalMoves: fxBusy(game.fx) ? [] : legalMoves,
    fireTargets: fxBusy(game.fx) ? [] : fireTargets,
    showArcsWeapon: fxBusy(game.fx) ? null : showArcsWeapon,
    factions: FACTIONS,
    camera: game.camera,
    fx: game.fx,
  };
}

export function attachBoardController(canvas, getGame, onChange) {
  let suppressClick = false;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let panning = false;
  let panLast = null;
  let animRaf = 0;

  const measure = (game) => {
    const parent = canvas.parentElement.getBoundingClientRect();
    canvas._logicW = Math.max(200, Math.floor(parent.width));
    canvas._logicH = Math.max(200, Math.floor(parent.height));
    fitTiles(canvas, game.cols, game.rows, game.camera);
    return computeOrigin(canvas, game.cols, game.rows);
  };

  const ensureFxLoop = () => {
    if (!animRaf) animRaf = requestAnimationFrame(pumpFx);
  };

  const paint = () => {
    const game = getGame();
    if (!game) return;
    game._fxPulse = () => {
      ensureFxLoop();
      onChange();
    };
    const ctx = resizeCanvas(canvas);
    drawBoard(ctx, getBoardView(game));
  };

  const pumpFx = () => {
    animRaf = 0;
    const game = getGame();
    if (!game?.fx) return;
    const alive = tickFx(game.fx);
    paint();
    if (alive) {
      animRaf = requestAnimationFrame(pumpFx);
    } else {
      onChange();
    }
  };

  const onPointer = (evt) => {
    const game = getGame();
    if (!game || game.winner) {
      paint();
      return;
    }
    if (fxBusy(game.fx)) {
      paint();
      return;
    }
    if (suppressClick) {
      suppressClick = false;
      paint();
      return;
    }
    if (evt.preventDefault) evt.preventDefault();

    const origin = measure(game);
    const { x, y } = eventToLogic(canvas, evt);
    const cell = screenToGrid(
      x,
      y,
      origin.originX,
      origin.originY,
      game.cols,
      game.rows,
      game.camera
    );

    try {
      if (cell) {
        const shipHere = game.ships.find(
          (s) => s.alive && s.col === cell.col && s.row === cell.row
        );
        const view = getBoardView(game);

        const selected = game.ships.find((s) => s.id === game.selectedId);
        const actor = currentActor(game);
        const controlling =
          selected &&
          actor &&
          actor.id === selected.id &&
          selected.faction === game.playerFaction;

        // Fire: red hex or enemy ship while in fire mode
        if (controlling && game.mode === 'fire' && !selected.fired) {
          const weapon =
            shipDef(selected).weapons.find((w) => w.id === game.activeWeaponId) ||
            shipDef(selected).weapons[0];
          const targets = fireTargetsFor(game, selected, weapon);
          const ft =
            targets.find((t) => t.col === cell.col && t.row === cell.row) ||
            (shipHere &&
              shipHere.faction !== game.playerFaction &&
              targets.find((t) => t.shipId === shipHere.id));
          if (ft) {
            fireAt(game, ft.shipId, weapon.id);
            onChange();
            return;
          }
          if (shipHere && shipHere.faction !== game.playerFaction) {
            log(
              game,
              `${shipHere.name} is out of arc or range for ${weapon.name}.`,
              'alert'
            );
            onChange();
            return;
          }
        }

        if (view.legalMoves.some((m) => m.col === cell.col && m.row === cell.row)) {
          moveShip(game, cell.col, cell.row);
          onChange();
          return;
        }

        // Don't steal selection to a hostile while you still control an actor
        if (shipHere) {
          if (
            controlling &&
            shipHere.faction !== game.playerFaction &&
            (game.mode === 'fire' || game.mode === 'move')
          ) {
            onChange();
            return;
          }
          selectShip(game, shipHere.id);
          game.activeWeaponId = shipDef(shipHere).weapons[0].id;
          onChange();
          return;
        }
      }
    } finally {
      paint();
      ensureFxLoop();
    }
  };

  canvas.addEventListener('click', onPointer);

  canvas.addEventListener(
    'wheel',
    (e) => {
      const game = getGame();
      if (!game) return;
      e.preventDefault();
      const origin = measure(game);
      const { x, y } = eventToLogic(canvas, e);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(game.camera, x, y, origin.originX, origin.originY, factor);
      paint();
    },
    { passive: false }
  );

  const touchDist = (touches) => {
    const a = touches[0];
    const b = touches[1];
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
  };

  canvas.addEventListener(
    'touchstart',
    (e) => {
      const game = getGame();
      if (!game) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        pinchStartDist = touchDist(e.touches);
        pinchStartZoom = game.camera.zoom;
        panning = false;
      } else if (e.touches.length === 1) {
        panning = false;
        panLast = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false };
      }
    },
    { passive: false }
  );

  canvas.addEventListener(
    'touchmove',
    (e) => {
      const game = getGame();
      if (!game) return;
      if (e.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault();
        const origin = measure(game);
        const rect = canvas.getBoundingClientRect();
        const midX =
          ((e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left) /
          rect.width *
          canvas._logicW;
        const midY =
          ((e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top) /
          rect.height *
          canvas._logicH;
        const factor = touchDist(e.touches) / pinchStartDist;
        const target = pinchStartZoom * factor;
        const step = target / game.camera.zoom;
        zoomAt(game.camera, midX, midY, origin.originX, origin.originY, step);
        pinchStartDist = touchDist(e.touches);
        pinchStartZoom = game.camera.zoom;
        suppressClick = true;
        paint();
      } else if (e.touches.length === 1 && panLast && game.camera.zoom > 1.02) {
        e.preventDefault();
        const dx = e.touches[0].clientX - panLast.x;
        const dy = e.touches[0].clientY - panLast.y;
        if (Math.hypot(dx, dy) > 4) panLast.moved = true;
        if (panLast.moved) {
          game.camera.panX += dx / game.camera.zoom;
          game.camera.panY += dy / game.camera.zoom;
          panLast.x = e.touches[0].clientX;
          panLast.y = e.touches[0].clientY;
          suppressClick = true;
          paint();
        }
      }
    },
    { passive: false }
  );

  canvas.addEventListener(
    'touchend',
    (e) => {
      pinchStartDist = 0;
      if (e.changedTouches?.length === 1 && !suppressClick && e.touches.length === 0) {
        onPointer(e.changedTouches[0]);
      }
      if (e.touches.length === 0) {
        panLast = null;
        // keep suppressClick until next click cycle clears it in onPointer
      }
    },
    { passive: false }
  );

  // Desktop pan when zoomed: drag with right mouse or space+left
  canvas.addEventListener('mousedown', (e) => {
    const game = getGame();
    if (!game) return;
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      panning = true;
      panLast = { x: e.clientX, y: e.clientY };
    }
  });
  window.addEventListener('mousemove', (e) => {
    const game = getGame();
    if (!game || !panning || !panLast) return;
    const dx = e.clientX - panLast.x;
    const dy = e.clientY - panLast.y;
    game.camera.panX += dx / game.camera.zoom;
    game.camera.panY += dy / game.camera.zoom;
    panLast = { x: e.clientX, y: e.clientY };
    paint();
  });
  window.addEventListener('mouseup', () => {
    panning = false;
    panLast = null;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('resize', paint);

  return { paint, refresh: paint };
}

export { ARC_LABELS, FACTIONS, shipDef as getShipDef };
