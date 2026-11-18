// Solmar Bay: a seeded procedural city on a road grid. One seed rebuilds the
// identical city (buildings, palms, parked-car spots), so CONTINUE restores it.
import { makeRng, clamp } from './rng.js';

export const WORLD = 3960;          // world is WORLD x WORLD pixels
export const PITCH = 480;           // distance between road centres
export const ROAD_W = 120;          // road width
const BLOCKS = 8;                   // 8x8 blocks between the 9x9 roads
const ROAD_CENTRES = Array.from({ length: 9 }, (_, i) => 60 + i * PITCH);

export const LANDMARKS = {
  hideout:  { block: [3, 6], label: 'Dice\u2019s Hideout',    color: '#e8b04b' },
  diner:    { block: [4, 5], label: 'Vera\u2019s Diner',      color: '#e26d5a' },
  docks:    { block: [7, 3], label: 'Solmar Docks',        color: '#7fb3c8' },
  pier:     { block: [5, 7], label: 'Solmar Pier',         color: '#f2d492' },
  bank:     { block: [4, 3], label: 'Solmar National Bank', color: '#9db4c0' },
  garage:   { block: [2, 4], label: 'Sunrise Garage',      color: '#8fa98f' },
  spa:      { block: [5, 4], label: 'Sunset Auto Spa',     color: '#c98bb9' },
  hospital: { block: [3, 2], label: 'Solmar General',      color: '#f0f0f0' },
  sbpd:     { block: [4, 2], label: 'SBPD Headquarters',   color: '#5b7fa6' },
};

const ROOFS = ['#b08968', '#8d99ae', '#a98467', '#6d6875', '#7f8c8d', '#b56576', '#588157', '#9381ff'];
const PALM_SPOTS = 240;

export function zoneAt(x, y) {
  if (y > 3480) return 'PALMA BEACH';
  if (x > 3000) return 'EAST HARBOUR';
  if (x < 1320) return 'OLD TOWN';
  if (y < 1000) return 'NORTH HILLS';
  return 'DOWNTOWN';
}

export function isRoadPoint(x, y) {
  for (const c of ROAD_CENTRES) {
    if (Math.abs(x - c) < ROAD_W / 2 || Math.abs(y - c) < ROAD_W / 2) return true;
  }
  return false;
}

export function buildCity(seed) {
  const rng = makeRng(seed);
  const buildings = [];
  const palms = [];
  const landmarks = {};

  for (let bx = 0; bx < BLOCKS; bx++) {
    for (let by = 0; by < BLOCKS; by++) {
      const x0 = 120 + bx * PITCH, y0 = 120 + by * PITCH;
      const entry = Object.entries(LANDMARKS).find(([, l]) => l.block[0] === bx && l.block[1] === by);
      if (entry) {
        const [key, lm] = entry;
        const bw = 240, bh = 200;
        const b = {
          x: x0 + 60, y: y0 + 60, w: bw, h: bh,
          color: lm.color, label: lm.label, landmark: key,
        };
        buildings.push(b);
        landmarks[key] = { x: b.x + bw / 2, y: b.y + bh / 2, label: lm.label, building: b };
        continue;
      }
      // Beach row: no buildings, just sand and palms.
      if (by === 7) {
        for (let i = 0; i < 6; i++) {
          palms.push({ x: x0 + rng.range(20, 340), y: y0 + rng.range(20, 340), s: rng.range(0.8, 1.3) });
        }
        continue;
      }
      const count = rng.int(1, 3);
      for (let i = 0; i < count; i++) {
        const w = rng.range(90, 170), h = rng.range(90, 170);
        const x = x0 + rng.range(14, 346 - w), y = y0 + rng.range(14, 346 - h);
        const b = { x, y, w, h, color: rng.pick(ROOFS), label: null, landmark: null };
        // Keep buildings from overlapping each other inside the block.
        if (buildings.some((o) => o.x < b.x + b.w + 12 && b.x < o.x + o.w + 12 && o.y < b.y + b.h + 12 && b.y < o.y + o.h + 12 && o.x >= x0 - 1 && o.x < x0 + 360 && o.y >= y0 - 1 && o.y < y0 + 360)) continue;
        buildings.push(b);
      }
      for (let i = 0; i < 3; i++) {
        if (rng.chance(0.7)) palms.push({ x: x0 + rng.range(10, 350), y: y0 + rng.range(10, 350), s: rng.range(0.7, 1.2) });
      }
    }
  }
  // Extra palms along the beach promenade and scattered on sidewalks.
  for (let i = 0; i < PALM_SPOTS; i++) {
    palms.push({ x: rng.range(0, WORLD), y: rng.range(3440, 3940), s: rng.range(0.8, 1.4) });
  }

  // Push a circle out of every building it overlaps; returns corrected pos.
  function collideCircle(x, y, r) {
    for (const b of buildings) {
      const nx = clamp(x, b.x, b.x + b.w), ny = clamp(y, b.y, b.y + b.h);
      const dx = x - nx, dy = y - ny, d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        if (d2 < 0.001) { // centre inside the rect: push out along the shallow axis
          const left = x - b.x, right = b.x + b.w - x, top = y - b.y, bot = b.y + b.h - y;
          const m = Math.min(left, right, top, bot);
          if (m === left) x = b.x - r; else if (m === right) x = b.x + b.w + r;
          else if (m === top) y = b.y - r; else y = b.y + b.h + r;
        } else {
          const d = Math.sqrt(d2), push = (r - d) / d;
          x += dx * push; y += dy * push;
        }
      }
    }
    return { x: clamp(x, 20, WORLD - 20), y: clamp(y, 20, WORLD - 20) };
  }

  function pointInBuilding(x, y) {
    return buildings.some((b) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h);
  }

  return {
    seed, buildings, palms, landmarks, collideCircle, pointInBuilding,
    roadCentres: ROAD_CENTRES,
    drawGround(ctx, view) {
      // Grass base, beach band, sea strip.
      ctx.fillStyle = '#79b26a';
      ctx.fillRect(view.x, view.y, view.w, view.h);
      ctx.fillStyle = '#ecd9a0';
      ctx.fillRect(view.x, Math.max(view.y, 3480), view.w, Math.max(0, Math.min(view.y + view.h, 3960) - Math.max(view.y, 3480)));
      ctx.fillStyle = '#3d9db5';
      ctx.fillRect(view.x, Math.max(view.y, 3840), view.w, Math.max(0, Math.min(view.y + view.h, 3960) - Math.max(view.y, 3840)));
      // Sidewalk + road slabs.
      for (const c of ROAD_CENTRES) {
        ctx.fillStyle = '#c9c2b4';
        ctx.fillRect(c - ROAD_W / 2 - 14, view.y, ROAD_W + 28, view.h);
        ctx.fillRect(view.x, c - ROAD_W / 2 - 14, view.w, ROAD_W + 28);
        ctx.fillStyle = '#4a4a52';
        ctx.fillRect(c - ROAD_W / 2, view.y, ROAD_W, view.h);
        ctx.fillRect(view.x, c - ROAD_W / 2, view.w, ROAD_W);
      }
      // Lane dashes.
      ctx.fillStyle = '#e8e3c8';
      for (const c of ROAD_CENTRES) {
        for (let p = 0; p < WORLD; p += 64) {
          if (p > view.y - 40 && p < view.y + view.h + 40) ctx.fillRect(c - 3, p, 6, 30);
          if (p > view.x - 40 && p < view.x + view.w + 40) ctx.fillRect(p, c - 3, 30, 6);
        }
      }
      // Crosswalks at every intersection.
      ctx.fillStyle = 'rgba(240,240,230,0.75)';
      for (const cx of ROAD_CENTRES) for (const cy of ROAD_CENTRES) {
        for (let i = -2; i <= 2; i++) {
          ctx.fillRect(cx + i * 18 - 6, cy - ROAD_W / 2 + 6, 12, 18);
          ctx.fillRect(cx + i * 18 - 6, cy + ROAD_W / 2 - 24, 12, 18);
          ctx.fillRect(cx - ROAD_W / 2 + 6, cy + i * 18 - 6, 18, 12);
          ctx.fillRect(cx + ROAD_W / 2 - 24, cy + i * 18 - 6, 18, 12);
        }
      }
      // Zone labels painted on the ground.
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = 'bold 44px Arial, sans-serif';
      ctx.textAlign = 'center';
      const labels = [['OLD TOWN', 660, 2000], ['DOWNTOWN', 1980, 1980], ['EAST HARBOUR', 3450, 1500], ['NORTH HILLS', 1980, 500], ['PALMA BEACH', 1980, 3660]];
      for (const [t, lx, ly] of labels) ctx.fillText(t, lx, ly);
    },
    drawBuildings(ctx, view) {
      for (const b of buildings) {
        if (b.x + b.w < view.x || b.x > view.x + view.w || b.y + b.h < view.y || b.y > view.y + view.h) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(b.x + 8, b.y + 10, b.w, b.h);
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(b.x, b.y, b.w, 10);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        if (b.label) {
          ctx.fillStyle = '#1d3557';
          ctx.font = 'bold 17px Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 6);
        }
      }
      // Palms: trunk dot + green starburst.
      for (const p of palms) {
        if (p.x < view.x - 20 || p.x > view.x + view.w + 20 || p.y < view.y - 20 || p.y > view.y + view.h + 20) continue;
        ctx.strokeStyle = '#2d6a4f';
        ctx.lineWidth = 3 * p.s;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.4;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(a) * 13 * p.s, p.y + Math.sin(a) * 13 * p.s);
          ctx.stroke();
        }
        ctx.fillStyle = '#6b4a2b';
        ctx.beginPath(); ctx.arc(p.x, p.y, 3 * p.s, 0, Math.PI * 2); ctx.fill();
      }
    },
  };
}
