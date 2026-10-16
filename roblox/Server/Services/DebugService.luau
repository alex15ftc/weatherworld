--!strict
-- Test commands, as ConVars: type them in chat, or use the debug panel (DebugController, F2 in
-- Studio), which runs the same commands. All are CHEAT: in Studio everyone may use them; in a
-- live server only Developers (Shared/Settings/Backend/Admins.toml), or anyone once an operator
-- turns on sv_cheats.
--
--   /tp [player] <x> <y> | <town>   teleport to a map point (miles east and south of the map's
--                                   north-west corner, as WorldMap uses them) or a town
--   /totornado [player]             teleport to the recorded tornado
--   /tornado <x> <y> | reset        move the recorded tornado, or put it back
--   /car [player], /removecar [player]
--   /heal [player], /walkspeed [player] <speed>
--   sv_time <hours>                 time of day
--
-- [player] is a name or a selector (@p, @r, @f); without one a command acts on whoever ran it.

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage.Shared
local ConVar = require(Shared.ConVar)
local Debug = require(Shared.Debug)
local Config = require(Shared.World.Config)
local WorldMap = require(Shared.World.WorldMap)
local ExploreService = require(script.Parent.ExploreService)
local VehicleService = require(script.Parent.VehicleService)
local WeatherService = require(script.Parent.WeatherService)

local DebugService = {}

type CommandState = ConVar.CommandState
type Town = Debug.Town

local tp = ConVar.Declare("/tp", "{x} {y}", ConVar.CHEAT, "Teleports to a map point (miles) or a town.")
local toTornado = ConVar.Declare("/totornado", "", ConVar.CHEAT, "Teleports to the recorded tornado.")
local tornado = ConVar.Declare("/tornado", "{x} {y}", ConVar.CHEAT, "Moves the recorded tornado (miles), or 'reset'.")
local car = ConVar.Declare("/car", "", ConVar.CHEAT, "Gives a player a chase car.")
local removeCar = ConVar.Declare("/removecar", "", ConVar.CHEAT, "Takes a player's chase car away.")
local heal = ConVar.Declare("/heal", "", ConVar.CHEAT, "Heals a player.")
local walkSpeed = ConVar.Declare("/walkspeed", "{speed}", ConVar.CHEAT, "Sets a player's walk speed.")
local sv_time = ConVar.Declare("sv_time", 14, ConVar.CHEAT, "Time of day (hours).", 0, 24, 0.25)

local function round(value: number): string
	return tostring(math.round(value))
end

local function inMap(x: number?, y: number?): boolean
	return x ~= nil and y ~= nil and x >= 0 and y >= 0 and x <= Config.MAP_MILES and y <= Config.MAP_MILES
end

local function point(args: { string }): (number?, number?)
	return tonumber(args[1]), tonumber(args[2])
end

local function teleport(state: CommandState, x: number, y: number, label: string)
	local sx, sz = WorldMap.studsAt(x, y)
	for _, player in state.Players do
		local character = player.Character
		if character then
			state.NotifySuccess(`teleporting {player.DisplayName} to {label}...`)
			task.spawn(ExploreService.moveTo, character, sx, sz)
		end
	end
end

local function townNamed(text: string): Town?
	local wanted = text:lower()
	for _, settlement in WorldMap.meta.settlements do
		if settlement.name:lower():sub(1, #wanted) == wanted then
			return settlement
		end
	end
	return nil
end

local function eachHumanoid(state: CommandState, act: (Player, Humanoid) -> ()): boolean
	for _, player in state.Players do
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		if humanoid then
			act(player, humanoid)
		end
	end
	return #state.Players > 0
end

function DebugService.Init()
	tp:HookCommand(function(state)
		local x, y = point(state.Args)
		if inMap(x, y) then
			teleport(state, x :: number, y :: number, `{round(x :: number)}, {round(y :: number)} mi`)
			return true
		end
		local name = table.concat(state.Args, " ")
		local town = if name ~= "" then townNamed(name) else nil
		if not town then
			return false, "give a map point in miles (0 to " .. Config.MAP_MILES .. ") or a town's name"
		end
		teleport(state, town.x, town.y, town.name)
		return true
	end)

	toTornado:HookCommand(function(state)
		local x, y = WeatherService.tornadoMiles()
		if not x or not y then
			return false, "no tornado: the storm replay is not running"
		elseif not inMap(x, y) then
			return false, "the tornado is off the map"
		end
		teleport(state, x, y, "the tornado")
		return true
	end)

	tornado:HookCommand(function(state)
		if state.Args[1] == "reset" then
			local ok, message = WeatherService.moveReplay()
			return ok, if ok then "tornado back where the recording had it" else message
		end
		local x, y = point(state.Args)
		if not inMap(x, y) then
			return false, "that point is off the map"
		end
		local ok, message = WeatherService.moveReplay(x, y)
		return ok, if ok then `tornado moved to {round(x :: number)}, {round(y :: number)} mi` else message
	end)

	car:HookCommand(function(state)
		for _, player in state.Players do
			state.NotifySuccess(VehicleService.spawn(player), player)
		end
		return #state.Players > 0
	end)

	removeCar:HookCommand(function(state)
		for _, player in state.Players do
			VehicleService.remove(player)
		end
		return #state.Players > 0, "car removed"
	end)

	heal:HookCommand(function(state)
		return eachHumanoid(state, function(_player, humanoid)
			humanoid.Health = humanoid.MaxHealth
		end), "healed"
	end)

	walkSpeed:HookCommand(function(state)
		local speed = tonumber(state.Args[1])
		if not speed then
			return false, "give a speed"
		end
		return eachHumanoid(state, function(_player, humanoid)
			humanoid.WalkSpeed = math.clamp(speed, 0, 200)
		end), `walk speed {math.clamp(speed, 0, 200)}`
	end)

	sv_time:Connect(function()
		Lighting.ClockTime = math.clamp(sv_time:GetFloat(), 0, 24)
	end)

	-- The towns, for the debug panel's list (the map itself is server-only).
	Debug.AskTowns:Server():On(function(player: Player)
		if not player:HasTag("Developer") then
			return
		end
		local list: { Town } = {}
		for _, settlement in WorldMap.meta.settlements do
			table.insert(list, { name = settlement.name, kind = settlement.kind, x = settlement.x, y = settlement.y })
		end
		Debug.Towns:Server():Fire(player, list)
	end)
end

return DebugService
