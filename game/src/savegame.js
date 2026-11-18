// localStorage save: the city seed is stored so CONTINUE rebuilds the exact
// same city, plus the player's cash, health, position, car and progress.
const KEY = 'solmar-save-v1';

export function readSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || typeof data.seed !== 'number') return null;
    return data;
  } catch { return null; }
}

export function hasSave() { return readSave() !== null; }

export function writeSave(game) {
  const p = game.player;
  const data = {
    v: 1,
    seed: game.seed,
    cash: p.cash,
    hp: Math.max(20, Math.round(p.hp)),
    x: Math.round(p.x),
    y: Math.round(p.y),
    angle: p.angle,
    car: p.car && !p.car.wrecked
      ? { model: p.car.model, color: p.car.color, hp: Math.round(p.car.hp), x: Math.round(p.car.x), y: Math.round(p.car.y), angle: p.car.angle }
      : null,
    inCar: !p.onFoot && !!p.car,
    completedMissions: game.completedMissions.slice(),
    stashes: game.stashesFound.slice(),
    sportsUnlocked: game.sportsUnlocked,
    stats: { ...game.stats },
    savedAt: Date.now(),
  };
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
  catch { return false; }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
