local ReplicatedStorage = game:GetService("ReplicatedStorage")

local UI = script:FindFirstAncestor("UI")
local Packages = ReplicatedStorage:WaitForChild("Packages")

local React = require(UI.Common.React)
local ReactRoblox = require(UI.Common.ReactRoblox)
local UILabs = require(Packages["ui-labs"])
local StatusBar = require(script.Parent.StatusBar)

return UILabs.CreateReactStory({
    name = "StatusBar",
    react = React,
    reactRoblox = ReactRoblox,
    controls = {
        Title = "Intermission",
        Detail = "0:07  ·  3 wins",
    },
}, function(props)
    local c = props.controls

    return React.createElement(StatusBar, {
        Title = c.Title,
        Detail = if c.Detail ~= "" then c.Detail else nil,
        Position = UDim2.fromScale(0.5, 0.5),
        AnchorPoint = Vector2.one / 2,
    })
end)
