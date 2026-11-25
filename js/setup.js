import { FACTIONS, shipsForFaction, SHIP_TYPES } from './data.js';
import { shipSrc } from './ships.js';

export function initSetup(root, onStart) {
  const form = root.querySelector('#setup-form');
  const builder = root.querySelector('#fleet-builder');
  const budgetEl = root.querySelector('#fleet-budget');
  const factionEl = root.querySelector('#opt-faction');
  const pointsEl = root.querySelector('#opt-points');
  const errorEl = root.querySelector('#setup-error');

  const counts = {};

  function currentFaction() {
    return factionEl.value;
  }

  function points() {
    return Number(pointsEl.value);
  }

  function spent() {
    let total = 0;
    for (const [id, n] of Object.entries(counts)) {
      total += (SHIP_TYPES[id]?.cost || 0) * n;
    }
    return total;
  }

  function syncBudget() {
    budgetEl.textContent = `${spent()} / ${points()}`;
    budgetEl.style.color = spent() > points() ? 'var(--danger)' : 'var(--warn)';
  }

  function renderBuilder() {
    const faction = currentFaction();
    const ships = shipsForFaction(faction);
    // Clear counts for other faction types
    for (const id of Object.keys(counts)) {
      if (SHIP_TYPES[id]?.faction !== faction) delete counts[id];
    }
    builder.innerHTML = '';
    for (const ship of ships) {
      if (counts[ship.id] == null) counts[ship.id] = ship.id.endsWith('ff') || ship.id === 'f5' ? 1 : 1;
      const row = document.createElement('div');
      row.className = 'ship-pick';
      const art = shipSrc(ship.id);
      row.innerHTML = `
        <div class="ship-pick-main">
          ${art ? `<img class="ship-thumb" src="${art}" alt="" width="64" height="64">` : ''}
          <div>
            <h3>${ship.name}</h3>
            <p>${FACTIONS[faction].short} · ${ship.cost} pts</p>
          </div>
        </div>
        <div class="qty">
          <button type="button" data-act="dec" data-id="${ship.id}" aria-label="Fewer">−</button>
          <strong data-count="${ship.id}">${counts[ship.id]}</strong>
          <button type="button" data-act="inc" data-id="${ship.id}" aria-label="More">+</button>
        </div>
        <div class="meta">
          <span class="chip">Hull ${ship.hull}</span>
          <span class="chip">Shields ${ship.shields}</span>
          <span class="chip">Move ${ship.move}</span>
          <span class="chip">TM ${ship.turnMode || 1}</span>
          <span class="chip">${ship.weapons.map((w) => w.name).join(' / ')}</span>
        </div>
      `;
      builder.appendChild(row);
    }
    syncBudget();
  }

  builder.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'inc') counts[id] = (counts[id] || 0) + 1;
    if (btn.dataset.act === 'dec') counts[id] = Math.max(0, (counts[id] || 0) - 1);
    const label = builder.querySelector(`[data-count="${id}"]`);
    if (label) label.textContent = String(counts[id]);
    syncBudget();
  });

  factionEl.addEventListener('change', renderBuilder);
  pointsEl.addEventListener('change', syncBudget);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const fleet = { ...counts };
    const total = spent();
    const shipCount = Object.values(fleet).reduce((a, b) => a + b, 0);
    if (shipCount < 1) {
      errorEl.hidden = false;
      errorEl.textContent = 'Build at least one ship.';
      return;
    }
    if (total > points()) {
      errorEl.hidden = false;
      errorEl.textContent = 'Fleet exceeds starting points.';
      return;
    }
    onStart({
      points: points(),
      faction: currentFaction(),
      map: form.map.value,
      boardSize: form.boardSize.value,
      ruleAlternating: form.ruleAlternating.checked,
      ruleOverload: form.ruleOverload.checked,
      ruleRetreat: form.ruleRetreat.checked,
      fleet,
    });
  });

  renderBuilder();
}
