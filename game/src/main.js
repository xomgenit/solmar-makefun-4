// SOLMAR — Streets of the Sun: orchestration. Owns the game loop, input,
// camera, screens (title / pause / wasted / busted), the player (on foot and
// behind the wheel) and the wiring between every system.
import { buildCity, zoneAt, WORLD } from './city.js';
import { makeRng, clamp, dist2 } from './rng.js';
import { createAudio } from './audio.js';
import { MODELS, createCar, driveCar, updateTrafficCar, respawnTraffic, drawCar, seedParkedCars } from './vehicles.js';
import { createPed, updatePed, updateShooter, knockDown, drawActor } from './actors.js';
import { addHeat, updateWanted, updateCruiser } from './police.js';
import { createCombat } from './combat.js';
import { createMissionSystem } from './missions.js';
import { readSave, hasSave, writeSave, clearSave } from './savegame.js';
import { createHud } from './hud.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const audio = createAudio();
const hud = createHud();
const $ = (id) => document.getElementById(id);

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
}
window.addEventListener('resize', resize);
resize();

// ---- Input ---------------------------------------------------------------
const keys = new Set();
const mouse = { x: W / 2, y: H / 2, worldX: 0, worldY: 0, down: false };
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  audio.unlock();
  keys.add(e.code);
  if (e.code === 'KeyM') audio.setMuted(!audio.isMuted());
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  if (e.code === 'KeyE') onInteract();
  if (e.code === 'Enter' && state === 'end') respawn();
  if (e.code === 'Enter' && state === 'title') startNewGame();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { mouse.down = true; audio.unlock(); } });
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- World construction --------------------------------------------------
let game = null;
let state = 'title'; // title | play | pause | end
let endKind = null;
let fireTimer = 0;
let camera = { x: WORLD / 2, y: WORLD / 2 };

function doorOf(landmark) {
  // The street in front of the building, not the wall: the player spawns on
  // the road and can walk or drive away without grinding against the facade.
  return { x: landmark.x, y: landmark.y + 190 };
}

function buildWorld(seed, save) {
  const city = buildCity(seed);
  const rng = makeRng(seed ^ 0x9e3779b9);
  const g = {
    seed, city, rng, time: 0,
    heat: 0, wanted: 0, lastSeen: 0, bustTimer: 0, gunfireTimer: 0,
    cars: [], peds: [], cops: [], enemies: [], cruisers: [],
    completedMissions: save?.completedMissions?.slice() ?? [],
    stashesFound: save?.stashes?.slice() ?? [],
    sportsUnlocked: save?.sportsUnlocked ?? false,
    stats: save?.stats ?? { kills: 0, carsStolen: 0, timePlayed: 0, missionsDone: 0, shotsFired: 0 },
    zoneName: 'DOWNTOWN',
    audio, mouse,
  };
  g.addHeat = (amount, x, y, always) => addHeat(g, amount, x, y, always);
  g.saveGame = () => writeSave(g);
  g.endRun = (kind) => {
    if (state !== 'play') return;
    endKind = kind;
    state = 'end';
    g.player.dead = kind === 'wasted';
    audio.engine(false, 0);
    audio.siren(false, 0);
    audio.busted();
    showEnd(kind);
  };
  g.missions = createMissionSystem(g);
  g.combat = createCombat(g);

  // Parked + traffic cars.
  g.cars = seedParkedCars(rng, city);
  const trafficModels = ['sedan', 'sedan', 'taxi', 'van', 'pickup', 'coupe'];
  for (let i = 0; i < 14; i++) {
    const c = createCar(trafficModels[i % trafficModels.length], 0, 0, 0);
    c.traffic = true; c.driver = 'traffic';
    respawnTraffic(c, null, city);
    g.cars.push(c);
  }
  // Pedestrians on sidewalks.
  for (let i = 0; i < 26; i++) {
    const c = city.roadCentres[Math.floor(rng.next() * city.roadCentres.length)];
    const along = rng.range(80, WORLD - 80);
    const off = rng.chance(0.5) ? -72 : 72;
    const p = rng.chance(0.5) ? createPed(c + off, along) : createPed(along, c + off);
    g.peds.push(p);
  }
  // Player.
  const hideout = doorOf(city.landmarks.hideout);
  g.player = {
    x: save?.x ?? hideout.x, y: save?.y ?? hideout.y, angle: save?.angle ?? -Math.PI / 2,
    hp: save?.hp ?? 100, cash: save?.cash ?? 100, speed: 0,
    onFoot: true, car: null, dead: false, lastHurtAt: -99,
  };
  if (save?.car) {
    const c = createCar(save.car.model, save.car.x, save.car.y, save.car.angle, save.car.color);
    c.hp = save.car.hp; c.playerOwned = true;
    g.cars.push(c);
    if (save.inCar) {
      g.player.car = c; g.player.onFoot = false; c.driver = 'player';
      g.player.x = c.x; g.player.y = c.y; g.player.angle = c.angle;
    }
  }
  return g;
}

function setGame(g) {
  game = g;
  camera = { x: g.player.x, y: g.player.y };
  window.__solmar.current = g;
}

// ---- Screens ---------------------------------------------------------------
function showOnly(id) {
  for (const s of ['title-screen', 'pause-menu', 'end-screen']) {
    $(s).classList.toggle('hidden', s !== id);
  }
  $('hud').classList.toggle('hidden', id !== null && id !== 'pause-menu' && state !== 'play' && state !== 'pause');
  if (id === null) $('hud').classList.remove('hidden');
}

function showTitle() {
  state = 'title';
  $('continue-btn').disabled = !hasSave();
  showOnly('title-screen');
  $('hud').classList.add('hidden');
}

function startNewGame() {
  if (state !== 'title') return;
  audio.unlock(); audio.click();
  clearSave();
  const seed = (Math.random() * 0x7fffffff) | 0;
  setGame(buildWorld(seed, null));
  state = 'play';
  showOnly(null);
  hud.showBanner('WELCOME TO SOLMAR BAY');
}

function startContinue() {
  if (state !== 'title') return;
  const save = readSave();
  if (!save) return;
  audio.unlock(); audio.click();
  setGame(buildWorld(save.seed, save));
  state = 'play';
  showOnly(null);
  hud.showBanner('WELCOME BACK, DICE');
}

function togglePause() {
  if (state === 'play') {
    state = 'pause';
    audio.engine(false, 0); audio.siren(false, 0);
    $('stat-line').textContent =
      `Cash $${Math.floor(game.player.cash).toLocaleString('en-US')}  ·  Missions ${game.stats.missionsDone}  ·  Kills ${game.stats.kills}  ·  Cars stolen ${game.stats.carsStolen}  ·  Time ${Math.floor(game.stats.timePlayed / 60)}m`;
    showOnly('pause-menu');
  } else if (state === 'pause') {
    state = 'play';
    showOnly(null);
  }
}

function showEnd(kind) {
  $('end-title').textContent = kind === 'wasted' ? 'WASTED' : 'BUSTED';
  $('end-title').className = kind === 'wasted' ? 'wasted' : 'busted';
  $('end-sub').textContent = kind === 'wasted'
    ? 'Dice wakes up at Solmar General. The hospital bill is $150.'
    : 'SBPD takes Dice in. Bail is $200.';
  showOnly('end-screen');
  $('hud').classList.add('hidden');
}

function respawn() {
  const p = game.player;
  const fine = endKind === 'wasted' ? 150 : 200;
  const spot = doorOf(game.city.landmarks[endKind === 'wasted' ? 'hospital' : 'sbpd']);
  p.cash = Math.max(0, p.cash - fine);
  p.hp = 100; p.dead = false; p.onFoot = true;
  if (p.car) { p.car.driver = null; p.car = null; }
  p.x = spot.x; p.y = spot.y;
  game.heat = 0; game.wanted = 0; game.bustTimer = 0;
  game.cops = [];
  for (const c of game.cruisers) { const i = game.cars.indexOf(c); if (i >= 0) game.cars.splice(i, 1); }
  game.cruisers = [];
  game.saveGame();
  camera = { x: p.x, y: p.y };
  state = 'play';
  showOnly(null);
  hud.showBanner(endKind === 'wasted' ? 'PATCHED UP — BACK ON THE STREETS' : 'OUT ON BAIL — LAY LOW');
  endKind = null;
}

$('new-game-btn').addEventListener('click', startNewGame);
$('continue-btn').addEventListener('click', startContinue);
$('howto-btn').addEventListener('click', () => { audio.click(); $('howto').classList.toggle('hidden'); });
$('resume-btn').addEventListener('click', () => { audio.click(); togglePause(); });
$('save-btn').addEventListener('click', () => {
  audio.click();
  game.saveGame();
  $('save-btn').textContent = 'SAVED ✓';
  setTimeout(() => { $('save-btn').textContent = 'SAVE GAME'; }, 1500);
});
$('quit-btn').addEventListener('click', () => { audio.click(); game.saveGame(); showTitle(); });
$('respawn-btn').addEventListener('click', respawn);

// ---- Interaction (E key) ---------------------------------------------------
function nearestCar(x, y, maxD) {
  let best = null, bestD = maxD * maxD;
  for (const c of game.cars) {
    if (c.wrecked) continue;
    const d = dist2(x, y, c.x, c.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function onInteract() {
  if (state !== 'play' || game.player.dead) return;
  const p = game.player;
  const spa = doorOf(game.city.landmarks.spa);
  // Respray takes priority over exiting the car.
  if (!p.onFoot && p.car && dist2(p.car.x, p.car.y, spa.x, spa.y) < 150 * 150) {
    if (p.cash >= 150 && (game.wanted > 0 || p.car.hp < p.car.maxHp)) {
      p.cash -= 150;
      p.car.hp = p.car.maxHp;
      game.heat = 0; game.wanted = 0;
      game.cops = [];
      for (const c of game.cruisers) { const i = game.cars.indexOf(c); if (i >= 0) game.cars.splice(i, 1); }
      game.cruisers = [];
      game.combat.floater(p.car.x, p.car.y - 30, 'RESPRAYED — HEAT GONE', '#06d6a0');
      audio.cash();
    }
    return;
  }
  if (p.onFoot) {
    const car = nearestCar(p.x, p.y, 80);
    if (car) {
      const stolen = !car.playerOwned;
      car.parked = false; car.traffic = false; car.driver = 'player';
      car.playerOwned = true;
      p.car = car; p.onFoot = false;
      p.x = car.x; p.y = car.y; p.angle = car.angle;
      if (stolen) {
        game.stats.carsStolen++;
        game.addHeat(20, car.x, car.y);
        audio.thud();
      }
    }
  } else if (p.car) {
    const car = p.car;
    car.driver = null;
    p.car = null; p.onFoot = true;
    p.x = car.x - Math.sin(car.angle) * 34;
    p.y = car.y + Math.cos(car.angle) * 34;
    const fixed = game.city.collideCircle(p.x, p.y, 12);
    p.x = fixed.x; p.y = fixed.y;
    p.angle = car.angle;
  }
}

// ---- Per-frame updates -----------------------------------------------------
function updatePlayer(dt) {
  const p = game.player;
  if (p.dead) return;
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const up = keys.has('KeyW') || keys.has('ArrowUp');
  const down = keys.has('KeyS') || keys.has('ArrowDown');
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');

  if (p.onFoot) {
    let mx = (right ? 1 : 0) - (left ? 1 : 0);
    let my = (down ? 1 : 0) - (up ? 1 : 0);
    const len = Math.hypot(mx, my);
    const speed = sprint ? 265 : 170;
    if (len > 0) { mx /= len; my /= len; }
    p.speed = len > 0 ? speed : 0;
    const nx = p.x + mx * speed * dt, ny = p.y + my * speed * dt;
    const fixed = game.city.collideCircle(nx, ny, 12);
    p.x = fixed.x; p.y = fixed.y;
    p.angle = Math.atan2(mouse.worldY - p.y, mouse.worldX - p.x);
    // Shooting.
    fireTimer -= dt;
    if (mouse.down && fireTimer <= 0) {
      fireTimer = 0.13;
      game.stats.shotsFired++;
      game.combat.playerShot();
    }
    // Slow health regen after 8s without damage; hospital heals fast.
    const hosp = doorOf(game.city.landmarks.hospital);
    if (dist2(p.x, p.y, hosp.x, hosp.y) < 140 * 140) p.hp = Math.min(100, p.hp + 30 * dt);
    else if (game.time - p.lastHurtAt > 8) p.hp = Math.min(100, p.hp + 3 * dt);
  } else if (p.car) {
    const car = p.car;
    if (car.wrecked) {
      p.x = car.x; p.y = car.y;
      audio.engine(false, 0);
      return;
    }
    const throttle = (up ? 1 : 0) - (down ? 1 : 0);
    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    const handbrake = keys.has('Space');
    driveCar(car, dt, throttle, steer, handbrake, game.city, game.cars);
    p.x = car.x; p.y = car.y; p.angle = car.angle;
    p.speed = Math.abs(car.speed);
    audio.engine(true, clamp(Math.abs(car.speed) / 560, 0, 1));
    // Running over pedestrians.
    if (Math.abs(car.speed) > 70) {
      for (const ped of game.peds) {
        if (ped.dead || ped.state === 'down') continue;
        if (dist2(ped.x, ped.y, car.x, car.y) < 34 * 34) {
          knockDown(ped);
          game.addHeat(35, ped.x, ped.y);
          game.combat.burst(ped.x, ped.y, '#ff595e', 8);
          audio.thud();
        }
      }
    }
  }
}

function updateWorld(dt) {
  const p = game.player;
  game.time += dt;
  game.stats.timePlayed += dt;
  game.gunfireTimer = Math.max(0, game.gunfireTimer - dt);
  game.zoneName = zoneAt(p.x, p.y);

  updatePlayer(dt);
  for (const c of game.cars) {
    if (c.traffic && !c.wrecked) updateTrafficCar(c, dt, game.city, game.cars, p);
    else if (c.traffic && c.wrecked) {
      c.wreckTimer = (c.wreckTimer || 0) + dt;
      if (c.wreckTimer > 15) { c.wreckTimer = 0; respawnTraffic(c, p, game.city); }
    }
  }
  for (let i = game.peds.length - 1; i >= 0; i--) {
    const ped = game.peds[i];
    if (ped.dead) {
      ped.deadTimer = (ped.deadTimer || 0) + dt;
      if (ped.deadTimer > 8) { game.peds.splice(i, 1); continue; }
    } else {
      updatePed(ped, dt, game);
      // Recycle peds that wandered far from the player.
      if (dist2(ped.x, ped.y, p.x, p.y) > 1400 * 1400) {
        const c = game.city.roadCentres[Math.floor(Math.random() * game.city.roadCentres.length)];
        ped.x = clamp(p.x + (Math.random() - 0.5) * 900, 60, WORLD - 60);
        ped.y = c + (Math.random() < 0.5 ? -72 : 72);
      }
    }
  }
  for (let i = game.cops.length - 1; i >= 0; i--) {
    const cop = game.cops[i];
    if (cop.dead) {
      cop.deadTimer = (cop.deadTimer || 0) + dt;
      if (cop.deadTimer > 8) game.cops.splice(i, 1);
      continue;
    }
    updateShooter(cop, dt, game, p.onFoot);
  }
  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];
    if (e.dead) {
      e.deadTimer = (e.deadTimer || 0) + dt;
      if (e.deadTimer > 8) game.enemies.splice(i, 1);
      continue;
    }
    updateShooter(e, dt, game, true);
  }
  for (const c of game.cruisers) updateCruiser(c, dt, game);
  updateWanted(game, dt);
  game.missions.update(dt);
  game.combat.update(dt);
  audio.siren(game.cruisers.some((c) => !c.wrecked) && game.wanted > 0, dt);

  // Camera follows the player.
  const k = 1 - Math.exp(-6 * dt);
  camera.x += (p.x - camera.x) * k;
  camera.y += (p.y - camera.y) * k;

  // Mission banners.
  for (const b of game.missions.takeBanners()) hud.showBanner(b);
  hud.update(game, dt, hintText());
}

function hintText() {
  const p = game.player;
  if (p.dead) return '';
  const spa = doorOf(game.city.landmarks.spa);
  if (!p.onFoot && p.car && dist2(p.car.x, p.car.y, spa.x, spa.y) < 150 * 150) {
    if (game.wanted > 0 || p.car.hp < p.car.maxHp) {
      return p.cash >= 150 ? 'E — Respray $150 · clears wanted + repairs' : 'Respray $150 — not enough cash';
    }
  }
  if (p.onFoot) {
    const hosp = doorOf(game.city.landmarks.hospital);
    if (p.hp < 100 && dist2(p.x, p.y, hosp.x, hosp.y) < 140 * 140) return 'Solmar General — healing…';
    const car = nearestCar(p.x, p.y, 80);
    if (car) return car.playerOwned ? 'E — Get in' : 'E — Steal car';
    if (game.wanted > 0) {
      const near = game.cops.some((c) => !c.dead && dist2(c.x, c.y, p.x, p.y) < 220 * 220);
      if (near) return 'Cops closing in — run or hide!';
    }
    return 'WASD move · SHIFT sprint · Mouse aim · Click shoot · E enter car';
  }
  return 'WASD drive · SPACE handbrake · E exit car';
}

// ---- Rendering ---------------------------------------------------------------
function drawPlayerOnFoot(ctx) {
  const p = game.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(2, 3, 12, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#118ab2'; // Dice's teal shirt
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath(); ctx.arc(4, 0, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.fillRect(6, -2, 13, 4);
  ctx.fillStyle = '#ffd60a';
  ctx.beginPath(); ctx.arc(-6, -6, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#1d3557';
  ctx.fillRect(0, 0, W, H);
  if (!game) return;
  const shake = game.combat.takeShake();
  const sx = shake ? (Math.random() - 0.5) * shake : 0;
  const sy = shake ? (Math.random() - 0.5) * shake : 0;
  const view = { x: camera.x - W / 2 - 40, y: camera.y - H / 2 - 40, w: W + 80, h: H + 80 };
  ctx.save();
  ctx.translate(W / 2 - camera.x + sx, H / 2 - camera.y + sy);

  game.city.drawGround(ctx, view);
  // Mission marker: pulsing ring + light beam.
  const m = game.missions.marker();
  if (m) {
    const pulse = 26 + Math.sin(game.time * 4) * 6;
    ctx.strokeStyle = 'rgba(255,230,0,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(m.x, m.y, pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,230,0,0.15)';
    ctx.fillRect(m.x - 8, m.y - 220, 16, 220);
  }
  game.city.drawBuildings(ctx, view);
  const cars = [...game.cars].sort((a, b) => a.y - b.y);
  for (const c of cars) {
    if (c.x < view.x - 60 || c.x > view.x + view.w + 60 || c.y < view.y - 60 || c.y > view.y + view.h + 60) continue;
    drawCar(ctx, c);
    if (c.hp < c.maxHp && !c.wrecked) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(c.x - 20, c.y - 26, 40, 5);
      ctx.fillStyle = c.hp > 40 ? '#06d6a0' : '#ef476f';
      ctx.fillRect(c.x - 19, c.y - 25, 38 * clamp(c.hp / c.maxHp, 0, 1), 3);
    }
  }
  for (const ped of game.peds) {
    if (ped.x < view.x - 30 || ped.x > view.x + view.w + 30 || ped.y < view.y - 30 || ped.y > view.y + view.h + 30) continue;
    drawActor(ctx, ped);
  }
  for (const cop of game.cops) drawActor(ctx, cop);
  for (const e of game.enemies) drawActor(ctx, e);
  if (game.player.onFoot && !game.player.dead) drawPlayerOnFoot(ctx);
  game.combat.draw(ctx);
  ctx.restore();

  // Crosshair while on foot.
  if (state === 'play' && game.player.onFoot && !game.player.dead) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ef476f';
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 2, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- Main loop ---------------------------------------------------------------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  mouse.worldX = camera.x - W / 2 + mouse.x;
  mouse.worldY = camera.y - H / 2 + mouse.y;
  if (!game) return;
  if (state === 'play') updateWorld(dt);
  else if (state === 'title') {
    // Living backdrop: traffic + peds move, camera drifts over the city.
    game.time += dt;
    for (const c of game.cars) if (c.traffic && !c.wrecked) updateTrafficCar(c, dt, game.city, game.cars, game.player);
    for (const ped of game.peds) if (!ped.dead) updatePed(ped, dt, game);
    camera.x = WORLD / 2 + Math.cos(game.time * 0.05) * 700;
    camera.y = WORLD / 2 + Math.sin(game.time * 0.04) * 700;
  }
  render();
}

// ---- Debug / test API (also used by the screenshot builder) ------------------
window.__solmar = {
  current: null,
  get state() { return state; },
  teleport(x, y) {
    const g = window.__solmar.current; if (!g) return;
    const p = g.player;
    if (p.car) { p.car.x = x; p.car.y = y; }
    p.x = x; p.y = y; camera.x = x; camera.y = y;
  },
  setWanted(n) {
    const g = window.__solmar.current; if (!g) return;
    g.heat = clamp(n, 0, 5) * 20; g.wanted = clamp(n, 0, 5);
  },
  giveCash(n) { const g = window.__solmar.current; if (g) g.player.cash += n; },
  heal() { const g = window.__solmar.current; if (g) g.player.hp = 100; },
  spawnCar(model = 'coupe') {
    const g = window.__solmar.current; if (!g) return null;
    const p = g.player;
    const c = createCar(model, p.x + 60, p.y, 0);
    c.playerOwned = true;
    g.cars.push(c);
    return c;
  },
  landmark(name) {
    const g = window.__solmar.current;
    return g ? doorOf(g.city.landmarks[name]) : null;
  },
};

// Boot: a demo world behind the title screen.
setGame(buildWorld((Math.random() * 0x7fffffff) | 0, null));
showTitle();
requestAnimationFrame(loop);
