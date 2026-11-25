import {
  FACTIONS,
  SHIP_TYPES,
  MAPS,
  opposingFaction,
  ARC_LABELS,
} from './data.js';
import {
  neighbors,
  key,
  facingToward,
  relativeArc,
  drawBoard,
  resizeCanvas,
  eventToLogic,
  screenToGrid,
  computeOrigin,
  fitTiles,
} from './board.js';

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

function spawnLine(faction, fleetCounts, side, map) {
  const ships = [];
  const row = side === 'west' ? 1 : map.rows - 2;
  let col = 1;
  const facing = side === 'west' ? 1 : 4;
  for (const [typeId, count] of Object.entries(fleetCounts)) {
    const def = SHIP_TYPES[typeId];
    if (!def || def.faction !== faction) continue;
    for (let i = 0; i < count; i++) {
      while (
        col < map.cols - 1 &&
        map.blocked.some(([c, r]) => c === col && r === row)
      ) {
        col += 1;
      }
      if (col >= map.cols - 1) col = 1;
      ships.push({
        id: nextId(),
        typeId,
        name: def.name,
        faction,
        col,
        row,
        facing,
        hull: def.hull,
        hullMax: def.hull,
        shields: def.shields,
        shieldsMax: def.shields,
        moveLeft: 0,
        fired: false,
        activated: false,
        alive: true,
        overload: false,
      });
      col += 1;
    }
  }
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
  const map = MAPS[settings.map];
  const playerFaction = settings.faction;
  const enemy = mirrorFleet(playerFaction, settings.fleet);

  const playerSide = playerFaction === 'federation' ? 'west' : 'east';
  const enemySide = playerSide === 'west' ? 'east' : 'west';

  const ships = [
    ...spawnLine(playerFaction, settings.fleet, playerSide, map),
    ...spawnLine(enemy.faction, enemy.counts, enemySide, map),
  ];

  return {
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
  };
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
    s.fired = false;
    s.activated = false;
    s.overload = false;
  }
  game.selectedId = null;
  game.mode = 'select';
  log(game, `Round ${game.round} — allocate movement and fire.`, '');
}

export function legalMovesFor(game, ship) {
  if (!ship || !ship.alive || ship.moveLeft <= 0) return [];
  const occ = occupiedSet(game.ships, ship.id);
  const moveCost = game.map.moveCost;
  const maxSteps = Math.floor(ship.moveLeft / moveCost);
  if (maxSteps <= 0) return [];

  const results = [];
  const seen = new Map([[key(ship.col, ship.row), 0]]);
  const q = [{ col: ship.col, row: ship.row, dist: 0 }];

  while (q.length) {
    const cur = q.shift();
    if (cur.dist >= maxSteps) continue;
    for (const n of neighbors(cur.col, cur.row, game.cols, game.rows)) {
      const k = key(n.col, n.row);
      if (game.blockedSet.has(k) || occ.has(k)) continue;
      const nd = cur.dist + 1;
      if (seen.has(k) && seen.get(k) <= nd) continue;
      seen.set(k, nd);
      q.push({ ...n, dist: nd });
      results.push({ col: n.col, row: n.row, dist: nd });
    }
  }
  return results;
}

export function fireTargetsFor(game, ship, weapon) {
  if (!ship || !weapon || ship.fired) return [];
  const arcs = new Set(weapon.arcs);
  const targets = [];
  for (const other of living(game)) {
    if (other.faction === ship.faction) continue;
    const dist = hexApproxDist(ship, other);
    if (dist < 1 || dist > weapon.range) continue;
    // Must be reachable via arc cells — check relative arc of target cell
    const arc = relativeArc(ship, { col: other.col, row: other.row });
    if (!arcs.has(arc)) continue;
    // Line roughly clear of asteroids (simplified: skip if any blocked on short path)
    if (blockedBetween(game, ship, other)) continue;
    targets.push({ col: other.col, row: other.row, shipId: other.id });
  }
  return targets;
}

function hexApproxDist(a, b) {
  // On this diamond grid, use BFS distance
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
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
  const ship = game.ships.find((s) => s.id === game.selectedId);
  if (!ship) return false;
  const actor = currentActor(game);
  if (!actor || actor.id !== ship.id || ship.faction !== game.playerFaction) return false;
  const legal = legalMovesFor(game, ship);
  const hit = legal.find((m) => m.col === col && m.row === row);
  if (!hit) return false;
  const cost = hit.dist * game.map.moveCost;
  ship.facing = facingToward(
    { col: ship.col, row: ship.row },
    { col, row }
  );
  ship.col = col;
  ship.row = row;
  ship.moveLeft = Math.max(0, ship.moveLeft - cost);
  log(game, `${ship.name} moved to ${col},${row}.`, '');
  if (game.settings.ruleRetreat && isEdge(game, ship) && ship.faction === game.playerFaction) {
    // optional disengage cue — not auto
  }
  game.mode = ship.fired ? 'select' : 'fire';
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

export function fireAt(game, targetShipId, weaponId) {
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
  let dmg = weapon.damage + (ship.overload ? 1 : 0);
  let absorbed = Math.min(target.shields, dmg);
  target.shields -= absorbed;
  dmg -= absorbed;
  if (dmg > 0) {
    target.hull -= dmg;
    log(
      game,
      `${ship.name} hits ${target.name} with ${weapon.name} for ${absorbed} shield / ${dmg} hull.`,
      'alert'
    );
  } else {
    log(game, `${ship.name}'s ${weapon.name} splash against ${target.name}'s shields.`, '');
  }
  if (target.hull <= 0) {
    target.alive = false;
    target.hull = 0;
    log(game, `${target.name} destroyed!`, 'bad');
  }
  ship.fired = true;
  game.mode = 'select';
  checkVictory(game);
  if (!game.winner && ship.moveLeft <= 0) {
    ship.activated = true;
    game.selectedId = null;
    afterActivation(game);
  }
  return true;
}

export function holdOrders(game) {
  const ship = game.ships.find((s) => s.id === game.selectedId);
  const actor = currentActor(game);
  if (!ship || !actor || actor.id !== ship.id) return false;
  if (ship.faction !== game.playerFaction) return false;
  ship.moveLeft = 0;
  ship.fired = true;
  ship.activated = true;
  log(game, `${ship.name} holds position.`, '');
  game.selectedId = null;
  game.mode = 'select';
  afterActivation(game);
  return true;
}

export function endActivation(game) {
  const ship = game.ships.find((s) => s.id === game.selectedId) || currentActor(game);
  if (!ship) return;
  if (ship.faction !== game.playerFaction) return;
  ship.activated = true;
  ship.moveLeft = 0;
  game.selectedId = null;
  game.mode = 'select';
  afterActivation(game);
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

function runAiActivation(game, ship) {
  // Simple AI: move closer to nearest enemy, then fire best weapon
  const enemies = living(game, game.playerFaction);
  if (!enemies.length) {
    ship.activated = true;
    afterActivation(game);
    return;
  }
  enemies.sort(
    (a, b) => hexApproxDist(ship, a) - hexApproxDist(ship, b)
  );
  const prey = enemies[0];
  const moves = legalMovesFor(game, ship);
  if (moves.length) {
    moves.sort(
      (a, b) =>
        hexApproxDist({ col: a.col, row: a.row }, prey) -
        hexApproxDist({ col: b.col, row: b.row }, prey)
    );
    const best = moves[0];
    ship.facing = facingToward(ship, best);
    const cost = best.dist * game.map.moveCost;
    ship.col = best.col;
    ship.row = best.row;
    ship.moveLeft = Math.max(0, ship.moveLeft - cost);
    log(game, `${ship.name} closes to ${best.col},${best.row}.`, '');
  }
  const def = shipDef(ship);
  const weapon = [...def.weapons].sort((a, b) => b.damage - a.damage)[0];
  const targets = fireTargetsFor(game, ship, weapon);
  if (targets.length) {
    const t = game.ships.find((s) => s.id === targets[0].shipId);
    game.selectedId = ship.id;
    // temporarily allow fire path
    let dmg = weapon.damage;
    let absorbed = Math.min(t.shields, dmg);
    t.shields -= absorbed;
    dmg -= absorbed;
    if (dmg > 0) t.hull -= dmg;
    log(
      game,
      `${ship.name} fires ${weapon.name} at ${t.name} (${absorbed} sh / ${Math.max(0, dmg)} hu).`,
      'alert'
    );
    if (t.hull <= 0) {
      t.alive = false;
      t.hull = 0;
      log(game, `${t.name} destroyed!`, 'bad');
    }
    ship.fired = true;
  }
  ship.activated = true;
  ship.moveLeft = 0;
  game.selectedId = null;
  checkVictory(game);
  if (!game.winner) {
    const next = currentActor(game);
    if (!next) {
      game.round += 1;
      beginRound(game);
      const n2 = currentActor(game);
      if (n2 && n2.faction !== game.playerFaction) runAiActivation(game, n2);
    } else if (next.faction !== game.playerFaction) {
      runAiActivation(game, next);
    }
  }
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
  if (selected) {
    const actor = currentActor(game);
    const controllable =
      actor && actor.id === selected.id && selected.faction === game.playerFaction;
    if (controllable && (game.mode === 'move' || game.mode === 'select')) {
      legalMoves = legalMovesFor(game, selected);
    }
    if (controllable && (game.mode === 'fire' || game.mode === 'select') && weapon) {
      fireTargets = fireTargetsFor(game, selected, weapon);
    }
  }

  return {
    cols: game.cols,
    rows: game.rows,
    blockedSet: game.blockedSet,
    ships: game.ships,
    selectedId: game.selectedId,
    legalMoves,
    fireTargets,
    showArcsWeapon: selected && weapon ? weapon : null,
    factions: FACTIONS,
  };
}

export function attachBoardController(canvas, getGame, onChange) {
  const paint = () => {
    const game = getGame();
    if (!game) return;
    const ctx = resizeCanvas(canvas);
    drawBoard(ctx, getBoardView(game));
  };

  const onPointer = (evt) => {
    const game = getGame();
    if (!game || game.winner) return;
    if (evt.preventDefault) evt.preventDefault();
    resizeCanvas(canvas);
    fitTiles(canvas, game.cols, game.rows);
    const { x, y } = eventToLogic(canvas, evt);
    const origin = computeOrigin(canvas, game.cols, game.rows);
    const cell = screenToGrid(x, y, origin.originX, origin.originY, game.cols, game.rows);
    if (!cell) return;

    const shipHere = game.ships.find(
      (s) => s.alive && s.col === cell.col && s.row === cell.row
    );
    const view = getBoardView(game);

    const ft = view.fireTargets.find((t) => t.col === cell.col && t.row === cell.row);
    if (ft) {
      const selected = game.ships.find((s) => s.id === game.selectedId);
      if (selected) {
        const weapon =
          shipDef(selected).weapons.find((w) => w.id === game.activeWeaponId) ||
          shipDef(selected).weapons[0];
        fireAt(game, ft.shipId, weapon.id);
        const actor = currentActor(game);
        if (actor && actor.faction === game.playerFaction) {
          selectShip(game, actor.id);
          game.activeWeaponId = shipDef(actor).weapons[0].id;
          game.mode = 'move';
        }
        onChange();
        return;
      }
    }

    if (view.legalMoves.some((m) => m.col === cell.col && m.row === cell.row)) {
      moveShip(game, cell.col, cell.row);
      onChange();
      return;
    }

    if (shipHere) {
      selectShip(game, shipHere.id);
      game.activeWeaponId = shipDef(shipHere).weapons[0].id;
      onChange();
    }
  };

  canvas.addEventListener('click', onPointer);
  canvas.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      e.preventDefault();
      onPointer(t);
    },
    { passive: false }
  );

  window.addEventListener('resize', paint);

  return { paint, refresh: paint };
}

export { ARC_LABELS, FACTIONS, shipDef as getShipDef };
