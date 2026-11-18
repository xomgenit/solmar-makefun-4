// The wanted system: heat (0-100) maps to 0-5 stars. Crimes witnessed by
// cops or pedestrians raise heat; hiding out of sight cools it down. Foot
// cops answer on foot, cruisers answer when the player drives.
import { clamp, dist2 } from './rng.js';
import { createCop } from './actors.js';
import { createCar, driveCar } from './vehicles.js';
import { angleLerp } from './rng.js';

export function starsOf(heat) { return clamp(Math.ceil(heat / 20), 0, 5); }

// Was the crime seen? Any cop within 520px or any ped within 220px counts.
export function witnessed(game, x, y) {
  for (const c of game.cops) if (!c.dead && dist2(c.x, c.y, x, y) < 520 * 520) return true;
  for (const p of game.peds) if (!p.dead && p.state !== 'down' && dist2(p.x, p.y, x, y) < 220 * 220) return true;
  for (const c of game.cruisers) if (!c.wrecked && dist2(c.x, c.y, x, y) < 520 * 520) return true;
  return false;
}

export function addHeat(game, amount, x, y, always = false) {
  if (!always && !witnessed(game, x, y)) return false;
  game.heat = clamp(game.heat + amount, 0, 100);
  game.wanted = starsOf(game.heat);
  return true;
}

function spawnPointNear(game, minD, maxD) {
  const p = game.player;
  for (let tries = 0; tries < 12; tries++) {
    const a = Math.random() * Math.PI * 2;
    const d = minD + Math.random() * (maxD - minD);
    const x = clamp(p.x + Math.cos(a) * d, 40, 3920);
    const y = clamp(p.y + Math.sin(a) * d, 40, 3920);
    if (!game.city.pointInBuilding(x, y)) return { x, y };
  }
  return { x: clamp(p.x + 500, 40, 3920), y: p.y };
}

export function updateWanted(game, dt) {
  const player = game.player;
  // Cool down when nobody can see the player.
  const seen = witnessed(game, player.x, player.y);
  game.lastSeen = seen ? 0 : game.lastSeen + dt;
  if (!seen && game.heat > 0) {
    game.heat = Math.max(0, game.heat - 3 * dt);
    game.wanted = starsOf(game.heat);
  }

  // Foot cops: only while the player is on foot.
  if (game.wanted > 0 && player.onFoot && !player.dead) {
    const alive = game.cops.filter((c) => !c.dead).length;
    const want = Math.min(game.wanted + 1, 5);
    if (alive < want && Math.random() < dt * 1.2) {
      const s = spawnPointNear(game, 480, 700);
      game.cops.push(createCop(s.x, s.y));
    }
  }
  // Cruisers: only while the player drives.
  if (game.wanted > 0 && !player.onFoot && !player.dead) {
    const alive = game.cruisers.filter((c) => !c.wrecked).length;
    const want = Math.min(game.wanted, 3) + (game.wanted >= 4 ? 1 : 0);
    if (alive < want && Math.random() < dt * 0.9) {
      const s = spawnPointNear(game, 500, 800);
      const cruiser = createCar('cruiser', s.x, s.y, 0);
      cruiser.driver = 'police';
      game.cruisers.push(cruiser);
      game.cars.push(cruiser);
    }
  }
  // Busted: a cop reaches a slow player on foot.
  if (game.wanted > 0 && player.onFoot && !player.dead) {
    const near = game.cops.some((c) => !c.dead && dist2(c.x, c.y, player.x, player.y) < 30 * 30);
    if (near && player.speed < 70) {
      game.bustTimer += dt;
      if (game.bustTimer > 1.1) game.endRun('busted');
    } else game.bustTimer = 0;
  } else game.bustTimer = 0;
}

// Cruiser pursuit: steer toward the player, ram, recover when stuck.
export function updateCruiser(cruiser, dt, game) {
  if (cruiser.wrecked) return;
  const p = game.player;
  const want = Math.atan2(p.y - cruiser.y, p.x - cruiser.x);
  const diff = angleLerp(0, want - cruiser.angle, 1);
  const steer = clamp(diff * 2.2, -1, 1);
  const d = Math.sqrt(dist2(cruiser.x, cruiser.y, p.x, p.y));
  // Stuck detection: barely moving while trying to go.
  if (Math.abs(cruiser.speed) < 25) cruiser.stuckTimer = (cruiser.stuckTimer || 0) + dt;
  else cruiser.stuckTimer = 0;
  let throttle = 1;
  if (cruiser.stuckTimer > 1.6) {
    throttle = -1; // reverse out, then re-aim
    if (cruiser.stuckTimer > 2.4) cruiser.stuckTimer = 0;
  }
  if (d < 60) throttle = 1; // ramming speed
  driveCar(cruiser, dt, throttle, steer, false, game.city, game.cars);
  // Ramming the player's car hurts it (and the player a little).
  if (p.car && !p.car.wrecked && dist2(cruiser.x, cruiser.y, p.car.x, p.car.y) < 55 * 55) {
    if (Math.abs(cruiser.speed) > 150 && (!cruiser.lastRam || game.time - cruiser.lastRam > 0.8)) {
      cruiser.lastRam = game.time;
      p.car.hp = Math.max(0, p.car.hp - 8);
      game.player.hp = Math.max(1, game.player.hp - 3);
      game.audio.thud();
    }
  }
}
