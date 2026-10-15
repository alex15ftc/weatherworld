--!strict
-- Speed, gear and miles driven, bottom right while driving. Pure presentation: everything comes
-- in through props, so it can be previewed in UI Labs (Speedometer.story.luau).

local UI = script:FindFirstAncestor("UI")
local React = require(UI.Common.React)

export type Props = {
	Speed: number, -- in Units
	Units: string,
	Gear: number,
	MilesDriven: number?,
	Visible: boolean?,
	Position: UDim2?,
	AnchorPoint: Vector2?,
}

local function label(order: number, text: string, size: number, bold: boolean, colour: Color3): React.Node
	return React.createElement("TextLabel", {
		LayoutOrder = order,
		AutomaticSize = Enum.AutomaticSize.XY,
		BackgroundTransparency = 1,
		FontFace = Font.fromEnum(if bold then Enum.Font.GothamBold else Enum.Font.Gotham),
		TextSize = size,
		TextColor3 = colour,
		Text = text,
	})
end

local function Speedometer(props: Props)
	local dim = Color3.fromRGB(190, 190, 200)
	return React.createElement("Frame", {
		Visible = props.Visible ~= false,
		AutomaticSize = Enum.AutomaticSize.XY,
		AnchorPoint = props.AnchorPoint,
		Position = props.Position,
		BackgroundColor3 = Color3.fromRGB(20, 20, 24),
		BackgroundTransparency = 0.25,
	}, {
		Corner = React.createElement("UICorner", { CornerRadius = UDim.new(0, 8) }),
		Padding = React.createElement("UIPadding", {
			PaddingTop = UDim.new(0, 6),
			PaddingBottom = UDim.new(0, 6),
			PaddingLeft = UDim.new(0, 12),
			PaddingRight = UDim.new(0, 12),
		}),
		Layout = React.createElement("UIListLayout", {
			FillDirection = Enum.FillDirection.Horizontal,
			VerticalAlignment = Enum.VerticalAlignment.Bottom,
			SortOrder = Enum.SortOrder.LayoutOrder,
			Padding = UDim.new(0, 8),
		}),
		Speed = label(1, tostring(math.round(props.Speed)), 34, true, Color3.new(1, 1, 1)),
		Units = label(2, props.Units, 16, false, dim),
		Gear = label(3, `gear {props.Gear}`, 16, false, dim),
		Miles = if props.MilesDriven
			then label(4, `·  {string.format("%.1f", props.MilesDriven)} mi driven`, 16, false, dim)
			else nil,
	})
end

return Speedometer
