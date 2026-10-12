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

## If tornadoes still feel too brief

Only after the storm work, and only if play testing shows it: ease the shared clock from
12x toward 6x while a tornado-producing storm has players near it, at any hour, with a
smooth ramp and a visible indicator. Never tie the clock to the time of day.
