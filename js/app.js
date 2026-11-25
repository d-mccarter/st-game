import { initSetup } from './setup.js';
import {
  createGame,
  beginRound,
  attachBoardController,
  currentActor,
  getShipDef,
  selectShip,
  holdOrders,
  endActivation,
  turnShip,
  canTurnShip,
  FACTIONS,
  ARC_LABELS,
  getBoardView,
} from './game.js';
import { MAPS } from './data.js';
import { preloadShips } from './ships.js';

const setupScreen = document.getElementById('screen-setup');
const playScreen = document.getElementById('screen-play');
const resultScreen = document.getElementById('screen-result');

const selectedCard = document.getElementById('selected-card');
const battleLog = document.getElementById('battle-log');
const turnInfo = document.getElementById('turn-info');
const phaseInfo = document.getElementById('phase-info');
const mapName = document.getElementById('map-name');
const ruleTags = document.getElementById('rule-tags');

const btnMove = document.getElementById('btn-move');
const btnFire = document.getElementById('btn-fire');
const btnWait = document.getElementById('btn-wait');
const btnTurnPort = document.getElementById('btn-turn-port');
const btnTurnStarboard = document.getElementById('btn-turn-starboard');
const btnMenu = document.getElementById('btn-menu');
const btnAgain = document.getElementById('btn-again');
const modeHint = document.getElementById('mode-hint');
const canvas = document.getElementById('board');

let game = null;
let boardApi = null;

function show(screen) {
  for (const el of [setupScreen, playScreen, resultScreen]) {
    el.hidden = el !== screen;
    el.classList.toggle('active', el === screen);
  }
  document.body.classList.toggle('playing', screen === playScreen);
}

function renderShipCard(ship) {
  if (!ship) {
    selectedCard.className = 'ship-card empty';
    selectedCard.innerHTML = '<p>Select a ship on the board. Legal moves and firing arcs appear when it is your activation.</p>';
    return;
  }
  const def = getShipDef(ship);
  const fac = FACTIONS[ship.faction];
  const actor = game ? currentActor(game) : null;
  const yours = ship.faction === game?.playerFaction;
  const active = actor && actor.id === ship.id;

  const weapons = def.weapons
    .map((w) => {
      const arcs = w.arcs.map((a) => ARC_LABELS[a] || a).join(', ');
      const selected = game?.activeWeaponId === w.id ? ' style="outline:1px solid var(--fed)"' : '';
      return `<li data-weapon="${w.id}"${selected}><span>${w.name} · dmg ${w.damage} · rng ${w.range}</span><span class="arc">${arcs}</span></li>`;
    })
    .join('');

  const thumb = `assets/ships/${ship.typeId}.png`;
  selectedCard.className = 'ship-card';
  selectedCard.innerHTML = `
    <div class="ship-card-head">
      <img class="ship-thumb" src="${thumb}" alt="" width="72" height="72">
      <div>
        <p class="name">${ship.name}</p>
        <p class="faction">${fac.name}${active ? ' · ACTIVE' : ''}${yours ? '' : ' · hostile'}</p>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat">
        <span>Hull</span>
        <strong>${ship.hull} / ${ship.hullMax}</strong>
        <div class="bar hull"><i style="width:${(100 * ship.hull) / ship.hullMax}%"></i></div>
      </div>
      <div class="stat">
        <span>Shields</span>
        <strong>${ship.shields} / ${ship.shieldsMax}</strong>
        <div class="bar shield"><i style="width:${(100 * ship.shields) / ship.shieldsMax}%"></i></div>
      </div>
      <div class="stat">
        <span>Move left</span>
        <strong>${ship.moveLeft}</strong>
      </div>
      <div class="stat">
        <span>Facing</span>
        <strong>${['E', 'NE', 'NW', 'W', 'SW', 'SE'][ship.facing] || ship.facing}</strong>
      </div>
      <div class="stat">
        <span>Turn mode</span>
        <strong>${def.turnMode || 1}</strong>
      </div>
      <div class="stat">
        <span>Since turn</span>
        <strong>${ship.hexesSinceTurn || 0} hex</strong>
      </div>
    </div>
    <p style="margin:0 0 0.35rem;color:var(--muted);font-size:0.9rem">Weapons — tap one, then press Fire to preview its arc</p>
    <ul class="weapons">${weapons}</ul>
  `;

  selectedCard.querySelectorAll('[data-weapon]').forEach((li) => {
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => {
      if (!game) return;
      game.activeWeaponId = li.getAttribute('data-weapon');
      if (active && yours && !ship.fired) game.mode = 'fire';
      refresh();
    });
  });
}

function renderLog() {
  battleLog.innerHTML = (game?.log || [])
    .map((e) => `<li class="${e.kind || ''}">${e.text}</li>`)
    .join('');
}

function refresh() {
  if (!game) return;

  const actor = currentActor(game);
  turnInfo.textContent = actor
    ? `${FACTIONS[actor.faction].short}: ${actor.name}`
    : `Round ${game.round}`;

  const selected = game.ships.find((s) => s.id === game.selectedId && s.alive);
  if (selected) {
    const view = getBoardView(game);
    if (game.mode === 'fire' || view.fireTargets.length) {
      phaseInfo.textContent = 'Amber = weapon arc · Red = ship you can shoot';
      if (modeHint) {
        modeHint.innerHTML =
          '<strong>Fire mode:</strong> amber hexes are this weapon’s arc; red hexes have a valid target — tap one to shoot.';
      }
    } else if (game.mode === 'move' || view.legalMoves.length) {
      phaseInfo.textContent = 'Cyan hexes = places this ship can move';
      if (modeHint) {
        modeHint.innerHTML =
          '<strong>Move mode:</strong> cyan hexes are straight ahead only. Use <strong>Port / Starboard</strong> to turn (1 move + turn mode).';
      }
    } else {
      phaseInfo.textContent = 'Inspecting ship · scroll/pinch zoom';
      if (modeHint) {
        modeHint.innerHTML =
          '<strong>Port / Starboard</strong> turn 60° (SFB turn mode). <strong>Move</strong> advances forward; <strong>Fire</strong> shows arcs.';
      }
    }
  } else {
    phaseInfo.textContent = actor?.faction === game.playerFaction
      ? 'Select your active ship · scroll/pinch zoom'
      : 'Resolving hostile orders…';
    if (modeHint) {
      modeHint.innerHTML =
        'Press <strong>Move</strong> or <strong>Fire</strong> to show hex highlights.';
    }
  }

  renderShipCard(selected || null);
  renderLog();

  const controllable =
    selected &&
    actor &&
    actor.id === selected.id &&
    selected.faction === game.playerFaction;

  btnMove.disabled = !controllable || selected.moveLeft <= 0;
  btnFire.disabled = !controllable || selected.fired;
  btnWait.disabled = !controllable;
  const canTurn = controllable && canTurnShip(game, selected);
  btnTurnPort.disabled = !canTurn;
  btnTurnStarboard.disabled = !canTurn;

  boardApi?.paint();

  if (game.winner) {
    const title = document.getElementById('result-title');
    const body = document.getElementById('result-body');
    if (game.winner === 'player') {
      title.textContent = 'Victory';
      body.textContent = 'All hostile vessels destroyed.';
    } else {
      title.textContent = 'Defeat';
      body.textContent = 'Your fleet has been eliminated.';
    }
    show(resultScreen);
  }
}

function startGame(settings) {
  game = createGame(settings);
  beginRound(game);

  // If enemy starts first (rare), AI runs via afterActivation; ensure player starts when possible
  let actor = currentActor(game);
  if (actor && actor.faction !== game.playerFaction) {
    // kick AI chain by selecting nothing and letting end — beginRound already set state;
    // manually trigger by importing run — simplest: endActivation path via hold on none
    // Force AI by calling select then afterActivation through a player skip — instead re-order so player first
  }

  const sizeLabel = settings.boardSize
    ? { skirmish: '9×9', standard: '12×12', fleet: '15×15', sector: '18×14' }[settings.boardSize]
    : '12×12';
  mapName.textContent = `${MAPS[settings.map].name} · ${sizeLabel}`;
  ruleTags.innerHTML = [
    settings.ruleAlternating ? 'Alternating' : 'Faction turns',
    settings.ruleOverload ? 'Overload' : null,
    settings.ruleRetreat ? 'Disengage' : null,
  ]
    .filter(Boolean)
    .map((t) => `<span>${t}</span>`)
    .join('');

  show(playScreen);
  if (!boardApi) {
    boardApi = attachBoardController(canvas, () => game, refresh);
  }
  // Auto-select player's actor
  actor = currentActor(game);
  if (actor && actor.faction === game.playerFaction) {
    selectShip(game, actor.id);
    game.activeWeaponId = getShipDef(actor).weapons[0].id;
    game.mode = 'move';
  }
  refresh();
  // Two frames: body.playing locks layout, then measure the real board-wrap box
  requestAnimationFrame(() => {
    boardApi.paint();
    requestAnimationFrame(() => boardApi.paint());
  });
}

btnMove.addEventListener('click', () => {
  if (!game?.selectedId) return;
  game.mode = 'move';
  refresh();
});

btnFire.addEventListener('click', () => {
  if (!game?.selectedId) return;
  const ship = game.ships.find((s) => s.id === game.selectedId);
  if (!ship) return;
  game.activeWeaponId = game.activeWeaponId || getShipDef(ship).weapons[0].id;
  game.mode = 'fire';
  refresh();
});

btnTurnPort.addEventListener('click', () => {
  if (!game) return;
  if (turnShip(game, -1)) refresh();
});

btnTurnStarboard.addEventListener('click', () => {
  if (!game) return;
  if (turnShip(game, 1)) refresh();
});

btnWait.addEventListener('click', () => {
  if (!game) return;
  holdOrders(game);
  const actor = currentActor(game);
  if (actor && actor.faction === game.playerFaction) {
    selectShip(game, actor.id);
    game.activeWeaponId = getShipDef(actor).weapons[0].id;
    game.mode = 'move';
  }
  refresh();
});

// Double-duty: after fire/move, press Wait/Hold to end activation — also End via fire completing
btnWait.addEventListener('dblclick', () => {
  if (!game) return;
  endActivation(game);
  refresh();
});

btnMenu.addEventListener('click', () => {
  game = null;
  show(setupScreen);
});

btnAgain.addEventListener('click', () => {
  game = null;
  show(setupScreen);
});

preloadShips().then(() => {
  // Repaint if a battle is already on screen when sprites finish loading
  if (game) boardApi?.paint();
});

initSetup(setupScreen, startGame);
show(setupScreen);
