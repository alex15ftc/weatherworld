--!strict
-- EXAMPLE component. Pure presentation: everything comes in through props,
-- so it can be previewed in UI Labs (see StatusBar.story.luau).

local UI = script:FindFirstAncestor("UI")
local React = require(UI.Common.React)

export type Props = {
    Title: string,
    Detail: string?,
    Position: UDim2?,
    AnchorPoint: Vector2?,
}

local function StatusBar(props: Props)
    return React.createElement("Frame", {
        AutomaticSize = Enum.AutomaticSize.XY,
        AnchorPoint = props.AnchorPoint,
        Position = props.Position,
        BackgroundColor3 = Color3.fromRGB(20, 20, 24),
        BackgroundTransparency = 0.25,
    }, {
        Corner = React.createElement("UICorner", {
            CornerRadius = UDim.new(0, 8),
        }),

        Padding = React.createElement("UIPadding", {
            PaddingTop = UDim.new(0, 6),
            PaddingBottom = UDim.new(0, 6),
            PaddingLeft = UDim.new(0, 12),
            PaddingRight = UDim.new(0, 12),
        }),

        Layout = React.createElement("UIListLayout", {
            FillDirection = Enum.FillDirection.Horizontal,
            VerticalAlignment = Enum.VerticalAlignment.Center,
            SortOrder = Enum.SortOrder.LayoutOrder,
            Padding = UDim.new(0, 10),
        }),

        Title = React.createElement("TextLabel", {
            LayoutOrder = 1,
            AutomaticSize = Enum.AutomaticSize.XY,
            BackgroundTransparency = 1,
            FontFace = Font.fromEnum(Enum.Font.GothamBold),
            TextSize = 18,
            TextColor3 = Color3.new(1, 1, 1),
            Text = props.Title,
        }),

        Detail = if props.Detail
            then React.createElement("TextLabel", {
                LayoutOrder = 2,
                AutomaticSize = Enum.AutomaticSize.XY,
                BackgroundTransparency = 1,
                FontFace = Font.fromEnum(Enum.Font.Gotham),
                TextSize = 16,
                TextColor3 = Color3.fromRGB(190, 190, 200),
                Text = props.Detail,
            })
            else nil,
    })
end

return StatusBar
