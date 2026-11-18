// The mission system: a small hook builder 2 fills with the five story
// missions. A mission def is { id, title, briefing, reward, start, update }.
// start(game, api) sets the scene; update(game, api) returns 'done', 'fail'
// or null each frame. api exposes setObjective, setMarker, say, complete,
// fail. The free-roam placeholder keeps the game playable with no mission.
//
// LESSON (first build): completeMission must clear state and pay the reward
// BEFORE any effect runs, and pay exactly once — the old bug paid every
// frame because effects ran before state cleared.
export function createMissionSystem(game) {
  const defs = new Map();
  let current = null; // { def, paid, data }
  let objective = { title: 'FREE ROAM', text: 'Explore Solmar Bay. Vera waits at the diner.' };
  let marker = null; // { x, y, label }
  let bannerQueue = [];

  const api = {
    setObjective(title, text) { objective = { title, text }; },
    setMarker(x, y, label) { marker = x == null ? null : { x, y, label }; },
    say(text) { bannerQueue.push(text); },
    complete() { completeCurrent(); },
    fail(reason) { failCurrent(reason); },
    data() { return current ? current.data : null; },
  };

  function setFreeRoam() {
    current = null;
    objective = { title: 'FREE ROAM', text: 'Explore Solmar Bay. Vera waits at the diner.' };
    const diner = game.city.landmarks.diner;
    marker = diner ? { x: diner.x, y: diner.y + 150, label: 'Vera\u2019s Diner' } : null;
  }

  function start(id) {
    const def = defs.get(id);
    if (!def) return false;
    current = { def, paid: false, data: {} };
    objective = { title: def.title.toUpperCase(), text: def.briefing };
    marker = null;
    bannerQueue.push(def.title);
    if (def.start) def.start(game, api);
    return true;
  }

  function completeCurrent() {
    if (!current || current.paid) return;
    // 1. Pay + record FIRST, so no effect can re-trigger the payout.
    current.paid = true;
    const def = current.def;
    game.player.cash += def.reward;
    if (!game.completedMissions.includes(def.id)) game.completedMissions.push(def.id);
    game.stats.missionsDone++;
    // 2. Then effects.
    game.combat.floater(game.player.x, game.player.y - 30, `+$${def.reward}`, '#06d6a0');
    game.audio.cash();
    game.audio.jingle();
    bannerQueue.push(`MISSION COMPLETE  +$${def.reward}`);
    const nextId = def.next;
    setFreeRoam();
    game.saveGame(true); // autosave after every mission
    if (nextId) start(nextId);
  }

  function failCurrent(reason) {
    if (!current) return;
    const title = current.def.title;
    current = null;
    bannerQueue.push(`${title.toUpperCase()} FAILED${reason ? ' — ' + reason : ''}`);
    game.audio.busted();
    setFreeRoam();
  }

  setFreeRoam();

  return {
    register(def) { defs.set(def.id, def); },
    has(id) { return defs.has(id); },
    start,
    abort() { if (current) { current = null; setFreeRoam(); } },
    completeCurrent,
    failCurrent,
    update(dt) {
      if (!current || !current.def.update) return;
      const result = current.def.update(game, api, dt);
      if (result === 'done') completeCurrent();
      else if (result === 'fail') failCurrent();
    },
    objective() { return objective; },
    marker() { return marker; },
    currentId() { return current ? current.def.id : null; },
    isActive() { return current !== null; },
    // The HUD drains the banner queue each frame.
    takeBanners() { const q = bannerQueue; bannerQueue = []; return q; },
  };
}
