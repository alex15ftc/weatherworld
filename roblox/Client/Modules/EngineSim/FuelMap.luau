--!strict
-- Fuel table, ignition cut and exhaust afterfire settings, shared by
-- EngineModel and RotaryEngineModel.
--
-- The table is fuel delivered against engine speed (rows) and throttle
-- (columns), as a percentage of a stoichiometric charge: 100 = lambda 1
-- (14.7:1 on petrol), 120 = 20% rich (12.25:1), 80 = lean (18.4:1). Lookups
-- interpolate bilinearly and clamp at the edges.
--
-- Whatever fuel a cycle does not burn leaves through the exhaust and can light
-- in the hot runner (afterfire): a spark cut with the injectors still running
-- (CutFuel > 0) sends whole charges there, a rich tune at closed throttle
-- leaves fuel that lights with the air that reverts at the tailpipe.
--
-- One live map per preset name (FuelMap.forPreset), so edits survive a preset
-- reload and are shared by every engine running that preset.

local Presets = require(script.Parent.Presets)

local FuelMap = {}

export type FuelMap = {
    Rpm: { number }, -- row breakpoints, ascending
    Load: { number }, -- column breakpoints, throttle 0..1, ascending
    Fuel: { { number } }, -- [row][column], % of stoichiometric
    -- Ignition cut (flat / no-lift shift): upshifts with the throttle past
    -- CutThrottle cut the spark for CutTime instead of needing a lift
    IgnitionCut: boolean,
    CutTime: number, -- s
    CutThrottle: number, -- 0..1
    CutFuel: number, -- % fuel injected while the spark is cut (0 = fuel cut too)
    LimiterDump: boolean, -- the rev limiter's spark cut uses CutFuel as well
    Afterfire: number, -- strength of the exhaust ignition (0 = off, 1 = default)
    -- how loud the loudest bangs get, x the engine's full scale (they skip the
    -- synthesizer's leveler, which keeps the engine just under full scale;
    -- a limiter holds them to this, quieter ones stay quieter)
    BangVolume: number,
}

local function defaultRpm(preset: Presets.EnginePreset): { number }
    -- 12 rows from 500 rpm to a little past the redline, on round numbers
    local top = math.ceil((preset.Redline + 500) / 250) * 250
    local rows = {}
    for i = 0, 11 do
        rows[i + 1] = math.floor((500 + (top - 500) * i / 11) / 50 + 0.5) * 50
    end
    return rows
end

FuelMap.DEFAULT_BANG_VOLUME = 5

local DEFAULT_LOAD = { 0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 1 }

-- Fresh map for a preset: flat 100% (the engine runs exactly as calibrated),
-- ignition cut off, fuel left on through a cut (so a cut pops) at 100%.
function FuelMap.new(preset: Presets.EnginePreset): FuelMap
    local rpm = defaultRpm(preset)
    local fuel = {}
    for r = 1, #rpm do
        fuel[r] = table.create(#DEFAULT_LOAD, 100)
    end
    return {
        Rpm = rpm,
        Load = table.clone(DEFAULT_LOAD),
        Fuel = fuel,
        IgnitionCut = false,
        CutTime = 0.12,
        CutThrottle = 0.5,
        CutFuel = 100,
        LimiterDump = false,
        Afterfire = 1,
        BangVolume = FuelMap.DEFAULT_BANG_VOLUME,
    }
end

local live: { [string]: FuelMap } = {}

function FuelMap.forPreset(preset: Presets.EnginePreset): FuelMap
    local map = live[preset.Name]
    if not map then
        map = FuelMap.new(preset)
        live[preset.Name] = map
    end
    return map
end

local function span(axis: { number }, x: number): (number, number)
    local n = #axis
    if x <= axis[1] then
        return 1, 0
    end
    if x >= axis[n] then
        return n - 1, 1
    end
    for i = 1, n - 1 do
        if x <= axis[i + 1] then
            return i, (x - axis[i]) / (axis[i + 1] - axis[i])
        end
    end
    return n - 1, 1
end

-- Fractional cell position (1-based) of an operating point, for the editor's
-- live marker.
function FuelMap.position(map: FuelMap, rpm: number, load: number): (number, number)
    local r, fr = span(map.Rpm, rpm)
    local c, fc = span(map.Load, load)
    return r + fr, c + fc
end

-- Fuel % at an operating point.
function FuelMap.lookup(map: FuelMap, rpm: number, load: number): number
    local r, fr = span(map.Rpm, rpm)
    local c, fc = span(map.Load, load)
    local f = map.Fuel
    local a = f[r][c] + (f[r][c + 1] - f[r][c]) * fc
    local b = f[r + 1][c] + (f[r + 1][c + 1] - f[r + 1][c]) * fc
    return a + (b - a) * fr
end

-- Share of the mixture's power a burn delivers at equivalence ratio phi
-- (1 = stoichiometric). Peaks a little rich, like a real engine's power
-- against mixture curve, and is exactly 1 at phi = 1.
local POWER: { { number } } = {
    { 0.5, 0.45 }, { 0.7, 0.78 }, { 0.85, 0.93 }, { 1.0, 1.0 }, { 1.12, 1.035 },
    { 1.25, 1.03 }, { 1.5, 0.95 }, { 2.0, 0.72 }, { 3.0, 0.35 }, { 5.0, 0.1 },
}

function FuelMap.power(phi: number): number
    if phi <= POWER[1][1] then
        return POWER[1][2] * phi / POWER[1][1]
    end
    for i = 2, #POWER do
        local b = POWER[i]
        if phi <= b[1] then
            local a = POWER[i - 1]
            return a[2] + (b[2] - a[2]) * (phi - a[1]) / (b[1] - a[1])
        end
    end
    return POWER[#POWER][2]
end

-- Chance a spark fails to light a mixture at phi (outside the flammable band).
function FuelMap.misfireChance(phi: number): number
    if phi < 0.75 then
        return math.clamp((0.75 - phi) / 0.2, 0, 1)
    elseif phi > 1.8 then
        return math.clamp((phi - 1.8) / 0.8, 0, 1)
    end
    return 0
end

---------------------------------------------------------------------------
-- Exhaust runner afterfire
---------------------------------------------------------------------------
-- Unburned fuel and air in one exhaust runner, in pV units (Pa m^3 at intake
-- temperature, i.e. amount of gas). It lights with a chance per second that
-- rises with the runner's temperature. The burn raises the runner's pressure
-- over a millisecond or two and vents out through the pipe: that pressure is
-- kept apart from the runner's own (Exhaust.pressure), and the simulator plays
-- it through the same delay lines, pipes and impulse response as the exhaust
-- but after the synthesizer's leveler, which would otherwise turn every bang
-- down to the engine's level the instant it arrived.

export type Exhaust = {
    fuel: number, -- unburned fuel, as the stoichiometric charge it could burn with
    air: number, -- unburned air
    heat: number, -- runner temperature proxy, ~1 after a full-load pull
    strength: number, -- strength of the last combustion that vented here
    burn: number, -- heat still to release from the current afterfire, pV
    burnRate: number,
    vent: number, -- s, how fast the afterfire's pressure vents down the pipe
    pressure: number, -- Pa, the afterfire's pressure rise in the runner
    ref: number, -- one full cylinder charge at 1 atm, pV
    system: number, -- the exhaust system (preset.ExhaustSystems) this runner feeds
    -- the last afterfire that lit, for the flames (AfterfireLog)
    litSize: number, -- mixture burned, as a share of a cylinder charge
    litPhi: number, -- its equivalence ratio: >1 rich (fuel past the runner's air), <1 lean
}

local HEAT_TAU = 1.5 -- s, runner temperature lag
local HAZARD = 700 -- per s, chance rate of lighting when fully hot
local BURN_TIME = 0.0015 -- s, for a tenth of a cylinder charge (bigger burns take longer)
local VENT_TIME = 0.003 -- s, likewise
-- Rise in pV per unit pV of stoichiometric mixture burned: a petrol charge's
-- heat (~9.8 x its pV at 300 K, with gamma 1.3) less what the runner's walls
-- and the mixing with cooler gas take.
local GAIN = 7
local MIN_BANG = 0.01 -- of a cylinder charge: less than this is not worth lighting

function FuelMap.newExhaust(ref: number, system: number?): Exhaust
    return { fuel = 0, air = 0, heat = 0, strength = 0, burn = 0, burnRate = 0, vent = VENT_TIME, pressure = 0, ref = ref,
        system = system or 1, litSize = 0, litPhi = 1 }
end

local function smoothstep(e0: number, e1: number, x: number): number
    local t = math.clamp((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)
end

-- One step. outShare: share of the runner's gas that left through its outlet
-- this step (takes the same share of the unburned mixture with it).
-- secondaryAir: share of any fuel in excess of the runner's air that finds
-- air anyway (reversion at the tailpipe at low flow). content: the runner's
-- gas in the same units (pr vr scaled to intake temperature); a flame only
-- spreads once the mixture is a fair share of it, so a slightly rich tune's
-- leftover fuel does not light. invV: 1 / the runner's volume. Updates
-- ex.pressure and returns whether a new afterfire lit.
function FuelMap.exhaustStep(ex: Exhaust, map: FuelMap, rng: Random, dt: number, outShare: number, secondaryAir: number, content: number, invV: number): boolean
    ex.heat += (ex.strength - ex.heat) * math.min(1, dt / HEAT_TAU)
    if outShare > 0 then
        local keep = 1 - math.min(outShare, 1)
        ex.fuel *= keep
        ex.air *= keep
    end
    local lit = false
    if ex.burn <= 0 and map.Afterfire > 0 and ex.fuel > MIN_BANG * ex.ref then
        local air = ex.air + secondaryAir * math.max(0, ex.fuel - ex.air)
        local combustible = math.min(ex.fuel, air)
        if combustible > MIN_BANG * ex.ref then
            local share = 2 * combustible / math.max(content, 1e-9)
            local hazard = HAZARD * smoothstep(0.35, 0.9, ex.heat) * smoothstep(0.1, 0.35, share)
            if rng:NextNumber() < hazard * dt then
                local reacted = combustible * (0.75 + 0.25 * rng:NextNumber())
                ex.litSize = reacted / ex.ref
                ex.litPhi = math.clamp(ex.fuel / math.max(ex.air, 1e-3 * ex.ref), 0.5, 2)
                ex.fuel -= reacted
                ex.air = math.max(0, ex.air - reacted)
                ex.burn = reacted * GAIN * map.Afterfire
                -- a bigger fireball burns and vents for longer: a deeper boom
                local size = math.clamp(math.sqrt(reacted / ex.ref / 0.1), 0.6, 2.5)
                ex.burnRate = ex.burn / (BURN_TIME * size * (0.6 + 0.8 * rng:NextNumber()))
                ex.vent = VENT_TIME * size * (0.7 + 0.6 * rng:NextNumber())
                lit = true
            end
        end
    end
    local p = ex.pressure * math.exp(-dt / ex.vent)
    if ex.burn > 0 then
        local release = math.min(ex.burn, ex.burnRate * dt)
        ex.burn -= release
        -- a turbulent flame front: the rate flickers step to step (the crackle)
        p += release * invV * (0.3 + 1.4 * rng:NextNumber())
    end
    ex.pressure = if p < 1e-3 then 0 else p
    return lit
end

---------------------------------------------------------------------------
-- Afterfire log: the engine notes every afterfire here for the flames
-- (Client/Modules/Afterfire). A ring of the last LOG_SIZE; a reader keeps the
-- count it has seen and reads what came after. Nothing is allocated per bang.
---------------------------------------------------------------------------
export type AfterfireLog = {
    count: number, -- afterfires logged so far
    system: { number },
    size: { number },
    phi: { number },
    heat: { number },
}

FuelMap.LOG_SIZE = 64

function FuelMap.newLog(): AfterfireLog
    local n = FuelMap.LOG_SIZE
    return { count = 0, system = table.create(n, 1), size = table.create(n, 0), phi = table.create(n, 1), heat = table.create(n, 0) }
end

function FuelMap.logAfterfire(log: AfterfireLog, ex: Exhaust)
    local i = log.count % FuelMap.LOG_SIZE + 1
    log.system[i] = ex.system
    log.size[i] = ex.litSize
    log.phi[i] = ex.litPhi
    log.heat[i] = ex.heat
    log.count += 1
end

---------------------------------------------------------------------------
-- Editing helpers (the ImGui editor)
---------------------------------------------------------------------------

-- Share of fuel in excess of the runner's air that burns with air from
-- outside anyway: some at any throttle (the plume at the tailpipe), more on a
-- closed throttle as the slow exhaust flow lets air revert up the pipe.
function FuelMap.secondaryAir(throttle: number): number
    return 0.3 + 0.5 * (1 - throttle) * (1 - throttle)
end

-- Unburned fuel and air a spark event sends to the exhaust because of the
-- fuel table, for a charge of `air` (pV) that the engine's own combustion
-- model would burn a share `burned` of at a stoichiometric mixture.
-- tableBurned: the share the fuel table's misfire roll left of that. Zero at
-- phi = 1, so an engine on a flat 100% table behaves exactly as calibrated
-- (its own misfires do not feed the afterfire).
function FuelMap.leftover(air: number, burned: number, phi: number, tableBurned: number): (number, number)
    local charge = air * burned
    local reacted = charge * tableBurned * math.min(phi, 1)
    return charge * phi - reacted, charge - reacted
end

FuelMap.MIN = 0
FuelMap.MAX = 300

function FuelMap.fill(map: FuelMap, fn: (rpm: number, load: number) -> number)
    for r, rpm in map.Rpm do
        for c, load in map.Load do
            map.Fuel[r][c] = math.clamp(fn(rpm, load), FuelMap.MIN, FuelMap.MAX)
        end
    end
end

function FuelMap.smooth(map: FuelMap)
    local f = map.Fuel
    local out = {}
    local rows, cols = #map.Rpm, #map.Load
    for r = 1, rows do
        out[r] = {}
        for c = 1, cols do
            local sum, w = f[r][c] * 4, 4
            for _, d in { { -1, 0 }, { 1, 0 }, { 0, -1 }, { 0, 1 } } do
                local rr, cc = r + d[1], c + d[2]
                if rr >= 1 and rr <= rows and cc >= 1 and cc <= cols then
                    sum += f[rr][cc]
                    w += 1
                end
            end
            out[r][c] = sum / w
        end
    end
    map.Fuel = out
end

-- Starting points for the editor's Tune menu. idle and redline come from the
-- engine.
FuelMap.Tunes = {
    { Name = "Stoichiometric (as calibrated)", Fn = function(_rpm: number, _load: number, _redline: number): number
        return 100
    end },
    { Name = "Rich at full throttle", Fn = function(_rpm: number, load: number, _redline: number): number
        local wot = math.clamp((load - 0.5) / 0.4, 0, 1)
        return 100 + 15 * wot
    end },
    { Name = "Decel crackle (rich overrun)", Fn = function(rpm: number, load: number, redline: number): number
        local wot = math.clamp((load - 0.5) / 0.4, 0, 1)
        local overrun = math.clamp((0.1 - load) / 0.1, 0, 1) * math.clamp((rpm - 1500) / 1000, 0, 1)
            * math.clamp((redline + 500 - rpm) / 1000, 0, 1)
        return 100 + 15 * wot + 90 * overrun
    end },
    { Name = "Lean (economy)", Fn = function(_rpm: number, load: number, _redline: number): number
        return 100 - 12 * math.clamp((0.6 - load) / 0.4, 0, 1)
    end },
}

return FuelMap
