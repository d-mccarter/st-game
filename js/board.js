/**
 * Hex grid (flat-top odd-q) drawn in isometric projection, with zoom/pan.
 */

import { shipImage } from './ships.js';

/** Base hex radius in world units (before iso + zoom) */
let HEX = 40;

/** Isometric projection scales (2:1 diamond feel) */
const ISO_X = 0.8660254; // cos(30°)
const ISO_Y = 0.5;      // sin(30°)

export function createCamera() {
  return { zoom: 1, panX: 0, panY: 0 };
}

export function tileSize() {
  return { hex: HEX };
}

export function fitTiles(canvas, cols, rows, _camera = { zoom: 1 }) {
  const w = canvas._logicW || canvas.width;
  const h = canvas._logicH || canvas.height;
  const pad = Math.max(8, Math.min(w, h) * 0.02);
  // Unit extents (HEX = 1), then choose HEX so zoom=1 fills the view
  const flatW = cols * 1.5 + 0.5;
  const flatH = Math.sqrt(3) * (rows + 0.5);
  const isoW = (flatW + flatH) * ISO_X;
  const isoH = (flatW + flatH) * ISO_Y;
  const maxByW = (w - pad * 2) / Math.max(1, isoW);
  const maxByH = (h - pad * 2) / Math.max(1, isoH);
  HEX = Math.max(14, Math.min(64, Math.floor(Math.min(maxByW, maxByH))));
  return tileSize();
}

function flatCenter(col, row) {
  return {
    wx: HEX * (1.5 * col),
    wy: HEX * Math.sqrt(3) * (row + 0.5 * (col & 1)),
  };
}

function isoProject(wx, wy) {
  return {
    ix: (wx - wy) * ISO_X,
    iy: (wx + wy) * ISO_Y,
  };
}

function isoUnproject(ix, iy) {
  // Inverse of ix=(wx-wy)*ISO_X, iy=(wx+wy)*ISO_Y
  const wx = (ix / ISO_X + iy / ISO_Y) / 2;
  const wy = (iy / ISO_Y - ix / ISO_X) / 2;
  return { wx, wy };
}

export function computeOrigin(canvas, cols, rows) {
  const w = canvas._logicW || canvas.width;
  const h = canvas._logicH || canvas.height;
  // Center of iso-projected grid at pan 0
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [c, r] of [
    [0, 0],
    [cols - 1, 0],
    [0, rows - 1],
    [cols - 1, rows - 1],
    [Math.floor(cols / 2), Math.floor(rows / 2)],
  ]) {
    const { wx, wy } = flatCenter(c, r);
    const { ix, iy } = isoProject(wx, wy);
    minX = Math.min(minX, ix);
    maxX = Math.max(maxX, ix);
    minY = Math.min(minY, iy);
    maxY = Math.max(maxY, iy);
  }
  // Also include hex vertex extents roughly (+HEX)
  const pad = HEX * 1.1;
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return {
    originX: w / 2 - midX,
    originY: h / 2 - midY,
    midX,
    midY,
  };
}

/** Grid → screen pixels (with camera) */
export function gridToScreen(col, row, originX, originY, camera = { zoom: 1, panX: 0, panY: 0 }) {
  const { wx, wy } = flatCenter(col, row);
  const { ix, iy } = isoProject(wx, wy);
  return {
    x: originX + (ix + camera.panX) * camera.zoom,
    y: originY + (iy + camera.panY) * camera.zoom,
  };
}

/** Screen → grid (with camera) */
export function screenToGrid(
  px,
  py,
  originX,
  originY,
  cols,
  rows,
  camera = { zoom: 1, panX: 0, panY: 0 }
) {
  const ix = (px - originX) / camera.zoom - camera.panX;
  const iy = (py - originY) / camera.zoom - camera.panY;
  const { wx, wy } = isoUnproject(ix, iy);
  // Flat-top inverse → axial → odd-q
  const q = (2 / 3) * (wx / HEX);
  const r = (-1 / 3) * (wx / HEX) + (Math.sqrt(3) / 3) * (wy / HEX);
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

const CUBE_DIRS = [
  { x: +1, y: -1, z: 0 },
  { x: +1, y: 0, z: -1 },
  { x: 0, y: +1, z: -1 },
  { x: -1, y: +1, z: 0 },
  { x: -1, y: 0, z: +1 },
  { x: 0, y: -1, z: +1 },
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
  return facingDelta(ship.facing, facingToward(ship, targetCell));
}

/** Flat-top hex vertices in world space, then iso-projected to screen */
function hexScreenVerts(col, row, originX, originY, camera) {
  const { wx, wy } = flatCenter(col, row);
  const verts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    const vx = wx + HEX * Math.cos(angle);
    const vy = wy + HEX * Math.sin(angle);
    const { ix, iy } = isoProject(vx, vy);
    verts.push({
      x: originX + (ix + camera.panX) * camera.zoom,
      y: originY + (iy + camera.panY) * camera.zoom,
    });
  }
  return verts;
}

function drawHexIso(ctx, col, row, originX, originY, camera, fill, stroke) {
  const verts = hexScreenVerts(col, row, originX, originY, camera);
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, 1.1 * camera.zoom);
    ctx.stroke();
  }
}

/** Screen angles for facings E, NE, NW, W, SW, SE (canvas Y-down). */
const FACING_RAD = [0, -Math.PI / 3, (-2 * Math.PI) / 3, Math.PI, (2 * Math.PI) / 3, Math.PI / 3];
/** All ship PNGs are drawn with the bow toward bottom-left ≈ SW. */
const ART_NOSE_RAD = FACING_RAD[4];

function drawShipSprite(ctx, ship, x, y, selected, factionColor, camera) {
  const img = shipImage(ship.typeId);
  const heavy = ship.typeId === 'ca' || ship.typeId === 'd7';
  const size = HEX * camera.zoom * (heavy ? 1.05 : 0.9);
  const facing = ((ship.facing % 6) + 6) % 6;
  const heading = FACING_RAD[facing];

  // Fixed ground shadow under the stand (does not spin with the hull)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.22, size * 0.28, size * 0.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();
  ctx.restore();

  if (img) {
    ctx.save();
    ctx.translate(x, y - size * 0.04);
    // Rotate so the painted bow matches the detail-panel facing
    ctx.rotate(heading - ART_NOSE_RAD);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(heading) * size * 0.4, y + Math.sin(heading) * size * 0.4);
    ctx.lineTo(
      x + Math.cos(heading + 2.4) * size * 0.25,
      y + Math.sin(heading + 2.4) * size * 0.25
    );
    ctx.lineTo(
      x + Math.cos(heading - 2.4) * size * 0.25,
      y + Math.sin(heading - 2.4) * size * 0.25
    );
    ctx.closePath();
    ctx.fillStyle = factionColor;
    ctx.fill();
  }

  // Facing chevron — same heading as the detail window
  const bx = x + Math.cos(heading) * size * 0.42;
  const by = y + Math.sin(heading) * size * 0.42;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(heading);
  const s = Math.max(0.7, camera.zoom);
  ctx.beginPath();
  ctx.moveTo(5 * s, 0);
  ctx.lineTo(-3.5 * s, 3 * s);
  ctx.lineTo(-3.5 * s, -3 * s);
  ctx.closePath();
  ctx.fillStyle = selected ? '#ffe08a' : '#e8f2f7';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawFiringArcs(ctx, ship, weapon, originX, originY, cols, rows, blockedSet, camera) {
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
      if (!arcs.has(relativeArc(ship, n))) continue;
      seen.add(k);
      frontier.push({ ...n, dist: cur.dist + 1 });
      drawHexIso(
        ctx,
        n.col,
        n.row,
        originX,
        originY,
        camera,
        'rgba(220, 110, 60, 0.28)',
        'rgba(240, 150, 90, 0.55)'
      );
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
    camera = { zoom: 1, panX: 0, panY: 0 },
  } = state;

  const canvas = ctx.canvas;
  fitTiles(canvas, cols, rows, camera);
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

  // Draw back-to-front for iso depth
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push({ c, r });
  }
  cells.sort((a, b) => {
    const sa = flatCenter(a.c, a.r);
    const sb = flatCenter(b.c, b.r);
    return sa.wx + sa.wy - (sb.wx + sb.wy);
  });

  for (const { c, r } of cells) {
    const k = key(c, r);
    const blocked = blockedSet.has(k);
    let fill = blocked ? 'rgba(40, 28, 22, 0.78)' : 'rgba(40, 90, 120, 0.28)';
    let stroke = blocked ? 'rgba(120, 80, 50, 0.5)' : 'rgba(140, 200, 220, 0.4)';
    if (moveSet.has(k)) {
      fill = 'rgba(70, 190, 210, 0.45)';
      stroke = 'rgba(140, 230, 250, 0.95)';
    }
    if (fireSet.has(k)) {
      fill = 'rgba(210, 80, 50, 0.42)';
      stroke = 'rgba(255, 140, 90, 0.95)';
    }
    drawHexIso(ctx, c, r, originX, originY, camera, fill, stroke);
  }

  const selected = ships.find((s) => s.id === selectedId && s.alive);
  if (selected && showArcsWeapon) {
    drawFiringArcs(
      ctx,
      selected,
      showArcsWeapon,
      originX,
      originY,
      cols,
      rows,
      blockedSet,
      camera
    );
  }

  const ordered = [...ships]
    .filter((s) => s.alive)
    .sort((a, b) => {
      const sa = flatCenter(a.col, a.row);
      const sb = flatCenter(b.col, b.row);
      return sa.wx + sa.wy - (sb.wx + sb.wy);
    });

  for (const ship of ordered) {
    const { x, y } = gridToScreen(ship.col, ship.row, originX, originY, camera);
    const fac = factions[ship.faction];
    const selectedShip = ship.id === selectedId;
    const pip = Math.max(8, HEX * camera.zoom * 0.4);

    if (selectedShip) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y + HEX * camera.zoom * 0.22, HEX * camera.zoom * 0.38, HEX * camera.zoom * 0.14, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 214, 120, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.restore();
    }

    drawShipSprite(ctx, ship, x, y, selectedShip, fac.color, camera);

    const ratio = ship.hull / ship.hullMax;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - pip / 2, y + HEX * camera.zoom * 0.4, pip, 3);
    ctx.fillStyle = ratio > 0.4 ? '#5dce9a' : '#e2b84a';
    if (ratio <= 0.25) ctx.fillStyle = '#e35d5d';
    ctx.fillRect(x - pip / 2, y + HEX * camera.zoom * 0.4, pip * ratio, 3);
  }

  return { originX, originY };
}

export function resizeCanvas(canvas) {
  const parent = canvas.parentElement;
  const rect = parent.getBoundingClientRect();
  const w = Math.max(200, Math.floor(rect.width) || parent.clientWidth || 200);
  const h = Math.max(200, Math.floor(rect.height) || parent.clientHeight || 200);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.floor(w * dpr);
  const bh = Math.floor(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
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

/** Zoom toward a screen point; mutates camera */
export function zoomAt(camera, screenX, screenY, originX, originY, factor) {
  const beforeX = (screenX - originX) / camera.zoom - camera.panX;
  const beforeY = (screenY - originY) / camera.zoom - camera.panY;
  camera.zoom = Math.min(3.2, Math.max(0.45, camera.zoom * factor));
  camera.panX = (screenX - originX) / camera.zoom - beforeX;
  camera.panY = (screenY - originY) / camera.zoom - beforeY;
}
