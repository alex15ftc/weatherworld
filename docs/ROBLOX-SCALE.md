# Roblox world scale and clock

Decided 2026-10-12. Nothing here is built yet; this is the method to use when the Roblox
side is started. No engine code changes are needed for it.

## Decision

Make chasing possible by **scaling space, not by changing the clock**.

- One Roblox place covers about **50 x 50 engine miles** (5 x 5 weather cells), not one
  10 x 10 mile cell. The 500 x 500 mile map is then about 100 places, not 2,500.
- A place still takes about **5 real minutes to drive across**.
- The clock is **fixed at 12x** (a simulated day in 2 real hours) at every hour of the day.
  It never speeds up or slows down, so a tornado someone is watching is never fast-forwarded.
- Place size and clock rate are **settings**, not constants, so they can be tuned in play.

Not chosen: a clock that changes with the time of day (a storm still producing after dark
would be fast-forwarded) and real-time pacing (too slow). A clock that slows near
tornado-producing storms is held in reserve; see "If tornadoes still feel too brief".

## Why

What matters for chasing is how fast the player moves compared with the storm. With a
5-minute crossing and a 12x clock, the player's speed in the storm's terms is simply the
number of engine miles a place covers:

| Engine miles per place | Player speed, storm terms | Places for the whole map |
|---|---|---|
| 10 | 10 mph | 2,500 |
| 25 | 25 mph | 400 |
| 40 | 40 mph | about 156 |
| 50 | 50 mph | 100 |
| 60 | 60 mph | about 70 |

Measured on the engine (60 days, three seeds, 2026-10-12): rotating storms move at a median
of 39 mph (25 to 53 for the middle 80%), and tornadoes at 41 mph (90th percentile 56). At 10
miles per place nobody can stay with a storm. At 50 the player paces or outruns most storms,
about as a real chaser does.

What 12x gives at this scale:

- Pick a target at 18Z and storms fire about 20 real minutes later.
- A storm rotates for about 5 real minutes before its first tornado (median 1 simulated hour).
- A storm lives 10 to 15 real minutes.
- A good target is a median of 41 miles from the day's nearest tornado: under one place.
- The whole map is about 50 real minutes across.

## What the Roblox side has to do

- **Blend between weather cells.** A place spans 5 x 5 cells; sample the fields and storm
  positions continuously, never per cell.
- **Compress distance about 10 times.** As a rough guide, a car at 100 studs per second
  crossing in 5 minutes makes a place 30,000 studs wide: about 600 studs per engine mile
  against about 5,700 at true scale.
- **Draw tornadoes larger than their true footprint.** A 100-yard tornado is about 35 studs
  at this scale. Keep the engine's width for damage and rating; scale the visible funnel up.
- **Squash storm height.** A storm 12 km tall beside a compressed 20-mile width looks like a
  thin tower. Compress the vertical by a smaller factor chosen by eye.
- **Interpolate in time.** Storm positions arrive in engine ticks; move them smoothly between.

## What scaling does not fix

These belong to the storm work that follows, not to the Roblox layer.

- **How long a tornado lasts.** At 12x the median tornado (4 simulated minutes) is 20 real
  seconds whatever the map scale. Tornado lifetimes need to be about 3 times longer (a
  median of about 1 real minute, 6 at the 90th percentile), set when the tornado life cycle
  is rebuilt.
- **The storm tick.** Storms move every 5 simulated minutes; a tornado travels about 3 miles
  between ticks. This needs to come down to about 1 minute.
- **Where the tornado is.** The engine places it 5 km behind the storm centre while the
  radar draws the hook and debris on the rear-right flank, 3 to 10 km away. Both must use
  one position before storms are built in 3D.

## Chasing playability (decided 2026-10-21)

At 12x a tornado on the ground for 48 simulated minutes is on screen for 4 real minutes. The
user ruled out both shortcuts: tornado ground time stays as the engine gives it, and the
shared clock is not slowed near tornadoes (so the earlier idea of easing it toward 6x is
dropped). What makes the window work instead, both built on the Roblox side:

1. **Travel compressed as much as time.** A tornado only feels short if getting into position
   takes real-world proportions of the window. Tune vehicle speeds against the place scale
   (about 50 engine miles a place) so crossing ground takes the same share of a chase it
   would in reality: a 1-2 hour real reposition becomes 5-10 real minutes, and a 48-minute
   tornado still gets its 4. Roads keep their 1.7-2x detour over a straight line.
2. **A visible life around the damage path.** The engine's ground time is the damage path
   only. Show what a chaser sees on either side of it, from the engine's own fields:
   - before touchdown: the wall cloud lowering and the funnel descending while the storm's
     tornado imminence rises (`tornado.genesisPotential`, `storm.lowRotation`);
   - after it lifts: the rope-out, the condensation funnel thinning and leaning as it decays
     (the lean is already in StormAppearance.js), for a minute or two of game time.

   Neither adds damage or changes when the engine says the tornado is down.

(Option 2 from the same discussion, earlier cues and intercept guidance such as "tornado
likely within N minutes" and projected tracks, was not chosen for now.)

## Standard scale in the main world (2026-10-27)

The main world now uses Roblox's standard scale, 1 stud = 0.28 m (about 3.57 studs per metre), the same as the storm lab. Settings are in `roblox/src/shared/World/Config.luau`.

- **Map distance stays squashed** at 1,000 studs per mile, about 5.75 times shorter than true. At true scale the map would be 2.9 million studs across, past float precision, and cars would need about 1,000 studs/s to keep up with storms on the 12x clock.
- **Buildings, roads, trees and the car** were already built at character scale (12-stud lanes, 11-stud storeys), which is close to true at 0.28 m. They are unchanged.
- **Ground height** is 3.57 studs/m (`STUDS_PER_METRE_VERTICAL`). The map's own slopes stay gentle (99.9% under 9%, the steepest 14%). The cuts the world makes (road beds, ditches, river channels and banks, lake shores) stay sized in studs to fit the props. Road shoulders widen up to 64 studs where the land stands well above or below a road. Farm barns and sheds sit on the lowest ground under them.
- **Gravity** is 9.81 m/s² = 35 studs/s² (`default.project.json`). Jump height is fixed at Roblox's 7.2 studs.
- **Storm heights and tornado widths** ease with distance (`Config.skyScaleAt`). Within `SKY_NEAR_MILES` (3) of the camera they are true (3.57 studs/m), so a cloud base and a funnel are true against houses. Beyond `SKY_FAR_MILES` (15) they drop to `SKY_FAR_STUDS_PER_METRE` (1), so distant storms sit at believable angles. At the standard scale, a storm 30 miles off would tower 60° up instead of a true 17°. Setting the far value to 0.62 would make distant angles exactly true. StormView, SkyLight and the debug camera all use the same scale for each storm.
- **Tornado sprites** taller or wider than the 2,048-stud part limit are laid as a grid of tiles (`TornadoArt`).
- **Hail near the camera** falls at its true speed in studs/s.
