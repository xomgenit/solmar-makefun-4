// Cars: five civilian models plus the police cruiser. Arcade driving with
// acceleration, braking, handbrake drift and collision damage; lane-following
// traffic that turns at intersections and respawns near the player.
import { clamp, angleLerp } from './rng.js';
import { WORLD, PITCH, ROAD_W } from './city.js';

export const MODELS = {
  sedan:   { name: 'Sedan',   top: 430, accel: 260, grip: 2.6, len: 52, wid: 26, hp: 100, colors: ['#c1121f', '#457b9d', '#6c757d', '#e9c46a', '#2a9d8f'] },
  coupe:   { name: 'Coupe',   top: 560, accel: 340, grip: 3.1, len: 50, wid: 25, hp: 90,  colors: ['#d90429', '#f77f00', '#3a0ca3', '#ffffff'] },
  taxi:    { name: 'Taxi',    top: 420, accel: 250, grip: 2.6, len: 52, wid: 26, hp: 100, colors: ['#ffd60a'] },
  van:     { name: 'Van',     top: 340, accel: 190, grip: 2.2, len: 58, wid: 28, hp: 160, colors: ['#adb5bd', '#6c584c', '#386641'] },
  pickup:  { name: 'Pickup',  top: 400, accel: 240, grip: 2.4, len: 56, wid: 27, hp: 130, colors: ['#9d0208', '#073b4c', '#606c38'] },
  cruiser: { name: 'Cruiser', top: 540, accel: 330, grip: 3.0, len: 54, wid: 26, hp: 150, colors: ['#1d3557'] },
};

let nextId = 1;

export function createCar(model, x, y, angle, color) {
  const m = MODELS[model];
  return {
    id: nextId++, model, name: m.name, x, y, angle, speed: 0,
    color: color ?? m.colors[Math.floor(Math.random() * m.colors.length)],
    hp: m.hp, maxHp: m.hp, len: m.len, wid: m.wid,
    parked: false, traffic: false, police: model === 'cruiser',
    wrecked: false, smoke: 0, driver: null, // 'player' | 'traffic' | 'police' | null
    // traffic AI state
    road: null, roadIndex: 0, dir: 1, cruise: 0,
  };
}

// Arcade drive step shared by the player car and cruisers.
export function driveCar(car, dt, throttle, steer, handbrake, city, others) {
  const m = MODELS[car.model];
  const forward = car.speed >= 0 ? 1 : -1;
  car.speed += throttle * m.accel * dt;
  car.speed -= car.speed * (handbrake ? 1.6 : 0.35) * dt; // drag + rolling resistance
  if (throttle === 0) car.speed -= Math.sign(car.speed) * 40 * dt;
  car.speed = clamp(car.speed, -m.top * 0.45, m.top);
  if (Math.abs(car.speed) < 4 && throttle === 0) car.speed = 0;

  const steerPower = clamp(Math.abs(car.speed) / 120, 0, 1) * m.grip * (handbrake ? 1.5 : 1);
  car.angle += steer * steerPower * forward * dt * (handbrake ? 1.3 : 1);

  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const fixed = city.collideCircle(nx, ny, car.len * 0.42);
  if (fixed.x !== nx || fixed.y !== ny) {
    // Hit a building or the world edge: hard hits cost speed + health, but a
    // slow press only slides along — never pin the car with a per-frame cut.
    if (Math.abs(car.speed) > 90) {
      car.hp = Math.max(0, car.hp - Math.abs(car.speed) * 0.045);
      car.speed *= 0.45;
    }
  }
  car.x = fixed.x; car.y = fixed.y;

  // Soft car-to-car push (circle approx, radius by length).
  for (const o of others) {
    if (o === car || o.wrecked) continue;
    const dx = car.x - o.x, dy = car.y - o.y;
    const rr = car.len * 0.42 + o.len * 0.42;
    const d2 = dx * dx + dy * dy;
    if (d2 < rr * rr && d2 > 0.01) {
      const d = Math.sqrt(d2), push = (rr - d) / 2 / d;
      car.x += dx * push; car.y += dy * push;
      o.x -= dx * push; o.y -= dy * push;
      const impact = Math.abs(car.speed - o.speed);
      if (impact > 120) {
        car.hp = Math.max(0, car.hp - 6); o.hp = Math.max(0, o.hp - 6);
        car.speed *= 0.82; o.speed *= 0.82;
      }
    }
  }
  if (car.hp <= 0 && !car.wrecked) { car.wrecked = true; car.speed = 0; }
  if (car.wrecked) car.smoke = Math.min(1, car.smoke + dt);
}

// One traffic car: cruise along its road lane, sometimes turn at crossings.
export function updateTrafficCar(car, dt, city, cars, player) {
  if (car.wrecked) return;
  const centres = city.roadCentres;
  if (car.road === null) return;
  const c = centres[car.roadIndex];
  const lane = 30;
  let targetAngle, tx, ty;
  if (car.road === 'v') {
    tx = c + lane * car.dir; ty = car.y + car.dir * 100;
    targetAngle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    tx = car.x + car.dir * 100; ty = c + lane * car.dir;
    targetAngle = car.dir > 0 ? 0 : Math.PI;
  }
  // Steer toward the lane, slow for a car ahead.
  const want = Math.atan2(ty - car.y, tx - car.x);
  const steer = clamp(angleLerp(0, want - car.angle, 1) * 3, -1, 1);
  let throttle = 0.55;
  for (const o of cars) {
    if (o === car) continue;
    const dx = o.x - car.x, dy = o.y - car.y;
    const ahead = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    const side = Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle));
    if (ahead > 0 && ahead < 90 && side < 30) { throttle = -0.6; break; }
  }
  driveCar(car, dt, throttle, steer, false, city, cars);
  car.speed = clamp(car.speed, 0, car.cruise || 150);

  // At an intersection, maybe turn onto the crossing road.
  const nearCross = centres.find((cc) => Math.abs((car.road === 'v' ? car.y : car.x) - cc) < 26);
  if (nearCross !== undefined && Math.random() < 0.006) {
    const crossIndex = centres.indexOf(nearCross);
    car.road = car.road === 'v' ? 'h' : 'v';
    car.roadIndex = crossIndex;
    car.dir = Math.random() < 0.5 ? 1 : -1;
    if (car.road === 'v') car.x = centres[car.roadIndex] + 30 * car.dir;
    else car.y = centres[car.roadIndex] + 30 * car.dir;
  }
  // Off the map edge: recycle to a road near the player.
  if (car.x < 40 || car.x > WORLD - 40 || car.y < 40 || car.y > WORLD - 40) {
    respawnTraffic(car, player, city);
  }
}

export function respawnTraffic(car, player, city) {
  const centres = city.roadCentres;
  const vertical = Math.random() < 0.5;
  car.road = vertical ? 'v' : 'h';
  car.roadIndex = Math.floor(Math.random() * centres.length);
  car.dir = Math.random() < 0.5 ? 1 : -1;
  car.cruise = 130 + Math.random() * 70;
  car.wrecked = false; car.hp = car.maxHp; car.smoke = 0;
  const c = centres[car.roadIndex];
  // Spawn on a road segment 500-900px from the player when possible.
  const along = clamp(player ? (vertical ? player.y : player.x) + (Math.random() < 0.5 ? -1 : 1) * (550 + Math.random() * 350) : Math.random() * WORLD, 80, WORLD - 80);
  if (vertical) { car.x = c + 30 * car.dir; car.y = along; car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
  else { car.x = along; car.y = c + 30 * car.dir; car.angle = car.dir > 0 ? 0 : Math.PI; }
  car.speed = car.cruise * 0.7;
}

export function drawCar(ctx, car) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  const L = car.len, W = car.wid;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-L / 2 + 3, -W / 2 + 4, L, W);
  // Body with rounded nose.
  ctx.fillStyle = car.wrecked ? '#3a3a3a' : car.color;
  ctx.beginPath();
  ctx.roundRect(-L / 2, -W / 2, L, W, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Cabin + windshield.
  ctx.fillStyle = car.wrecked ? '#222' : '#bde0fe';
  ctx.fillRect(-L * 0.18, -W / 2 + 4, L * 0.34, W - 8);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(L * 0.16, -W / 2 + 4, 5, W - 8);
  // Headlights / taillights.
  ctx.fillStyle = '#fff3b0';
  ctx.fillRect(L / 2 - 3, -W / 2 + 2, 3, 6);
  ctx.fillRect(L / 2 - 3, W / 2 - 8, 3, 6);
  ctx.fillStyle = '#ff4d4d';
  ctx.fillRect(-L / 2, -W / 2 + 2, 3, 6);
  ctx.fillRect(-L / 2, W / 2 - 8, 3, 6);
  if (car.model === 'taxi') {
    ctx.fillStyle = '#111';
    ctx.font = 'bold 9px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('TAXI', 0, -W / 2 - 4);
  }
  if (car.police) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(-L * 0.32, -W / 2 + 2, L * 0.2, W - 4);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 9px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SBPD', -L * 0.22, 3);
  }
  ctx.restore();
  if (car.wrecked && car.smoke > 0) {
    ctx.fillStyle = `rgba(60,60,60,${0.25 + car.smoke * 0.35})`;
    ctx.beginPath();
    ctx.arc(car.x + Math.random() * 6 - 3, car.y - 8 - Math.random() * 10, 6 + car.smoke * 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Parked cars along road edges, seeded so the same seed parks the same cars.
export function seedParkedCars(rng, city, count = 42) {
  const out = [];
  const models = ['sedan', 'sedan', 'coupe', 'taxi', 'van', 'pickup'];
  const centres = city.roadCentres;
  const parkCentres = centres.filter((c) => c < 3840); // the 3900 road is in the sea
  for (let i = 0; i < count; i++) {
    const vertical = rng.chance(0.5);
    const c = rng.pick(parkCentres);
    const along = rng.range(140, WORLD - 140);
    const side = rng.chance(0.5) ? 1 : -1;
    const off = ROAD_W / 2 - 20;
    const model = rng.pick(models);
    const car = createCar(model, 0, 0, 0);
    if (vertical) {
      car.x = c + side * off; car.y = along;
      car.angle = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.x = along; car.y = c + side * off;
      car.angle = side > 0 ? 0 : Math.PI;
    }
    if (city.pointInBuilding(car.x, car.y)) continue;
    if (out.some((o) => Math.hypot(o.x - car.x, o.y - car.y) < 85)) continue; // no overlaps
    car.parked = true;
    out.push(car);
  }
  return out;
}
export { PITCH };
