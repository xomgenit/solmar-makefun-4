// The HUD: DOM panels (health, cash, wanted stars, objective, speedometer,
// zone, hints, mission banner) plus a round canvas minimap with blips.
// DOM text is only rewritten when its value changes, to keep frames cheap.
import { WORLD } from './city.js';

export function createHud() {
  const el = (id) => document.getElementById(id);
  const nodes = {
    hpFill: el('hp-fill'), hpText: el('hp-text'),
    cash: el('cash'), stars: el('stars'),
    objTitle: el('objective-title'), objText: el('objective-text'),
    speed: el('speed'), speedBox: el('speed-box'),
    zone: el('zone'), hint: el('hint'), banner: el('banner'),
    minimap: el('minimap'),
  };
  const mctx = nodes.minimap.getContext('2d');
  const last = {};
  let bannerTimer = 0;

  function set(node, key, value) {
    if (last[key] !== value) { last[key] = value; if (node) node.textContent = value; }
  }

  function drawMinimap(game) {
    const S = 180, scale = S / WORLD;
    const c = mctx;
    c.clearRect(0, 0, S, S);
    c.fillStyle = '#2f6b3a';
    c.fillRect(0, 0, S, S);
    // Beach + sea.
    c.fillStyle = '#d9c27a';
    c.fillRect(0, 3480 * scale, S, (3960 - 3480) * scale);
    c.fillStyle = '#2a7f9e';
    c.fillRect(0, 3840 * scale, S, (3960 - 3840) * scale);
    // Roads.
    c.strokeStyle = '#8a8a8a';
    c.lineWidth = 4;
    for (const r of game.city.roadCentres) {
      c.beginPath(); c.moveTo(r * scale, 0); c.lineTo(r * scale, S); c.stroke();
      c.beginPath(); c.moveTo(0, r * scale); c.lineTo(S, r * scale); c.stroke();
    }
    // Landmarks.
    c.fillStyle = '#ffd60a';
    for (const lm of Object.values(game.city.landmarks)) {
      c.fillRect(lm.x * scale - 1.5, lm.y * scale - 1.5, 3, 3);
    }
    // Mission marker (pulsing diamond).
    const m = game.missions.marker();
    if (m) {
      const pulse = 4 + Math.sin(game.time * 5) * 1.5;
      c.save();
      c.translate(m.x * scale, m.y * scale);
      c.rotate(Math.PI / 4);
      c.fillStyle = '#ffe600';
      c.fillRect(-pulse / 2, -pulse / 2, pulse, pulse);
      c.restore();
    }
    // Cops (blue) and enemies (red).
    c.fillStyle = '#4cc9f0';
    for (const cop of game.cops) if (!cop.dead) c.fillRect(cop.x * scale - 2, cop.y * scale - 2, 4, 4);
    for (const cr of game.cruisers) if (!cr.wrecked) c.fillRect(cr.x * scale - 2, cr.y * scale - 2, 4, 4);
    c.fillStyle = '#ef476f';
    for (const e of game.enemies) if (!e.dead) c.fillRect(e.x * scale - 2, e.y * scale - 2, 4, 4);
    // Player arrow.
    const p = game.player;
    c.save();
    c.translate(p.x * scale, p.y * scale);
    c.rotate(p.angle);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(6, 0); c.lineTo(-4, -4); c.lineTo(-4, 4);
    c.closePath(); c.fill();
    c.restore();
  }

  return {
    showBanner(text) {
      if (!nodes.banner) return;
      nodes.banner.textContent = text;
      nodes.banner.classList.add('show');
      bannerTimer = 2.6;
    },
    update(game, dt, hintText) {
      const p = game.player;
      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0 && nodes.banner) nodes.banner.classList.remove('show');
      }
      const hp = Math.max(0, Math.round(p.hp));
      if (nodes.hpFill) nodes.hpFill.style.width = `${hp}%`;
      set(nodes.hpText, 'hp', `HP ${hp}`);
      set(nodes.cash, 'cash', `$${Math.floor(p.cash).toLocaleString('en-US')}`);
      set(nodes.stars, 'stars', '★'.repeat(game.wanted) + '☆'.repeat(5 - game.wanted));
      if (nodes.stars) nodes.stars.classList.toggle('hot', game.wanted > 0);
      const obj = game.missions.objective();
      set(nodes.objTitle, 'objT', obj.title);
      set(nodes.objText, 'objX', obj.text);
      if (nodes.speedBox) nodes.speedBox.style.display = p.onFoot ? 'none' : 'block';
      if (!p.onFoot && p.car) set(nodes.speed, 'spd', `${Math.round(Math.abs(p.car.speed) * 0.45)} km/h`);
      set(nodes.zone, 'zone', game.zoneName);
      set(nodes.hint, 'hint', hintText || '');
      drawMinimap(game);
    },
  };
}
