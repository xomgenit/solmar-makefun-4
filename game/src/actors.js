// People on foot: pedestrians who stroll the sidewalks and flee from danger,
// foot cops who chase and shoot the player, and generic armed enemies (the
// Harbor Kings squads missions spawn) with health bars.
import { clamp, dist2 } from './rng.js';
import { WORLD } from './city.js';

const SHIRTS = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#9b5de5', '#00b4d8', '#ef476f', '#06d6a0'];
let nextId = 1;

export function createPed(x, y) {
  return {
    id: nextId++, kind: 'ped', x, y, angle: Math.random() * Math.PI * 2,
    speed: 55 + Math.random() * 30, hp: 100, shirt: SHIRTS[Math.floor(Math.random() * SHIRTS.length)],
    state: 'walk', // walk | flee | down
    tx: x, ty: y, downTimer: 0, fleeTimer: 0, dead: false,
  };
}

export function createCop(x, y) {
  return {
    id: nextId++, kind: 'cop', x, y, angle: 0, speed: 225,
    hp: 100, shirt: '#1d3557', state: 'chase', shootTimer: 0.5 + Math.random(),
    tx: x, ty: y, downTimer: 0, fleeTimer: 0, dead: false,
  };
}

export function createEnemy(x, y, name = 'Harbor King') {
  return {
    id: nextId++, kind: 'enemy', x, y, angle: 0, speed: 190,
    hp: 80, shirt: '#7f1d1d', name, state: 'chase', shootTimer: 0.8 + Math.random(),
    tx: x, ty: y, downTimer: 0, fleeTimer: 0, dead: false,
  };
}

// Pedestrians wander on sidewalks; they flee when the player is violent nearby.
export function updatePed(p, dt, game) {
  if (p.dead) return;
  if (p.state === 'down') {
    p.downTimer -= dt;
    if (p.downTimer <= 0) { p.state = 'flee'; p.fleeTimer = 4; }
    return;
  }
  const player = game.player;
  const nearDanger = dist2(p.x, p.y, player.x, player.y) < 260 * 260 && (game.wanted > 0 || game.gunfireTimer > 0);
  if (nearDanger && p.state !== 'flee') { p.state = 'flee'; p.fleeTimer = 5; }
  if (p.state === 'flee') {
    p.fleeTimer -= dt;
    if (p.fleeTimer <= 0) p.state = 'walk';
    const a = Math.atan2(p.y - player.y, p.x - player.x);
    p.angle = a;
    const sp = 210;
    const nx = p.x + Math.cos(a) * sp * dt, ny = p.y + Math.sin(a) * sp * dt;
    const fixed = game.city.collideCircle(nx, ny, 12);
    p.x = fixed.x; p.y = fixed.y;
    return;
  }
  // Stroll: pick a nearby target on a road edge, walk to it, repeat.
  if (dist2(p.x, p.y, p.tx, p.ty) < 30 * 30) {
    const c = game.city.roadCentres[Math.floor(Math.random() * game.city.roadCentres.length)];
    if (Math.random() < 0.5) { p.tx = c + (Math.random() < 0.5 ? -72 : 72); p.ty = clamp(p.y + (Math.random() - 0.5) * 500, 40, WORLD - 40); }
    else { p.tx = clamp(p.x + (Math.random() - 0.5) * 500, 40, WORLD - 40); p.ty = c + (Math.random() < 0.5 ? -72 : 72); }
  }
  const a = Math.atan2(p.ty - p.y, p.tx - p.x);
  p.angle = a;
  const nx = p.x + Math.cos(a) * p.speed * dt, ny = p.y + Math.sin(a) * p.speed * dt;
  const fixed = game.city.collideCircle(nx, ny, 12);
  p.x = fixed.x; p.y = fixed.y;
}

// Cops and enemies: run at the player and shoot when in range.
export function updateShooter(a, dt, game, canShoot) {
  if (a.dead) return;
  const player = game.player;
  const d = Math.sqrt(dist2(a.x, a.y, player.x, player.y));
  const stopRange = a.kind === 'cop' ? 150 : 190;
  a.angle = Math.atan2(player.y - a.y, player.x - a.x);
  if (d > stopRange) {
    const nx = a.x + Math.cos(a.angle) * a.speed * dt;
    const ny = a.y + Math.sin(a.angle) * a.speed * dt;
    const fixed = game.city.collideCircle(nx, ny, 12);
    a.x = fixed.x; a.y = fixed.y;
  }
  if (canShoot && d < 420 && !player.dead) {
    a.shootTimer -= dt;
    if (a.shootTimer <= 0) {
      a.shootTimer = 0.85 + Math.random() * 0.5;
      game.combat.enemyShot(a, player);
    }
  }
}

export function knockDown(p) {
  if (p.state === 'down') return;
  p.state = 'down'; p.downTimer = 2.5; p.hp = Math.max(1, p.hp - 30);
}

export function drawActor(ctx, a) {
  ctx.save();
  ctx.translate(a.x, a.y);
  if (a.state === 'down') {
    ctx.rotate(a.angle + Math.PI / 2);
    ctx.fillStyle = a.shirt;
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath(); ctx.arc(11, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  ctx.rotate(a.angle);
  // Shadow, body, head, gun arm hint.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(2, 3, 12, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = a.shirt;
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath(); ctx.arc(4, 0, 6.5, 0, Math.PI * 2); ctx.fill();
  if (a.kind !== 'ped') {
    ctx.fillStyle = '#222';
    ctx.fillRect(6, -2, 12, 4);
  }
  if (a.kind === 'cop') {
    ctx.fillStyle = '#a8dadc';
    ctx.beginPath(); ctx.arc(4, 0, 6.5, Math.PI, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // Health bar for armed actors below full health.
  if (a.kind !== 'ped' && a.hp < (a.kind === 'cop' ? 100 : 80)) {
    const max = a.kind === 'cop' ? 100 : 80;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(a.x - 16, a.y - 24, 32, 5);
    ctx.fillStyle = a.hp > 40 ? '#06d6a0' : '#ef476f';
    ctx.fillRect(a.x - 15, a.y - 23, 30 * clamp(a.hp / max, 0, 1), 3);
  }
}
