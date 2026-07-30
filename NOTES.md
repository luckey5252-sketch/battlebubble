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

Pages sends `Cache-Control: max-age=600`, so a phone can hold a stale copy for ten minutes
after a push. **`?v=` on the page URL only refreshes `index.html`** — `game.js` has its own
cache entry and stays stale, and a fresh-HTML/stale-JS pair crashes on the first missing
element. That killed a phone test on 2026-07-29: the DEPLOY button went dead because the
crash happened before `el('startBtn')` was bound at the bottom of `game.js`.

Two guards now exist, but the first one is a manual step:

- `index.html` loads `game.js?v=20260730a`. **Bump that string on every deploy** — it ties
  the two files to one cache entry so they can never be out of sync.
- Load errors now paint a red banner on screen (`showLoadError`, top of `game.js`) and the
  whole touch-control setup runs in a `try`, so a broken control can't unbind DEPLOY.

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
- One camera rig for both views (`updateCamera`): the camera looks along the aim vector
  and is *placed* from it, third person sitting 9.5m back and 1.6m over the right shoulder.
  A soft aim snap in `crosshairAim()` favours an enemy within `1.4 + 0.014·range` metres of
  the crosshair over the ground behind them — thumbs on glass are not mice.
- Shrinking magenta zone in 5 phases; touching it eliminates you.
- **Music (2026-07-29):** no audio files — it is scheduled WebAudio off the same
  `AudioContext` as the sfx, so there is nothing to download and nothing to license.
  Four bars of Am–F–C–G on a 25ms lookahead scheduler (notes queued 0.15s ahead so a
  frame hitch can't punch a hole in the beat). `musicIntensity()` picks one of four
  layerings from game state: menu = pad + arpeggio at 84bpm, drop adds kick and bass,
  the fight adds hats and snare, and the endgame (zone phase 3+ or ≤3 alive) piles on
  at 126bpm. `endGame()` swaps the loop for a win/lose sting. Toggle with `M` or the
  `#musicToggle` chip in the top-left HUD panel — the one tappable thing in the HUD.
  Audio can't start before a user gesture, so the first pointerdown/touch/key latches it.
- Full touch support: fixed 124px virtual joystick bottom-left, drag-to-look on the canvas,
  FIRE/KICK/JUMP/SCOPE/KNEEL buttons, tap-to-struggle. Auto-detected via `IS_TOUCH`
  (`?touch=1` forces it on a desktop); also lowers pixel ratio and shadow res.
  The Roblox-style dynamic thumbstick that replaced this on 2026-07-29 was reverted on
  2026-07-30 — the fixed stick is the layout we want. See "Tried and rejected" below.

## Bugs already fixed (don't reintroduce)

- **Aim went into the ground** (real fix 2026-07-29). The first attempt aimed at a point
  160m along the view ray, which only moved the problem: the old rig orbited the player and
  called `camera.lookAt(player_chest)`, so the screen centre was *always* the player's own
  body and the ray past him sloped into the dirt. The crosshair could not be placed on an
  enemy at 30m+ at all. Now `updateCamera()` builds one `fwd` vector from (`camYaw`,
  `camPitch`) and both **looks along it and positions from it** — third person pulls back
  over the right shoulder, scoping slides onto the eye — so the view ray *is* the aim ray.
  `crosshairAim()` then intersects that ray with the ground and the enemy hitboxes and
  returns the real hit point. Do not go back to a fixed aim distance.
- **Bubbles sailed over distant targets.** They are buoyant (`PROJ_RISE`), so a flat shot
  climbs ~2.8m over 80m. `crosshairAim()` now drops the aim point by exactly the rise the
  flight will undo. Both the aim and `updateProjectiles()` read the same `PROJ_RISE`.
- **Scope had no vertical aim.** Pitch was clamped to `[-0.15, 1.1]` and then
  `updateCamera()` floored it again at `0.05`, so the entire upward half of the range was
  dead — dragging up did nothing. One clamp now, `[PITCH_MIN, PITCH_MAX]` = `[-0.6, 1.0]`,
  applied in `addLook()` which every input path (keys, mouse, touch) goes through. Scoped
  aim is 34° up / 57° down, was 14° up with a dead zone at the top.
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
- **Roblox-style touch layout** (`db11ab4`, reverted 2026-07-30). The fixed joystick was
  replaced by a dynamic thumbstick over the left 46% of the screen (ring spawns under the
  thumb, follows it past the edge), round translucent-white buttons with a `.press` state,
  JUMP moved to the bottom-right corner with hold-to-hop, and KNEEL moved to the right
  cluster. The player tried it on a phone and asked for the previous scheme back, so the
  touch UI is again the fixed 124px `#joyBase` bottom-left, accent-outlined dark buttons,
  and KNEEL at `left:166px`. Kept from that commit: `?touch=1` (desktop test flag) and
  clearing `touchFire` in `endGame()`. Dropped with it: `playerJump()` / `touchJump`, so
  JUMP is a tap again and can't repeat while held.

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
- **Touch control feel is unvalidated.** Joystick position, button size and thumb reach,
  look-drag sensitivity, framerate. The SCOPE button is 54px, which was already suspected of
  being small. Needs a real verdict before guessing at changes — the scope aim pad above got
  built on a guess and thrown away.
- **No landscape / fullscreen handling.** Nothing calls `requestFullscreen()` and there's no
  orientation prompt. On a phone held portrait the 3D view is very cramped, and iOS Safari's
  address bar eats vertical space. Worth hooking fullscreen to the DEPLOY button and showing
  a "rotate to landscape" nudge on `orientation: portrait`. This was queued twice and is the
  most likely next task.
- Bots never kneel and don't use cover — they walk straight at you. Could add a duck
  reaction when a bubble is incoming.
