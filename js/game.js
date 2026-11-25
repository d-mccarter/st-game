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

function spawnLine(faction, fleetCounts, side, map) {
  const ships = [];
  // Stagger rows so large mini sprites don't stack on top of each other
  const baseRow = side === 'west' ? 1 : map.rows - 2;
  let col = 1;
  let slot = 0;
  // Flat-top hex facing: 0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE
  const facing = side === 'west' ? 0 : 3;
  for (const [typeId, count] of Object.entries(fleetCounts)) {
    const def = SHIP_TYPES[typeId];
    if (!def || def.faction !== faction) continue;
    for (let i = 0; i < count; i++) {
      const row = Math.min(
        map.rows - 1,
        Math.max(0, baseRow + (slot % 2 === 0 ? 0 : side === 'west' ? 1 : -1))
      );
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
      // Leave an empty hex between minis so stands don't overlap
      col += 2;
      slot += 1;
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
    camera: createCamera(),
    fx: createFx(),
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
  ship.facing = facingToward(from, { col, row });
  ship.col = col;
  ship.row = row;
  ship.moveLeft = Math.max(0, ship.moveLeft - cost);
  log(game, `${ship.name} moved to ${col},${row}.`, '');
  game.mode = ship.fired ? 'select' : 'fire';
  enqueueFx(game.fx, async () => {
    await startMoveTween(game.fx, ship, from);
    game._fxPulse?.();
  });
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

  enqueueFx(game.fx, async () => {
    await startFireTween(game.fx, ship, target, weapon, plan);
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
  if (fxBusy(game.fx)) return;
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

function runAiActivation(game, ship) {
  // Animate AI move + fire on the FX queue so player input stays locked
  enqueueFx(game.fx, async () => {
    const enemies = living(game, game.playerFaction);
    if (!enemies.length) {
      finishAiShip(game, ship);
      return;
    }
    enemies.sort((a, b) => hexApproxDist(ship, a) - hexApproxDist(ship, b));
    const prey = enemies[0];
    game.selectedId = ship.id;

    const moves = legalMovesFor(game, ship);
    if (moves.length) {
      moves.sort(
        (a, b) =>
          hexApproxDist({ col: a.col, row: a.row }, prey) -
          hexApproxDist({ col: b.col, row: b.row }, prey)
      );
      const best = moves[0];
      const from = { col: ship.col, row: ship.row };
      ship.facing = facingToward(ship, best);
      const cost = best.dist * game.map.moveCost;
      ship.col = best.col;
      ship.row = best.row;
      ship.moveLeft = Math.max(0, ship.moveLeft - cost);
      log(game, `${ship.name} closes to ${best.col},${best.row}.`, '');
      game._fxPulse?.();
      await startMoveTween(game.fx, ship, from);
    }

    const def = shipDef(ship);
    const weapon = [...def.weapons].sort((a, b) => b.damage - a.damage)[0];
    const targets = fireTargetsFor(game, ship, weapon);
    if (targets.length) {
      const t = game.ships.find((s) => s.id === targets[0].shipId && s.alive);
      if (t) {
        const plan = planShot(ship, t, weapon, 0);
        game._fxPulse?.();
        await startFireTween(game.fx, ship, t, weapon, plan);
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

        const ft = view.fireTargets.find((t) => t.col === cell.col && t.row === cell.row);
        if (ft) {
          const selected = game.ships.find((s) => s.id === game.selectedId);
          if (selected) {
            const weapon =
              shipDef(selected).weapons.find((w) => w.id === game.activeWeaponId) ||
              shipDef(selected).weapons[0];
            fireAt(game, ft.shipId, weapon.id);
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
