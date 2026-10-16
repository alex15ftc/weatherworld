local ReplicatedStorage = game:GetService("ReplicatedStorage")

local UI = script:FindFirstAncestor("UI")
local Packages = ReplicatedStorage:WaitForChild("Packages")

local React = require(UI.Common.React)
local ReactRoblox = require(UI.Common.ReactRoblox)
local UILabs = require(Packages["ui-labs"])
local Speedometer = require(script.Parent.Speedometer)

return UILabs.CreateReactStory({
	name = "Speedometer",
	react = React,
	reactRoblox = ReactRoblox,
	controls = {
		Speed = 72,
		Units = "mph",
		Gear = 4,
		MilesDriven = 12.4,
	},
}, function(props)
	local c = props.controls

	return React.createElement(Speedometer, {
		Speed = c.Speed,
		Units = c.Units,
		Gear = c.Gear,
		MilesDriven = c.MilesDriven,
		Position = UDim2.fromScale(0.5, 0.5),
		AnchorPoint = Vector2.one / 2,
	})
end)
