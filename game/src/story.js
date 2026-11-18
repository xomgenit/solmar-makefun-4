// Vera's story: five missions, three hidden cash stashes, and the sports-car
// unlock. main.js registers this at world build; the mission system pays each
// reward exactly once (see missions.js) and autosaves after every mission.
// Mission 1 (and any retry after a failure) starts when the player walks up
// to Vera at the diner; later missions chain automatically via `next`.
import { createEnemy } from './actors.js';
import { createCar } from './vehicles.js';
import { dist2 } from './rng.js';

export const MISSION_ORDER = ['first-wheels', 'the-pickup', 'hot-delivery', 'payback', 'solmar-score'];

export const STASHES = [
  { id: 'stash-beach', x: 900, y: 3660, label: 'Palma Beach stash' },
  { id: 'stash-harbour', x: 3420, y: 540, label: 'East Harbour stash' },
  { id: 'stash-oldtown', x: 540, y: 2940, label: 'Old Town stash' },
];
const STASH_CASH = 300;

// The street in front of a landmark (same +190px door offset main.js uses).
function doorOf(game, name) {
  const lm = game.city.landmarks[name];
  return { x: lm.x, y: lm.y + 190 };
}
function near(player, spot, r) {
  return dist2(player.x, player.y, spot.x, spot.y) < r * r;
}

const MISSIONS = [
  {
    id: 'first-wheels',
    title: 'First Wheels',
    reward: 250,
    next: 'the-pickup',
    briefing: 'Vera needs wheels. Steal a car and bring it to Sunrise Garage.',
    start(game, api) {
      const d = api.data();
      d.stage = 0;
      const p = game.player;
      let best = null, bestD = Infinity;
      for (const c of game.cars) {
        if (!c.parked || c.wrecked) continue;
        const dd = dist2(p.x, p.y, c.x, c.y);
        if (dd < bestD) { bestD = dd; best = c; }
      }
      api.setObjective('FIRST WHEELS', 'Steal any car — press E next to one');
      if (best) api.setMarker(best.x, best.y, 'A car to steal');
    },
    update(game, api) {
      const d = api.data();
      const p = game.player;
      const garage = doorOf(game, 'garage');
      if (d.stage === 0) {
        if (!p.onFoot) {
          d.stage = 1;
          api.setObjective('FIRST WHEELS', 'Drive it to Sunrise Garage');
          api.setMarker(garage.x, garage.y, 'Sunrise Garage');
          api.say('Nice ride. Now get it to the garage.');
        }
      } else if (p.onFoot) {
        d.stage = 0;
        api.setObjective('FIRST WHEELS', 'Steal any car — press E next to one');
        api.setMarker(null);
      } else if (near(p, garage, 160)) {
        return 'done';
      }
      return null;
    },
  },
  {
    id: 'the-pickup',
    title: 'The Pickup',
    reward: 400,
    next: 'hot-delivery',
    briefing: "Pick up Vera's package at the docks, then bring it to the garage.",
    start(game, api) {
      const d = api.data();
      d.stage = 0;
      d.channel = 0;
      const docks = doorOf(game, 'docks');
      api.setObjective('THE PICKUP', 'Go to Solmar Docks');
      api.setMarker(docks.x, docks.y, 'Solmar Docks');
    },
    update(game, api, dt) {
      const d = api.data();
      const p = game.player;
      const docks = doorOf(game, 'docks');
      const garage = doorOf(game, 'garage');
      if (d.stage === 0) {
        if (near(p, docks, 130)) {
          d.stage = 1;
          d.channel = 0;
          api.setObjective('THE PICKUP', 'Grabbing the package… hold still');
          api.say('Package is here. Hold still.');
        }
      } else if (d.stage === 1) {
        if (!near(p, docks, 190)) {
          d.stage = 0;
          api.setObjective('THE PICKUP', 'Go to Solmar Docks');
          api.setMarker(docks.x, docks.y, 'Solmar Docks');
          return null;
        }
        d.channel += dt;
        api.setObjective('THE PICKUP', `Grabbing the package… ${Math.max(0, Math.ceil(1.5 - d.channel))}s`);
        if (d.channel >= 1.5) {
          d.stage = 2;
          api.setObjective('THE PICKUP', 'Deliver the package to Sunrise Garage');
          api.setMarker(garage.x, garage.y, 'Sunrise Garage');
          api.say('Package secured. Back to the garage.');
        }
      } else if (near(p, garage, 160)) {
        return 'done';
      }
      return null;
    },
  },
  {
    id: 'hot-delivery',
    title: 'Hot Delivery',
    reward: 600,
    next: 'payback',
    briefing: "Vera's buyer waits at the pier. 60 seconds. Don't be late.",
    start(game, api) {
      const d = api.data();
      d.timer = 60;
      const pier = doorOf(game, 'pier');
      api.setObjective('HOT DELIVERY', 'Reach Solmar Pier — 60s');
      api.setMarker(pier.x, pier.y, 'Solmar Pier');
    },
    update(game, api, dt) {
      const d = api.data();
      const p = game.player;
      const pier = doorOf(game, 'pier');
      d.timer -= dt;
      api.setObjective('HOT DELIVERY', `Reach Solmar Pier — ${Math.max(0, Math.ceil(d.timer))}s`);
      if (near(p, pier, 160)) {
        // Sports-car unlock: a coupe waits at the garage from now on.
        if (!game.sportsUnlocked) {
          game.sportsUnlocked = true;
          const garage = doorOf(game, 'garage');
          const coupe = createCar('coupe', garage.x + 90, garage.y, 0);
          coupe.playerOwned = true;
          game.cars.push(coupe);
          api.say('SPORTS CAR UNLOCKED — a coupe waits at Sunrise Garage');
        }
        return 'done';
      }
      if (d.timer <= 0) return 'fail';
      return null;
    },
  },
  {
    id: 'payback',
    title: 'Payback at the Pier',
    reward: 800,
    next: 'solmar-score',
    briefing: 'Harbor Kings took the pier. Take it back — all four of them.',
    start(game, api) {
      const d = api.data();
      const pier = game.city.landmarks.pier;
      // Open sand south of the pier building (the building spans pier.x ± 120,
      // pier.y - 100..+100) — never inside it, or shots hit the walls.
      const spots = [[-200, 140], [200, 140], [-120, 170], [120, 170]];
      d.squad = spots.map(([ox, oy]) => {
        const e = createEnemy(pier.x + ox, pier.y + oy);
        e.mission = 'payback';
        game.enemies.push(e);
        return e;
      });
      api.setObjective('PAYBACK AT THE PIER', 'Eliminate the Harbor Kings (4 left)');
      api.setMarker(pier.x, pier.y + 190, 'Solmar Pier');
    },
    update(game, api) {
      const d = api.data();
      const alive = d.squad.filter((e) => !e.dead).length;
      api.setObjective('PAYBACK AT THE PIER', `Eliminate the Harbor Kings (${alive} left)`);
      if (alive === 0) return 'done';
      return null;
    },
  },
  {
    id: 'solmar-score',
    title: 'The Solmar Score',
    reward: 1500,
    briefing: 'The big one. Crack the bank vault, then lose the heat at the hideout.',
    start(game, api) {
      const d = api.data();
      d.stage = 0;
      d.channel = 0;
      const bank = doorOf(game, 'bank');
      api.setObjective('THE SOLMAR SCORE', 'Get to Solmar National Bank');
      api.setMarker(bank.x, bank.y, 'Solmar National Bank');
    },
    update(game, api, dt) {
      const d = api.data();
      const p = game.player;
      const bank = doorOf(game, 'bank');
      const hideout = doorOf(game, 'hideout');
      if (d.stage === 0) {
        if (near(p, bank, 140)) {
          d.stage = 1;
          d.channel = 0;
          api.setObjective('THE SOLMAR SCORE', 'Cracking the vault… 8s');
          api.say('Keep the drill steady.');
        }
      } else if (d.stage === 1) {
        if (!near(p, bank, 210)) {
          d.stage = 0;
          api.setObjective('THE SOLMAR SCORE', 'Get to Solmar National Bank');
          api.setMarker(bank.x, bank.y, 'Solmar National Bank');
          return null;
        }
        d.channel += dt;
        api.setObjective('THE SOLMAR SCORE', `Cracking the vault… ${Math.max(0, Math.ceil(8 - d.channel))}s`);
        if (d.channel >= 8) {
          d.stage = 2;
          game.addHeat(60, p.x, p.y, true); // 3 stars — the alarm went off
          api.setObjective('THE SOLMAR SCORE', 'Lose the cops — get to the hideout');
          api.setMarker(hideout.x, hideout.y, "Dice's Hideout");
          api.say('VAULT OPEN — RUN!');
        }
      } else if (near(p, hideout, 160)) {
        return 'done';
      }
      return null;
    },
  },
];

export function registerStory(game) {
  game.stashSpots = STASHES;
  for (const def of MISSIONS) game.missions.register(def);
}

// Runs every frame in play state (called from main.js updateWorld, after the
// mission system): starts the next mission at Vera's diner and pays out
// hidden cash stashes, each exactly once.
export function storyTick(game) {
  const p = game.player;
  if (p.dead) return;
  if (!game.missions.isActive()) {
    const next = MISSION_ORDER.find((id) => !game.completedMissions.includes(id));
    if (next && near(p, doorOf(game, 'diner'), 140)) game.missions.start(next);
  }
  for (const s of STASHES) {
    if (game.stashesFound.includes(s.id)) continue;
    if (near(p, s, 70)) {
      game.stashesFound.push(s.id);
      p.cash += STASH_CASH;
      game.combat.floater(p.x, p.y - 30, `+$${STASH_CASH} STASH`, '#06d6a0');
      game.audio.cash();
      game.saveGame();
    }
  }
}

// Pulsing green "$" markers for unclaimed stashes (called from render).
export function drawStashes(ctx, game) {
  for (const s of STASHES) {
    if (game.stashesFound.includes(s.id)) continue;
    const pulse = 20 + Math.sin(game.time * 4 + s.x) * 4;
    ctx.save();
    ctx.strokeStyle = 'rgba(6,214,160,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(6,214,160,0.25)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#06d6a0';
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('$', s.x, s.y + 7);
    ctx.restore();
  }
}
