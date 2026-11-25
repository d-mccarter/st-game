/**
 * Isometric diamond grid. Tile size scales to fill the canvas.
 */

import { shipImage } from './ships.js';

let TILE_W = 72;
let TILE_H = 36;

export function tileSize() {
  return { w: TILE_W, h: TILE_H };
}

export function fitTiles(canvas, cols, rows) {
  const w = canvas._logicW || canvas.width;
  const h = canvas._logicH || canvas.height;
  // Grid extents in tile units (diamond projection)
  const unitsX = cols + rows;
  const unitsY = cols + rows;
  const pad = 24;
  const maxW = Math.max(40, (w - pad * 2) / (unitsX / 2));
  const maxH = Math.max(20, (h - pad * 2) / (unitsY / 2));
  // Keep 2:1 diamond aspect
  TILE_W = Math.min(88, Math.floor(Math.min(maxW, maxH * 2)));
  TILE_H = Math.floor(TILE_W / 2);
  return tileSize();
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

export function facingToward(from, to) {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
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

export function relativeArc(ship, targetCell) {
  const abs = facingToward({ col: ship.col, row: ship.row }, targetCell);
  return facingDelta(ship.facing, abs);
}

export function computeOrigin(canvas, cols, rows) {
  const w = canvas._logicW || canvas.width;
  const h = canvas._logicH || canvas.height;
  const gridH = (cols + rows) * (TILE_H / 2);
  const originX = w / 2;
  const originY = (h - gridH) / 2 + TILE_H / 2;
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

/** Sprite art faces "up" (north). Facing 0..5 maps to board directions. */
const FACING_RAD = [-Math.PI / 2, -Math.PI / 6, Math.PI / 6, Math.PI / 2, (5 * Math.PI) / 6, (-5 * Math.PI) / 6];

function drawShipSprite(ctx, ship, x, y, selected) {
  const img = shipImage(ship.typeId);
  const heavy = ship.typeId === 'ca' || ship.typeId === 'd7';
  const size = TILE_W * (heavy ? 1.15 : 0.95);

  if (img) {
    ctx.save();
    ctx.translate(x, y - TILE_H * 0.08);
    ctx.rotate(FACING_RAD[ship.facing % 6] - FACING_RAD[0]); // art faces up = facing 0
    if (selected) {
      ctx.shadowColor = 'rgba(255, 220, 120, 0.85)';
      ctx.shadowBlur = 14;
    }
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
    return;
  }

  // Fallback triangle if sprite missing
  const a = FACING_RAD[ship.facing % 6];
  const s = size / 72;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a) * 16 * s, y + Math.sin(a) * 16 * s);
  ctx.lineTo(x + Math.cos(a + 2.4) * 10 * s, y + Math.sin(a + 2.4) * 10 * s);
  ctx.lineTo(x + Math.cos(a - 2.4) * 10 * s, y + Math.sin(a - 2.4) * 10 * s);
  ctx.closePath();
}

export function drawFiringArcs(ctx, ship, weapon, originX, originY, cols, rows, blockedSet) {
  if (!ship || !weapon) return;
  const arcs = new Set(weapon.arcs);
  const range = weapon.range;
  const seen = new Set([key(ship.col, ship.row)]);
  const frontier = [{ col: ship.col, row: ship.row, dist: 0 }];

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

  const canvas = ctx.canvas;
  fitTiles(canvas, cols, rows);
  const { originX, originY } = computeOrigin(canvas, cols, rows);
  const lw = canvas._logicW || canvas.width;
  const lh = canvas._logicH || canvas.height;
  ctx.clearRect(0, 0, lw, lh);

  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 60; i++) {
    ctx.fillRect((i * 97) % lw, (i * 53) % lh, 1, 1);
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

  const ordered = [...ships].filter((s) => s.alive).sort((a, b) => a.col + a.row - (b.col + b.row));
  const pip = Math.max(10, TILE_W * 0.35);
  for (const ship of ordered) {
    const { x, y } = gridToScreen(ship.col, ship.row, originX, originY);
    const fac = factions[ship.faction];
    const selectedShip = ship.id === selectedId;

    if (selectedShip) {
      drawDiamond(ctx, x, y, 'rgba(255, 220, 120, 0.2)', 'rgba(255, 220, 120, 0.85)');
    }

    // Soft faction glow under the sprite
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y + 2, TILE_W * 0.28, TILE_H * 0.28, 0, 0, Math.PI * 2);
    ctx.fillStyle = fac.color + '55';
    ctx.fill();
    ctx.restore();

    drawShipSprite(ctx, ship, x, y, selectedShip);

    const ratio = ship.hull / ship.hullMax;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - pip / 2, y + TILE_H * 0.42, pip, 4);
    ctx.fillStyle = ratio > 0.4 ? '#5dce9a' : '#e2b84a';
    if (ratio <= 0.25) ctx.fillStyle = '#e35d5d';
    ctx.fillRect(x - pip / 2, y + TILE_H * 0.42, pip * ratio, 4);
  }

  return { originX, originY };
}

export function resizeCanvas(canvas) {
  const parent = canvas.parentElement;
  const w = Math.max(280, parent.clientWidth);
  const h = Math.max(280, parent.clientHeight || Math.floor(window.innerHeight * 0.55));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
