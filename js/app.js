const KEY = 'web-app-starter-taps';

const btn = document.getElementById('tap-btn');
const label = document.getElementById('tap-count');

function readCount() {
  const raw = localStorage.getItem(KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function writeCount(n) {
  localStorage.setItem(KEY, String(n));
  label.textContent = `Taps: ${n}`;
}

let count = readCount();
writeCount(count);

btn.addEventListener('click', () => {
  count += 1;
  writeCount(count);
});
