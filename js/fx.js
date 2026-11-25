/**
 * Board combat FX: move tweens, weapon beams, hits, float text.
 */

export function createFx() {
  return {
    moves: {}, // shipId -> { fromCol, fromRow, toCol, toRow, start, duration }
    beams: [],
    bursts: [],
    floats: [],
    queue: Promise.resolve(),
  };
}

export function fxBusy(fx) {
  if (!fx) return false;
  return (
    Object.keys(fx.moves).length > 0 ||
    fx.beams.length > 0 ||
    fx.bursts.some((b) => b.block) ||
    false
  );
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function enqueueFx(fx, task) {
  fx.queue = fx.queue.then(() => task()).catch(() => {});
  return fx.queue;
}

export function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Start a move tween; resolves when finished. Ship should already be at destination logically. */
export function startMoveTween(fx, ship, from, duration = 420) {
  return new Promise((resolve) => {
    const dist = Math.max(
      1,
      Math.abs(ship.col - from.col) + Math.abs(ship.row - from.row)
    );
    fx.moves[ship.id] = {
      fromCol: from.col,
      fromRow: from.row,
      toCol: ship.col,
      toRow: ship.row,
      start: performance.now(),
      duration: Math.min(900, duration * Math.sqrt(dist)),
      done: resolve,
    };
  });
}

export function weaponStyle(weaponId) {
  switch (weaponId) {
    case 'phaser':
      return { color: '#f0c45a', glow: '#ffe9a8', kind: 'beam', width: 2.4 };
    case 'photon':
      return { color: '#ff6b3d', glow: '#ffb08a', kind: 'bolt', width: 3.2 };
    case 'disruptor':
      return { color: '#6dff8a', glow: '#c8ffd4', kind: 'beam', width: 2.6 };
    case 'drone':
      return { color: '#6ec8ff', glow: '#c5eaff', kind: 'bolt', width: 2.8 };
    default:
      return { color: '#ffffff', glow: '#ffffff', kind: 'beam', width: 2.2 };
  }
}

/** Beam/bolt from shooter to target; resolves after impact FX begin. */
export function startFireTween(fx, fromShip, toShip, weapon, result) {
  return new Promise((resolve) => {
    const style = weaponStyle(weapon?.id);
    const duration = style.kind === 'bolt' ? 520 : 380;
    fx.beams.push({
      fromId: fromShip.id,
      toId: toShip.id,
      fromCol: fromShip.col,
      fromRow: fromShip.row,
      toCol: toShip.col,
      toRow: toShip.row,
      style,
      start: performance.now(),
      duration,
      result,
      resolved: false,
      done: resolve,
    });
  });
}

export function spawnHitBurst(fx, col, row, destroyed, shieldOnly) {
  fx.bursts.push({
    col,
    row,
    start: performance.now(),
    duration: destroyed ? 700 : 420,
    destroyed,
    shieldOnly,
    block: false,
  });
}

export function spawnFloatText(fx, col, row, text, kind) {
  fx.floats.push({
    col,
    row,
    text,
    kind,
    start: performance.now(),
    duration: 900,
  });
}

/**
 * Advance FX clocks. Call from the board RAF loop.
 * @returns {boolean} true if anything still animating
 */
export function tickFx(fx, now = performance.now()) {
  if (!fx) return false;

  for (const id of Object.keys(fx.moves)) {
    const m = fx.moves[id];
    const t = (now - m.start) / m.duration;
    if (t >= 1) {
      m.done?.();
      delete fx.moves[id];
    }
  }

  const nextBeams = [];
  for (const b of fx.beams) {
    const t = (now - b.start) / b.duration;
    if (!b.resolved && t >= 0.92) {
      b.resolved = true;
      const r = b.result || {};
      spawnHitBurst(fx, b.toCol, b.toRow, !!r.destroyed, !!r.shieldOnly);
      if (r.label) spawnFloatText(fx, b.toCol, b.toRow, r.label, r.kind || 'hit');
      b.done?.();
    }
    if (t < 1.05) nextBeams.push(b);
  }
  fx.beams = nextBeams;

  fx.bursts = fx.bursts.filter((b) => now - b.start < b.duration);
  fx.floats = fx.floats.filter((f) => now - f.start < f.duration);

  return fxBusy(fx) || fx.floats.length > 0 || fx.bursts.length > 0;
}

/** Visual grid position for a ship (may be mid-tween). */
export function shipDrawCell(ship, fx) {
  const m = fx?.moves?.[ship.id];
  if (!m) return { col: ship.col, row: ship.row, t: 1 };
  const raw = Math.min(1, Math.max(0, (performance.now() - m.start) / m.duration));
  const t = easeInOut(raw);
  return {
    col: m.fromCol + (m.toCol - m.fromCol) * t,
    row: m.fromRow + (m.toRow - m.fromRow) * t,
    t,
  };
}

export function lerpScreen(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
