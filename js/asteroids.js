/** Asteroid field sprites for blocked hexes. */

const SRC = [
  'assets/asteroids/a.png?v=1',
  'assets/asteroids/b.png?v=1',
  'assets/asteroids/c.png?v=1',
];

const images = SRC.map(() => null);
let ready = false;

export function preloadAsteroids() {
  return Promise.all(
    SRC.map(
      (src, i) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            images[i] = img;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = src;
        })
    )
  ).then(() => {
    ready = images.some(Boolean);
  });
}

export function asteroidImage(col, row) {
  if (!ready) return null;
  const loaded = images.filter(Boolean);
  if (!loaded.length) return null;
  // Stable variant per hex
  const idx = Math.abs(col * 31 + row * 17) % loaded.length;
  return loaded[idx];
}
