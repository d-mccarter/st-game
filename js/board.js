/**
 * Flat-top hex grid (odd-q offset) for Starfleet Battles–style play.
 */

import { shipImage } from './ships.js';

/** Hex size = center → vertex distance */
let HEX = 36;

export function tileSize() {
  return { w: HEX * 2, h: HEX * Math.sqrt(3), hex: HEX };
}

export function fitTiles(canvas, cols, rows) {
  const w = canvas._logicW || canvas.width;
  const h = canvas._logicH || canvas.height;
  const pad = Math.max(10, Math.min(w, h) * 0.03);
  // Flat-top odd-q: width ≈ cols * 1.5*size + 0.5*size, height ≈ rows * sqrt(3)*size + 0.5*sqrt(3)*size
  const maxByW = (w - pad * 2) / (cols * 1.5 + 0.5);
  const maxByH = (h - pad * 2) / ((rows + 0.5) * Math.sqrt(3));
  HEX = Math.max(18, Math.floor(Math.min(maxByW, maxByH)));
  return tileSize();
}

/** Flat-top odd-q → screen */
export function gridToScreen(col, row, originX, originY) {
  const x = originX + HEX * (1.5 * col);
  const y = originY + HEX * Math.sqrt(3) * (row + 0.5 * (col & 1));
  return { x, y };
}

export function screenToGrid(px, py, originX, originY, cols, rows) {
  // Inverse flat-top → fractional axial, then cube-round → odd-q
  const x = (px - originX) / HEX;
  const y = (py - originY) / HEX;
  const q = (2 / 3) * x;
  const r = (-1 / 3) * x + (Math.sqrt(3) / 3) * y;
  const cube = axialToCube(q, r);
  const rounded = cubeRound(cube.x, cube.y, cube.z);
  const oddq = cubeToOddQ(rounded.x, rounded.y, rounded.z);
  if (oddq.col < 0 || oddq.row < 0 || oddq.col >= cols || oddq.row >= rows) return null;
  return oddq;
}

function axialToCube(q, r) {
  const x = q;
  const z = r;
  const y = -x - z;
  return { x, y, z };
}

function cubeRound(x, y, z) {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

function cubeToOddQ(x, _y, z) {
  const col = x;
  const row = z + (x - (x & 1)) / 2;
  return { col, row };
}

function oddQToCube(col, row) {
  const x = col;
  const z = row - (col - (col & 1)) / 2;
  const y = -x - z;
  return { x, y, z };
}

/** 6 neighbors for odd-q flat-top */
export function neighbors(col, row, cols, rows) {
  const deltas = [
    [
      [+1, 0], [+1, -1], [0, -1],
      [-1, -1], [-1, 0], [0, +1],
    ],
    [
      [+1, +1], [+1, 0], [0, -1],
      [-1, 0], [-1, +1], [0, +1],
    ],
  ];
  const parity = col & 1;
  const out = [];
  for (const [dc, dr] of deltas[parity]) {
    const c = col + dc;
    const r = row + dr;
    if (c >= 0 && r >= 0 && c < cols && r < rows) out.push({ col: c, row: r });
  }
  return out;
}

export function key(col, row) {
  return `${col},${row}`;
}

/** Facing 0..5 around flat-top hex (0 = E, then counter-clockwise: NE, NW, W, SW, SE) */
const CUBE_DIRS = [
  { x: +1, y: -1, z: 0 }, // E
  { x: +1, y: 0, z: -1 }, // NE
  { x: 0, y: +1, z: -1 }, // NW
  { x: -1, y: +1, z: 0 }, // W
  { x: -1, y: 0, z: +1 }, // SW
  { x: 0, y: -1, z: +1 }, // SE
];

export function facingToward(from, to) {
  const a = oddQToCube(from.col, from.row);
  const b = oddQToCube(to.col, to.row);
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < 6; i++) {
    const d = CUBE_DIRS[i];
    const score = d.x * (b.x - a.x) + d.y * (b.y - a.y) + d.z * (b.z - a.z);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
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
  const gridW = HEX * (cols * 1.5 + 0.5);
  const gridH = HEX * Math.sqrt(3) * (rows + 0.5);
  const originX = (w - gridW) / 2 + HEX;
  const originY = (h - gridH) / 2 + HEX * Math.sqrt(3) / 2;
  return { originX, originY, gridW, gridH };
}

function drawHex(ctx, x, y, fill, stroke) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i); // flat-top: point at 0°
    const px = x + HEX * Math.cos(angle);
    const py = y + HEX * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }
}

/** Screen angles for facing chevron (flat-top: 0=E …) */
const FACING_RAD = [0, -Math.PI / 3, (-2 * Math.PI) / 3, Math.PI, (2 * Math.PI) / 3, Math.PI / 3];

function drawShipSprite(ctx, ship, x, y, selected, factionColor) {
  const img = shipImage(ship.typeId);
  const heavy = ship.typeId === 'ca' || ship.typeId === 'd7';
  // Keep minis clearly smaller than a hex
  const size = HEX * (heavy ? 1.15 : 1.0);
  const facing = ship.facing % 6;
  const mirror = facing === 2 || facing === 3 || facing === 4;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y + HEX * 0.28, HEX * 0.28, HEX * 0.14, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();
  ctx.restore();

  if (img) {
    ctx.save();
    ctx.translate(x, y - size * 0.08);
    if (mirror) ctx.scale(-1, 1);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    const a = FACING_RAD[facing];
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * size * 0.4, y + Math.sin(a) * size * 0.4);
    ctx.lineTo(x + Math.cos(a + 2.4) * size * 0.25, y + Math.sin(a + 2.4) * size * 0.25);
    ctx.lineTo(x + Math.cos(a - 2.4) * size * 0.25, y + Math.sin(a - 2.4) * size * 0.25);
    ctx.closePath();
    ctx.fillStyle = factionColor;
    ctx.fill();
  }

  const a = FACING_RAD[facing];
  const bx = x + Math.cos(a) * HEX * 0.42;
  const by = y + Math.sin(a) * HEX * 0.42;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-3.5, 3);
  ctx.lineTo(-3.5, -3);
  ctx.closePath();
  ctx.fillStyle = selected ? '#ffe08a' : '#e8f2f7';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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
      drawHex(ctx, x, y, 'rgba(220, 110, 60, 0.28)', 'rgba(240, 150, 90, 0.55)');
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
      let fill = blocked ? 'rgba(40, 28, 22, 0.75)' : 'rgba(40, 90, 120, 0.2)';
      let stroke = blocked ? 'rgba(120, 80, 50, 0.45)' : 'rgba(120, 180, 210, 0.35)';
      if (moveSet.has(k)) {
        fill = 'rgba(70, 190, 210, 0.42)';
        stroke = 'rgba(140, 230, 250, 0.95)';
      }
      if (fireSet.has(k)) {
        fill = 'rgba(210, 80, 50, 0.4)';
        stroke = 'rgba(255, 140, 90, 0.95)';
      }
      drawHex(ctx, x, y, fill, stroke);
    }
  }

  const selected = ships.find((s) => s.id === selectedId && s.alive);
  if (selected && showArcsWeapon) {
    drawFiringArcs(ctx, selected, showArcsWeapon, originX, originY, cols, rows, blockedSet);
  }

  const ordered = [...ships]
    .filter((s) => s.alive)
    .sort((a, b) => a.row - b.row || a.col - b.col);
  const pip = Math.max(8, HEX * 0.45);
  for (const ship of ordered) {
    const { x, y } = gridToScreen(ship.col, ship.row, originX, originY);
    const fac = factions[ship.faction];
    const selectedShip = ship.id === selectedId;

    if (selectedShip) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y + HEX * 0.3, HEX * 0.4, HEX * 0.18, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 214, 120, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.restore();
    }

    drawShipSprite(ctx, ship, x, y, selectedShip, fac.color);

    const ratio = ship.hull / ship.hullMax;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - pip / 2, y + HEX * 0.48, pip, 3);
    ctx.fillStyle = ratio > 0.4 ? '#5dce9a' : '#e2b84a';
    if (ratio <= 0.25) ctx.fillStyle = '#e35d5d';
    ctx.fillRect(x - pip / 2, y + HEX * 0.48, pip * ratio, 3);
  }

  return { originX, originY };
}

export function resizeCanvas(canvas) {
  const parent = canvas.parentElement;
  const rect = parent.getBoundingClientRect();
  const w = Math.max(200, Math.floor(rect.width) || parent.clientWidth || 200);
  const h = Math.max(200, Math.floor(rect.height) || parent.clientHeight || 200);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  canvas.style.width = '100%';
  canvas.style.height = '100%';
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
