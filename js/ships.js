/** Ship sprite loader — original stylized starship art (not official Trek IP). */

const SRC = {
  ca: 'assets/ships/ca.png?v=top1',
  ff: 'assets/ships/ff.png?v=top1',
  d7: 'assets/ships/d7.png?v=top1',
  f5: 'assets/ships/f5.png?v=top1',
};

const cache = new Map();
let loadPromise = null;

export function preloadShips() {
  if (loadPromise) return loadPromise;
  loadPromise = Promise.all(
    Object.entries(SRC).map(
      ([id, url]) =>
        new Promise((resolve) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => {
            cache.set(id, img);
            resolve(img);
          };
          img.onerror = () => {
            console.warn('Ship sprite failed to load', url);
            resolve(null);
          };
          img.src = url;
        })
    )
  );
  return loadPromise;
}

export function shipImage(typeId) {
  return cache.get(typeId) || null;
}

export function shipSrc(typeId) {
  return SRC[typeId] || null;
}
