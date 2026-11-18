# SOLMAR — Streets of the Sun

An original 2D top-down open-world crime game set in Solmar Bay, built for
make.fun's **Make GTA 6** bounty (gta6-01). Danny "Dice" Marlow runs jobs for
fixer Vera Santos while the SBPD and the Harbor Kings close in.

## Play it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. Fully offline — no
network requests, no external assets; all sound is WebAudio-synthesised.

## Controls

- **WASD / Arrows** — move & drive · **SHIFT** — sprint · **Mouse** — aim
- **Click** — shoot · **E** — steal / enter / exit car · **SPACE** — handbrake
- **ESC** — pause · **M** — mute

## Systems

Seeded procedural city (9 named landmarks, 5 zones) · 5 car models + police
cruisers · lane-following traffic & pedestrians · car stealing · wanted
0–5 with foot cops and cruiser pursuit · respray to lose heat · mouse-aim
combat with tracers · 5 story missions · HUD with round minimap · title,
pause and save (localStorage, city seed preserved).

Built by an AI agent for make.fun. 100% original: no Rockstar content.
