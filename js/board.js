/**
 * Isometric diamond grid (offset axial-ish).
 * Cell (c,r) draws as a diamond; neighbors are orthogonal + diagonal for SFB-feel movement.
 */

const TILE_W = 72;
const TILE_H = 36;

export function tileSize() {
  return { w: TILE_W, h: TILE_H };
}

export function gridToScreen(col, row, originX, originY) {
  const x = originX + (col - row) * (TILE_W / 2);
  const y = originY + (col + row) * (TILE_H / 2);
  return { x, y };
}

export function screenToGrid(px, py, originX, originY, cols, rows) {
  const dx = px - originX;
  const dy = py - originY;
  const col = Math.round(dx / TILE_W + dy / TILE_H);
  const row = Math.round(dy / TILE_H - dx / TILE_W);
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  return { col, row };
}

export function neighbors(col, row, cols, rows) {
  const deltas = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, -1], [-1, 1],
  ];
  const out = [];
  for (const [dc, dr] of deltas) {
    const c = col + dc;
    const r = row + dr;
    if (c >= 0 && r >= 0 && c < cols && r < rows) out.push({ col: c, row: r });
  }
  return out;
}

export function key(col, row) {
  return `${col},${row}`;
}

/** Hex-style facing 0..5 toward a neighbor cell */
export function facingToward(from, to) {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  // Map 6-dir deltas to facing
  const table = {
    '1,0': 1,
    '1,-1': 0,
    '0,-1': 5,
    '-1,0': 4,
    '-1,1': 3,
    '0,1': 2,
  };
  return table[`${dc},${dr}`] ?? 0;
}

export function facingDelta(fromFacing, toFacing) {
  return ((toFacing - fromFacing) % 6 + 6) % 6;
}

/** Relative arc of target cell from ship facing */
export function relativeArc(ship, targetCell) {
  const abs = facingToward(
    { col: ship.col, row: ship.row },
    targetCell
  );
  return facingDelta(ship.facing, abs);
}

export function computeOrigin(canvas, cols, rows) {
  const w = canvas._logicW || canvas.width;
  const h = canvas._logicH || canvas.height;
  const gridH = (cols + rows) * (TILE_H / 2);
  const originX = w / 2;
  const originY = Math.max(48, (h - gridH) / 2 + TILE_H);
  return { originX, originY, gridW: (cols + rows) * (TILE_W / 2), gridH };
}

function drawDiamond(ctx, x, y, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x, y - TILE_H / 2);
  ctx.lineTo(x + TILE_W / 2, y);
  ctx.lineTo(x, y + TILE_H / 2);
  ctx.lineTo(x - TILE_W / 2, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function shipPath(ctx, x, y, facing, scale = 1) {
  // Triangle pointing by facing around isometric-ish directions
  const angles = [-90, -30, 30, 90, 150, -150].map((d) => (d * Math.PI) / 180);
  const a = angles[facing % 6];
  const len = 16 * scale;
  const wing = 10 * scale;
  const tipX = x + Math.cos(a) * len;
  const tipY = y + Math.sin(a) * len;
  const leftX = x + Math.cos(a + 2.4) * wing;
  const leftY = y + Math.sin(a + 2.4) * wing;
  const rightX = x + Math.cos(a - 2.4) * wing;
  const rightY = y + Math.sin(a - 2.4) * wing;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
}

/** Draw wedge arcs on board for selected ship's active weapon arcs */
export function drawFiringArcs(ctx, ship, weapon, originX, originY, cols, rows, blockedSet) {
  if (!ship || !weapon) return;
  const arcs = new Set(weapon.arcs);
  const range = weapon.range;

  // BFS limited by range for cells in allowed relative arcs
  const seen = new Set([key(ship.col, ship.row)]);
  let frontier = [{ col: ship.col, row: ship.row, dist: 0 }];

  while (frontier.length) {
    const cur = frontier.shift();
    if (cur.dist >= range) continue;
    for (const n of neighbors(cur.col, cur.row, cols, rows)) {
      const k = key(n.col, n.row);
      if (seen.has(k) || blockedSet.has(k)) continue;
      const arc = relativeArc(ship, n);
      if (!arcs.has(arc)) continue;
      seen.add(k);
      frontier.push({ ...n, dist: cur.dist + 1 });
      const { x, y } = gridToScreen(n.col, n.row, originX, originY);
      drawDiamond(ctx, x, y, 'rgba(220, 110, 60, 0.28)', 'rgba(240, 150, 90, 0.55)');
    }
  }
}

export function drawBoard(ctx, state) {
  const {
    cols,
    rows,
    blockedSet,
    ships,
    selectedId,
    legalMoves,
    fireTargets,
    showArcsWeapon,
    factions,
  } = state;

  const { originX, originY } = computeOrigin(ctx.canvas, cols, rows);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 60; i++) {
    const sx = (i * 97) % ctx.canvas.width;
    const sy = (i * 53) % ctx.canvas.height;
    ctx.fillRect(sx, sy, 1, 1);
  }

  const moveSet = new Set(legalMoves.map((m) => key(m.col, m.row)));
  const fireSet = new Set(fireTargets.map((m) => key(m.col, m.row)));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { x, y } = gridToScreen(c, r, originX, originY);
      const k = key(c, r);
      const blocked = blockedSet.has(k);
      let fill = blocked ? 'rgba(40, 28, 22, 0.75)' : 'rgba(40, 90, 120, 0.22)';
      let stroke = blocked ? 'rgba(120, 80, 50, 0.45)' : 'rgba(120, 180, 210, 0.28)';
      if (moveSet.has(k)) {
        fill = 'rgba(70, 190, 210, 0.42)';
        stroke = 'rgba(140, 230, 250, 0.9)';
      }
      if (fireSet.has(k)) {
        fill = 'rgba(210, 80, 50, 0.4)';
        stroke = 'rgba(255, 140, 90, 0.95)';
      }
      drawDiamond(ctx, x, y, fill, stroke);
    }
  }

  const selected = ships.find((s) => s.id === selectedId && s.alive);
  if (selected && showArcsWeapon) {
    drawFiringArcs(ctx, selected, showArcsWeapon, originX, originY, cols, rows, blockedSet);
  }

  // Ships sorted back-to-front
  const ordered = [...ships].filter((s) => s.alive).sort((a, b) => (a.col + a.row) - (b.col + b.row));
  for (const ship of ordered) {
    const { x, y } = gridToScreen(ship.col, ship.row, originX, originY);
    const fac = factions[ship.faction];
    const selectedShip = ship.id === selectedId;

    if (selectedShip) {
      drawDiamond(ctx, x, y, 'rgba(255, 220, 120, 0.25)', 'rgba(255, 220, 120, 0.9)');
    }

    ctx.save();
    shipPath(ctx, x, y - 2, ship.facing, ship.typeId === 'ca' || ship.typeId === 'd7' ? 1.15 : 1);
    ctx.fillStyle = fac.color;
    ctx.strokeStyle = fac.accent;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    // Hull pip
    const ratio = ship.hull / ship.hullMax;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x - 14, y + 12, 28, 4);
    ctx.fillStyle = ratio > 0.4 ? '#5dce9a' : '#e2b84a';
    if (ratio <= 0.25) ctx.fillStyle = '#e35d5d';
    ctx.fillRect(x - 14, y + 12, 28 * ratio, 4);

    ctx.restore();
  }

  return { originX, originY };
}

export function resizeCanvas(canvas) {
  const parent = canvas.parentElement;
  const w = Math.max(320, parent.clientWidth);
  const h = Math.max(360, parent.clientHeight || Math.floor(window.innerHeight * 0.55));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Logical size for hit-testing
  canvas._logicW = w;
  canvas._logicH = h;
  return ctx;
}

export function eventToLogic(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  const clientX = evt.clientX ?? evt.touches?.[0]?.clientX;
  const clientY = evt.clientY ?? evt.touches?.[0]?.clientY;
  const x = ((clientX - rect.left) / rect.width) * (canvas._logicW || rect.width);
  const y = ((clientY - rect.top) / rect.height) * (canvas._logicH || rect.height);
  return { x, y };
}
