// Hitscan shooting plus the effects layer: tracers, hit sparks, floating
// cash text and screen shake. The player shoots with the mouse; cops and
// gang enemies shoot back with limited accuracy.
import { clamp, dist2 } from './rng.js';

const RANGE = 520;
const PLAYER_DAMAGE = 34;
const ENEMY_DAMAGE = 7;

export function createCombat(game) {
  const tracers = [];
  const particles = [];
  const floaters = [];
  let shake = 0;

  function spark(x, y, color, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 160;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + Math.random() * 0.25, max: 0.6, color, size: 2 + Math.random() * 2 });
    }
  }

  // Ray vs circle: returns the distance along the ray, or Infinity.
  function rayHit(x, y, dx, dy, cx, cy, r) {
    const lx = cx - x, ly = cy - y;
    const t = lx * dx + ly * dy;
    if (t < 0 || t > RANGE) return Infinity;
    const px = x + dx * t, py = y + dy * t;
    const d2 = dist2(px, py, cx, cy);
    return d2 < r * r ? t : Infinity;
  }

  function fire(fromX, fromY, angle, opts) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let best = RANGE, hit = null, hitKind = null;
    // Targets: actors first, then cars, then buildings (block the shot).
    const targets = [];
    for (const a of [...game.cops, ...game.enemies, ...game.peds]) {
      if (!a.dead && !(opts.self === a)) targets.push({ kind: 'actor', obj: a, x: a.x, y: a.y, r: 13 });
    }
    if (opts.canHitPlayer && !game.player.dead && game.player.onFoot) {
      targets.push({ kind: 'player', obj: game.player, x: game.player.x, y: game.player.y, r: 13 });
    }
    for (const c of game.cars) {
      if (!c.wrecked) targets.push({ kind: 'car', obj: c, x: c.x, y: c.y, r: c.len * 0.4 });
    }
    for (const t of targets) {
      const d = rayHit(fromX, fromY, dx, dy, t.x, t.y, t.r);
      if (d < best) { best = d; hit = t; hitKind = t.kind; }
    }
    // Buildings block shots.
    for (const b of game.city.buildings) {
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = (best / steps) * i;
        const px = fromX + dx * t, py = fromY + dy * t;
        if (px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h) { best = t; hit = null; hitKind = 'wall'; break; }
      }
      if (hitKind === 'wall') break;
    }
    const ex = fromX + dx * best, ey = fromY + dy * best;
    tracers.push({ x1: fromX, y1: fromY, x2: ex, y2: ey, life: 0.09 });
    if (hitKind === 'actor' || hitKind === 'player') spark(ex, ey, '#ff595e', 7);
    else if (hitKind === 'car') spark(ex, ey, '#ffd60a', 5);
    else if (hitKind === 'wall') spark(ex, ey, '#adb5bd', 3);
    return { hit, hitKind, ex, ey, dist: best };
  }

  return {
    tracers, particles, floaters,
    addShake(a) { shake = Math.min(14, shake + a); },
    takeShake() { const s = shake; shake = 0; return s; },
    floater(x, y, text, color = '#06d6a0') {
      floaters.push({ x, y, text, color, life: 1.4 });
    },
    burst(x, y, color, n) { spark(x, y, color, n); },

    playerShot() {
      const p = game.player;
      if (!p.onFoot || p.dead) return;
      const angle = Math.atan2(game.mouse.worldY - p.y, game.mouse.worldX - p.x);
      const r = fire(p.x, p.y, angle, { self: null, canHitPlayer: false });
      game.audio.shot();
      game.gunfireTimer = 1.5;
      this.addShake(2);
      if (r.hitKind === 'actor') {
        const a = r.hit.obj;
        a.hp -= PLAYER_DAMAGE;
        if (a.hp <= 0 && !a.dead) {
          a.dead = true;
          game.stats.kills++;
          if (a.kind === 'cop') game.addHeat(40, a.x, a.y, true);
          if (a.kind === 'ped') game.addHeat(30, a.x, a.y, true);
        } else if (a.kind === 'ped') {
          a.state = 'flee'; a.fleeTimer = 5;
        }
      } else if (r.hitKind === 'car') {
        const c = r.hit.obj;
        c.hp = Math.max(0, c.hp - PLAYER_DAMAGE);
        if (c.hp <= 0 && !c.wrecked) { c.wrecked = true; c.speed = 0; }
      }
      // Firing a gun in public draws attention.
      game.addHeat(6, p.x, p.y);
    },

    enemyShot(shooter, player) {
      const spread = (Math.random() - 0.5) * 0.35;
      const angle = Math.atan2(player.y - shooter.y, player.x - shooter.x) + spread;
      const r = fire(shooter.x, shooter.y, angle, { self: shooter, canHitPlayer: true });
      if (dist2(shooter.x, shooter.y, player.x, player.y) < 700 * 700) game.audio.shot();
      if (r.hitKind === 'player') {
        player.hp -= ENEMY_DAMAGE;
        player.lastHurtAt = game.time;
        game.combat.addShake(4);
        if (player.hp <= 0) game.endRun('wasted');
      } else if (r.hitKind === 'car' && r.hit.obj === game.player.car) {
        // Gang fire can also wreck the player's car.
        const c = r.hit.obj;
        c.hp = Math.max(0, c.hp - ENEMY_DAMAGE);
        if (c.hp <= 0 && !c.wrecked) { c.wrecked = true; c.speed = 0; }
      }
    },

    update(dt) {
      for (let i = tracers.length - 1; i >= 0; i--) {
        tracers[i].life -= dt;
        if (tracers[i].life <= 0) tracers.splice(i, 1);
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.92; p.vy *= 0.92;
        if (p.life <= 0) particles.splice(i, 1);
      }
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.life -= dt; f.y -= 34 * dt;
        if (f.life <= 0) floaters.splice(i, 1);
      }
      shake = Math.max(0, shake - 30 * dt);
    },

    draw(ctx) {
      for (const t of tracers) {
        ctx.strokeStyle = 'rgba(255,240,150,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
      }
      for (const p of particles) {
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.font = 'bold 18px Arial, sans-serif';
      for (const f of floaters) {
        ctx.globalAlpha = clamp(f.life, 0, 1);
        ctx.fillStyle = f.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeText(f.text, f.x, f.y);
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
    },
  };
}
