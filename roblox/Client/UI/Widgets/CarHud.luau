--!strict
-- The driving HUD: while the local player drives a chase car, its speed (in the SpeedUnits
-- setting), gear and the miles they have driven (PlayerData Stats). Hidden by the ShowCarHud
-- setting. Mounted by UIController like every module in UI/Widgets.

local ReplicatedFirst = game:GetService("ReplicatedFirst")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local UI = script:FindFirstAncestor("UI")
local Hooks = UI.Hooks

local React = require(UI.Common.React)
local Speedometer = require(UI.Components.Speedometer)
local useTimer = require(Hooks.useTimer)
local useSetting = require(Hooks.useSetting)
local usePlayerData = require(Hooks.usePlayerData)
local Session = require(ReplicatedFirst.Modules.Vehicles.Session)
local Config = require(ReplicatedStorage.Shared.Vehicles.Config)

local MPH_TO_KMH = 1.609344

local function CarHud()
	local units = useSetting("SpeedUnits")
	local show = useSetting("ShowCarHud")
	local data, loaded = usePlayerData("Stats")
	local driving, setDriving = React.useState(false)
	local speed, setSpeed = React.useState(0)
	local gear, setGear = React.useState(1)

	useTimer(15, function()
		local sim = Session.Sim
		setDriving(sim ~= nil)
		if sim then
			local mph = sim.Speed * Config.STUDS_TO_MPH
			setSpeed(if units == "km/h" then mph * MPH_TO_KMH else mph)
			setGear(sim.Gear)
		end
	end, { units })

	return React.createElement(Speedometer, {
		Visible = show and driving,
		Speed = speed,
		Units = units,
		Gear = gear,
		MilesDriven = if loaded then data.Stats.MilesDriven else nil,
		Position = UDim2.new(1, -16, 1, -16),
		AnchorPoint = Vector2.one,
	})
end

return CarHud
