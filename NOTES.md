# Battle Bubble — work notes

Last worked on: 2026-07-26

A soap-bubble battle royale in the browser. Three.js (r152, loaded from CDN), no build
step — open `index.html` directly, or serve the folder to play on a phone.

**Live:** https://luckey5252-sketch.github.io/battlebubble/ — GitHub Pages, deployed from
`main` at repo root (no Actions workflow, `build_type: legacy`). Pushing to `main` republishes;
the build takes ~30s. Repo: `luckey5252-sketch/battlebubble` (public).

The site is served by GitHub, not this PC — it stays up with the machine off. A local
`python -m http.server 8000 --bind 0.0.0.0` also works for same-wifi testing (Windows
Firewall already allows Python inbound on the Public profile), but it is redundant now
and was shut down. Note that even offline-ish local serving still needs internet, since
three.js comes from the jsdelivr CDN.

Sending the raw `index.html` to a phone does NOT work — the game lives in `game.js`,
pulled in by a relative `<script src>`, so a lone HTML file renders the start screen and
nothing else. Always use the live URL.

Pages sends `Cache-Control: max-age=600`, so a phone can hold a stale `game.js` for ten
minutes after a push. Bust it with `?v=2` on the URL or an incognito tab.

## Files

- `index.html` — HUD, overlays, all CSS, touch-control markup. Claude Code look:
  monospace, dark panels (`#262624`), orange accent (`#D97757`), magenta zone (`#ff3ca0`).
- `game.js` — everything else. Rough order: config → sfx → scene/island → character
  factory → game state → trap/eliminate → shoot/kick → input (keyboard, mouse, touch)
  → bot AI → per-character update → projectiles → zone → minimap → camera → game flow
  → main loop.

## What's built

- 10 fighters (player + 9 bots) drop from the sky inside bubbles, steerable on the way down.
- 26 bubble guns scattered on the island, 12 ammo each; you land unarmed.
- Shooting traps a target in a floating bubble for 5s; kicking (F) a trapped target
  pops them out of the game. Struggling (mash Space / tap screen) shortens the trap and
  opens a dodge window against kicks.
- Trees and rocks block bubbles — real cover. Obstacles carry a height (`o.h`) so
  projectiles only stop below the treeline.
- Kneel (C/Ctrl) drops and shrinks the hitbox so bubbles fly overhead; costs 45% speed.
- Scope (RClick/Shift) switches to a first-person view at eye height, FOV 65 → 20,
  aim sensitivity scales with FOV, player model hidden so it doesn't fill the scope.
- Shrinking magenta zone in 5 phases; touching it eliminates you.
- Full touch support, Roblox-style (2026-07-29): the left 46% of the screen is `#moveZone`,
  a **dynamic thumbstick** — the ring spawns wherever your thumb lands and slides along if you
  drag past its edge (52px radius, 7px deadzone); a dashed "home" ring hints at it while idle.
  The right side is drag-to-look. Buttons are round translucent-white discs: JUMP (arrow icon,
  bottom-right corner, hold to keep hopping), FIRE (orange, primary), SCOPE / KICK / KNEEL on a
  thumb arc above. `?touch=1` on the URL forces this layout on a desktop to check the layout.
  Auto-detected via `IS_TOUCH`; also lowers pixel ratio and shadow res.

## Bugs already fixed (don't reintroduce)

- **Aim went into the ground.** The third-person camera looks *down* at the player, so
  firing along `camera.getWorldDirection()` sent bubbles into the dirt a few metres ahead.
  Fixed with `crosshairAim()`: take a point 160m along the view ray and aim the muzzle at
  *that*. `shoot(ch, dir, aimPoint)` — bots pass `dir` only, the player passes both.
- **Scope looked broken.** FOV was changing but the camera stayed 9.5m behind, so it just
  magnified the player's own back. Fixed by lerping to a first-person eye position.
- **Legs spun in circles when kneeling.** The idle pose decayed `rotation.x *= 0.8` while
  the kneel added `+= 1.5` each frame, so it converged on 7.5 rad. Walk cycle now lives in
  `ch.poseLegL/R`, `ch.poseArmL/R` and the kneel offset is applied as an assignment.
- **Start button kept keyboard focus**, so Space/Enter re-triggered `startGame()` mid-match
  and spawned duplicate characters. Guarded with a `gameState !== 'menu'` check + `blur()`.

## Tried and rejected (don't rebuild these)

- **SCOPE as a touch aim pad** (`eb5a109`, reverted in `648e35f`). Holding the SCOPE button
  and sliding the *same* thumb to steer the crosshair, so aiming while zoomed didn't need a
  second thumb on the canvas. It worked technically — a touch keeps targeting the element it
  started on, so sliding off the 54px button didn't break the drag — but the player tested it
  on a phone and preferred the original: hold SCOPE, drag the canvas separately. `game.js` is
  now byte-identical to the pre-attempt version. If scope ergonomics come up again, the thing
  to question is the zoom depth (FOV 65 → 20) or making SCOPE a toggle like KNEEL, **not**
  merging aim into the button.

## Current difficulty tuning

Lowered several times at the player's request — it was still too hard as of the last pass.

| Knob | Value |
|---|---|
| `PLAYER_GRACE` | 35s — bots skip the player entirely in `nearestEnemy()` |
| `MOVE_SPEED` / `BOT_SPEED` | 13.5 / 8.2 |
| `TRAP_TIME` | 5s (struggle takes 0.4s off per press) |
| Bot fire range / interval / spread | 24m / 3.0–5.5s / 0.26 + 0.006·dist |
| Bot hunt range | 26m |
| Player hit radius | 1.6 standing, 0.8 kneeling (bots 2.2) |
| Player kick dodge | 90% (bots 40%) |
| Post-escape invuln | 4s player, 2.5s bots |
| Zone | first shrink at 40s, 5 slow phases |

## Ideas / open threads for next session

Where things stand: the game is live and confirmed running on a real phone (2026-07-26) —
first time ever. Only the *launch* is confirmed. Nobody has reported back on how the touch
controls actually feel, or played enough matches to judge difficulty. Both of the top items
below are blocked on the same thing: actually playing a few rounds on the phone.

- **Playtest the difficulty.** The tuning table below has been lowered several times and
  *still* has never been confirmed playable. If it's too hard, cut `BOT_COUNT` from 9 or
  raise `PLAYER_GRACE`.
- **Touch control feel is unvalidated.** The Roblox-style rework (dynamic thumbstick, 62px
  action buttons, corner JUMP) has not been played on a phone yet — it replaced a fixed
  124px joystick that was never validated either. Look-drag sensitivity and framerate are
  still unmeasured. Needs a real verdict before guessing at changes — the scope aim pad above
  got built on a guess and thrown away.
- **No landscape / fullscreen handling.** Nothing calls `requestFullscreen()` and there's no
  orientation prompt. On a phone held portrait the 3D view is very cramped, and iOS Safari's
  address bar eats vertical space. Worth hooking fullscreen to the DEPLOY button and showing
  a "rotate to landscape" nudge on `orientation: portrait`. This was queued twice and is the
  most likely next task.
- Bots never kneel and don't use cover — they walk straight at you. Could add a duck
  reaction when a bubble is incoming.
