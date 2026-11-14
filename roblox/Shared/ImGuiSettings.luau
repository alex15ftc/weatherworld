--!strict
--[[
    ImGuiSettings — every user-tweakable knob for 4DBug/imgui-luau in one place.

    Usage (client):
        local G = require(ReplicatedStorage.Packages.ImGui)
        local ImGuiSettings = require(ReplicatedStorage.Shared.ImGuiSettings)

        G.ImGui.CreateContext()
        ImGuiSettings.ApplyIO(G)          -- before Init
        ImGuiSettings.ApplyFonts(G)       -- before Init (fonts are baked into the atlas)
        G.ImGui_ImplRoblox.Init(nil, ImGuiSettings.Backend.RenderScale)
        ImGuiSettings.ApplyBackend(G)
        ImGuiSettings.ApplyStyle(G)       -- can be re-run any time (live theme changes)

    Value formats:
        Vec2   -> { x, y }
        Color  -> "#RRGGBB" or "#RRGGBBAA"   (or { r, g, b, a } floats 0..1)
        Dir    -> "Left" | "Right" | "Up" | "Down" | "None"
        nil    -> leave the library default / base theme value alone

    Tip: ImGui.ShowStyleEditor() lets you tune these live, then copy the numbers back here.
]]

type Vec2 = { number }
type Color = string | { number }

local ImGuiSettings = {}

--------------------------------------------------------------------------------
-- THEME
--------------------------------------------------------------------------------
ImGuiSettings.Theme = {
    Base = "Dark", -- "Dark" | "Light" | "Classic" — applied first, then Colors overrides on top
    Scale = 1.0, -- multiplies every size/padding/rounding (style:ScaleAllSizes) + font DPI scale
}

--------------------------------------------------------------------------------
-- STYLE (sizes, spacing, rounding, borders, alignment, behaviour)
-- Defaults shown are the library defaults.
--------------------------------------------------------------------------------
ImGuiSettings.Style = {
    -- Fonts / global
    FontSizeBase = nil :: number?, -- 0 = use first loaded font's size
    FontScaleMain = 1.0, -- main text scale (expose to players as "UI text size")
    FontScaleDpi = nil :: number?, -- overwritten by Theme.Scale if left nil
    Alpha = 1.0, -- global opacity of everything
    DisabledAlpha = 0.60, -- extra opacity multiplier inside BeginDisabled()

    -- Windows
    WindowPadding = { 8, 8 },
    WindowRounding = 0.0,
    WindowBorderSize = 1.0,
    WindowBorderHoverPadding = 4.0, -- grab distance for resizing from window edges
    WindowMinSize = { 32, 32 },
    WindowTitleAlign = { 0.0, 0.5 }, -- {0.5, 0.5} = centered title
    WindowMenuButtonPosition = "Left", -- collapse arrow side: "Left" | "Right" | "None"

    -- Child windows / popups / tooltips
    ChildRounding = 0.0,
    ChildBorderSize = 1.0,
    PopupRounding = 0.0,
    PopupBorderSize = 1.0,

    -- Frames (buttons, inputs, sliders, checkboxes...)
    FramePadding = { 4, 3 },
    FrameRounding = 0.0,
    FrameBorderSize = 0.0,

    -- Layout spacing
    ItemSpacing = { 8, 4 },
    ItemInnerSpacing = { 4, 4 },
    CellPadding = { 4, 2 }, -- tables
    TouchExtraPadding = { 0, 0 }, -- bigger hitboxes (mobile)
    IndentSpacing = 21.0,
    ColumnsMinSpacing = 6.0,

    -- Scrollbars
    ScrollbarSize = 14.0,
    ScrollbarRounding = 9.0,
    ScrollbarPadding = 2.0,

    -- Sliders / grabs
    GrabMinSize = 12.0,
    GrabRounding = 0.0,
    LogSliderDeadzone = 4.0,

    -- Images
    ImageRounding = 0.0,
    ImageBorderSize = 0.0,

    -- Tabs
    TabRounding = 5.0,
    TabBorderSize = 0.0,
    TabMinWidthBase = 1.0,
    TabMinWidthShrink = 80.0,
    TabCloseButtonMinWidthSelected = -1.0, -- -1 always visible, 0 on hover
    TabCloseButtonMinWidthUnselected = 0.0,
    TabBarBorderSize = 1.0,
    TabBarOverlineSize = 1.0,

    -- Tables
    TableAngledHeadersAngle = math.rad(35), -- -50..50 degrees
    TableAngledHeadersTextAlign = { 0.5, 0.0 },

    -- Trees
    TreeLinesFlags = "DrawLinesNone", -- "DrawLinesNone" | "DrawLinesFull" | "DrawLinesToNodes"
    TreeLinesSize = 1.0,
    TreeLinesRounding = 0.0,

    -- Menus / selectables
    MenuItemRounding = 0.0,
    SelectableRounding = 0.0, -- upstream discourages changing this
    SelectableTextAlign = { 0.0, 0.0 },

    -- Buttons / color edit
    ButtonTextAlign = { 0.5, 0.5 },
    ColorButtonPosition = "Right", -- "Left" | "Right"
    ColorMarkerSize = 3.0,

    -- Text input
    InputTextCursorSize = 1.0,

    -- Separators
    SeparatorSize = 1.0,
    SeparatorTextBorderSize = 3.0,
    SeparatorTextAlign = { 0.0, 0.5 },
    SeparatorTextPadding = { 20.0, 3.0 },

    -- Drag & drop
    DragDropTargetRounding = 0.0,
    DragDropTargetBorderSize = 2.0,
    DragDropTargetPadding = 3.0,

    -- Docking
    DockingSeparatorSize = 2.0,
    DockingNodeHasCloseButton = true,

    -- Screen edges
    DisplaySafeAreaPadding = { 3, 3 },
    DisplayWindowPadding = { 19, 19 }, -- how much of a window must stay on-screen

    -- Rendering quality
    AntiAliasedLines = true,
    AntiAliasedLineEnds = false,
    AntiAliasedFill = true,
    CurveTessellationMaxError = 1.12,
    CircleTessellationMaxError = 0.30, -- lower = smoother circles / rounded corners
    MouseCursorScale = 1.0, -- only when IO.MouseDrawCursor = true

    -- Tooltip / hover timing (seconds)
    HoverStationaryDelay = 0.15,
    HoverDelayShort = 0.15,
    HoverDelayNormal = 0.40,
}

--------------------------------------------------------------------------------
-- COLORS — nil = keep base theme's color. Fill any of these in to override.
-- (Dark-theme defaults in comments.)
--------------------------------------------------------------------------------
ImGuiSettings.Colors = {
    -- Text
    Text = nil :: Color?, -- #FFFFFF
    TextDisabled = nil :: Color?, -- #808080
    TextLink = nil :: Color?,
    TextSelectedBg = nil :: Color?, -- #4296FA59
    InputTextCursor = nil :: Color?,

    -- Windows
    WindowBg = nil :: Color?, -- #0F0F0FF0
    ChildBg = nil :: Color?, -- #00000000
    PopupBg = nil :: Color?, -- #141414F0
    Border = nil :: Color?, -- #6E6E8080
    BorderShadow = nil :: Color?, -- #00000000
    MenuBarBg = nil :: Color?, -- #242424
    ModalWindowDimBg = nil :: Color?, -- #CCCCCC59

    -- Title bar
    TitleBg = nil :: Color?, -- #0A0A0A
    TitleBgActive = nil :: Color?, -- #294A7A
    TitleBgCollapsed = nil :: Color?, -- #00000082

    -- Frames (inputs, sliders, checkbox bg)
    FrameBg = nil :: Color?, -- #294A7A8A
    FrameBgHovered = nil :: Color?, -- #4296FA66
    FrameBgActive = nil :: Color?, -- #4296FAAB

    -- Buttons
    Button = nil :: Color?, -- #4296FA66
    ButtonHovered = nil :: Color?, -- #4296FA
    ButtonActive = nil :: Color?, -- #0F87FA

    -- Checkbox / slider
    CheckMark = nil :: Color?, -- #4296FA
    CheckboxSelectedBg = nil :: Color?,
    SliderGrab = nil :: Color?, -- #3D85E0
    SliderGrabActive = nil :: Color?, -- #4296FA

    -- Headers (CollapsingHeader, TreeNode, Selectable, MenuItem)
    Header = nil :: Color?, -- #4296FA4F
    HeaderHovered = nil :: Color?, -- #4296FACC
    HeaderActive = nil :: Color?, -- #4296FA

    -- Scrollbar
    ScrollbarBg = nil :: Color?, -- #05050587
    ScrollbarGrab = nil :: Color?, -- #4F4F4F
    ScrollbarGrabHovered = nil :: Color?, -- #696969
    ScrollbarGrabActive = nil :: Color?, -- #828282

    -- Separators / resize grips
    Separator = nil :: Color?,
    SeparatorHovered = nil :: Color?, -- #1A66BFC7
    SeparatorActive = nil :: Color?, -- #1A66BF
    ResizeGrip = nil :: Color?, -- #4296FA33
    ResizeGripHovered = nil :: Color?, -- #4296FAAB
    ResizeGripActive = nil :: Color?, -- #4296FAF2

    -- Tabs
    Tab = nil :: Color?,
    TabHovered = nil :: Color?,
    TabSelected = nil :: Color?,
    TabSelectedOverline = nil :: Color?,
    TabDimmed = nil :: Color?,
    TabDimmedSelected = nil :: Color?,
    TabDimmedSelectedOverline = nil :: Color?,

    -- Docking
    DockingPreview = nil :: Color?,
    DockingEmptyBg = nil :: Color?, -- #333333

    -- Plots
    PlotLines = nil :: Color?, -- #9C9C9C
    PlotLinesHovered = nil :: Color?, -- #FF6E59
    PlotHistogram = nil :: Color?, -- #E6B300
    PlotHistogramHovered = nil :: Color?, -- #FF9900

    -- Tables
    TableHeaderBg = nil :: Color?, -- #303033
    TableBorderStrong = nil :: Color?, -- #4F4F59
    TableBorderLight = nil :: Color?, -- #3B3B40
    TableRowBg = nil :: Color?, -- #00000000
    TableRowBgAlt = nil :: Color?, -- #FFFFFF0F

    -- Trees / drag-drop / misc
    TreeLines = nil :: Color?,
    DragDropTarget = nil :: Color?, -- #FFFF00E6
    DragDropTargetBg = nil :: Color?,
    UnsavedMarker = nil :: Color?,

    -- Keyboard / gamepad nav
    NavCursor = nil :: Color?, -- #4296FA
    NavWindowingHighlight = nil :: Color?, -- #FFFFFFB3
    NavWindowingDimBg = nil :: Color?, -- #CCCCCC33
}

--------------------------------------------------------------------------------
-- IO / BEHAVIOUR
--------------------------------------------------------------------------------
ImGuiSettings.IO = {
    -- ImGuiConfigFlags (true = on)
    Flags = {
        NavEnableKeyboard = true, -- arrow keys / tab between widgets
        NavEnableGamepad = false,
        NoMouse = false,
        NoMouseCursorChange = false,
        NoKeyboard = false,
        DockingEnable = true,
        IsTouchScreen = false,
    },

    -- Mouse / keys
    MouseDrawCursor = false, -- ImGui draws its own cursor
    MouseDoubleClickTime = 0.30,
    MouseDoubleClickMaxDist = 6.0,
    MouseDragThreshold = 6.0,
    MouseSingleClickDelay = 0.50,
    KeyRepeatDelay = 0.275,
    KeyRepeatRate = 0.050,
    FontAllowUserScaling = false, -- Ctrl+Wheel zooms a window's text

    -- Windows
    ConfigWindowsResizeFromEdges = true,
    ConfigWindowsMoveFromTitleBarOnly = false, -- true = can't drag windows by their body
    ConfigWindowsCopyContentsWithCtrlC = false,
    ConfigScrollbarScrollByPage = true,

    -- Text input
    ConfigInputTextCursorBlink = true,
    ConfigInputTextEnterKeepActive = false,
    ConfigDragClickToInputText = false, -- click a Drag widget to type a value
    ConfigInputTrickleEventQueue = true,
    ConfigMacOSXBehaviors = false,

    -- Navigation
    ConfigNavCursorVisibleAuto = true,
    ConfigNavCursorVisibleAlways = false,
    ConfigNavSwapGamepadButtons = false,
    ConfigNavMoveSetMousePos = false,
    ConfigNavCaptureKeyboard = true,
    ConfigNavEscapeClearFocusItem = true,
    ConfigNavEscapeClearFocusWindow = false,

    -- Docking (needs Flags.DockingEnable)
    ConfigDockingNoSplit = false,
    ConfigDockingNoDockingOver = false,
    ConfigDockingWithShift = false, -- hold Shift to dock
    ConfigDockingAlwaysTabBar = false,
    ConfigDockingTransparentPayload = false,

    -- .ini (window positions/docking layout). nil disables it.
    IniFilename = "imgui.ini" :: string?,

    -- Memory / errors / debug
    ConfigMemoryCompactTimer = 60.0, -- -1 disables
    ConfigErrorRecovery = true,
    ConfigErrorRecoveryEnableAssert = true,
    ConfigErrorRecoveryEnableDebugLog = true,
    ConfigErrorRecoveryEnableTooltip = true,
    ConfigDebugHighlightIdConflicts = false,
    ConfigDebugIsDebuggerPresent = false,
}

--------------------------------------------------------------------------------
-- FONTS — embedded: ProggyClean (default), ProggyTiny, ProggyForever,
-- Cousine-Regular, DroidSans, Karla-Regular, Roboto-Medium
--------------------------------------------------------------------------------
ImGuiSettings.Fonts = ({
    -- First entry becomes the default font. "Default" = ProggyClean 13px.
    { Name = "Default" },
    -- { Name = "Roboto-Medium", Size = 16.0 },
    -- { Name = "Cousine-Regular", Size = 14.0 },
} :: { { Name: string, Size: number? } })

--------------------------------------------------------------------------------
-- ROBLOX BACKEND (rendering / performance)
--------------------------------------------------------------------------------
ImGuiSettings.Backend = {
    RenderScale = 1.0, -- >1 = crisper (renders at higher res)
    RenderRate = 60, -- max tile redraws/sec; 0 = every frame
    BusyRenderRate = nil :: number?, -- lower redraw rate while dragging/scrolling (e.g. 30)
    RedrawBudgetMs = 0, -- ms per frame spent redrawing; 0 = unlimited
    TextProxy = false, -- hidden TextBox for OS typing/paste/copy (non-US layouts!)
    EditableImageCap = nil :: number?, -- bytes; default 64 MB shared budget
    Profiling = false, -- MicroProfiler labels (Ctrl+F6)
    StageTiming = false, -- per-stage timings in GetStats().Frame

    -- Parallel rasterizing on Actors. nil = off. Requires the Worker child script
    -- and rendering from PreSimulation (not RenderStepped).
    Parallel = nil :: { Actors: number?, MinTiles: number?, MinPixels: number?, MaxBytesPerPixel: number? }?,
}

--------------------------------------------------------------------------------
-- APPLY
--------------------------------------------------------------------------------
local function toVec4(G: any, c: Color): any
    if type(c) == "table" then
        return G.ImVec4(c[1], c[2], c[3], c[4] or 1)
    end
    local hex = (c :: string):gsub("^#", "")
    local r = tonumber(hex:sub(1, 2), 16) or 0
    local g = tonumber(hex:sub(3, 4), 16) or 0
    local b = tonumber(hex:sub(5, 6), 16) or 0
    local a = #hex >= 8 and (tonumber(hex:sub(7, 8), 16) or 255) or 255
    return G.ImVec4(r / 255, g / 255, b / 255, a / 255)
end

local DIR_KEYS = { WindowMenuButtonPosition = true, ColorButtonPosition = true }

function ImGuiSettings.ApplyStyle(G: any)
    local ImGui = G.ImGui
    local style = ImGui.GetStyle()

    local base = ImGuiSettings.Theme.Base
    if base == "Light" then
        ImGui.StyleColorsLight(style)
    elseif base == "Classic" then
        ImGui.StyleColorsClassic(style)
    else
        ImGui.StyleColorsDark(style)
    end

    for key, value in ImGuiSettings.Style :: any do
        if value == nil then
            continue
        elseif DIR_KEYS[key] then
            style[key] = G.ImGuiDir[value]
        elseif key == "TreeLinesFlags" then
            style[key] = G.ImGuiTreeNodeFlags[value]
        elseif type(value) == "table" then
            style[key] = G.ImVec2(value[1], value[2])
        else
            style[key] = value
        end
    end

    for name, value in ImGuiSettings.Colors :: any do
        local idx = G.ImGuiCol[name]
        if idx ~= nil and value ~= nil then
            style.Colors[idx] = toVec4(G, value)
        end
    end

    local scale = ImGuiSettings.Theme.Scale
    if scale ~= 1.0 then
        style:ScaleAllSizes(scale)
    end
    if ImGuiSettings.Style.FontScaleDpi == nil then
        style.FontScaleDpi = scale
    end
end

function ImGuiSettings.ApplyIO(G: any)
    local io = G.ImGui.GetIO()
    local flags = io.ConfigFlags
    for name, on in ImGuiSettings.IO.Flags do
        local bit = G.ImGuiConfigFlags[name]
        if bit then
            flags = if on then bit32.bor(flags, bit) else bit32.band(flags, bit32.bnot(bit))
        end
    end
    io.ConfigFlags = flags

    for key, value in ImGuiSettings.IO :: any do
        if key ~= "Flags" then
            io[key] = value
        end
    end
    -- nil entries are skipped by pairs, so apply IniFilename explicitly
    io.IniFilename = ImGuiSettings.IO.IniFilename
end

function ImGuiSettings.ApplyFonts(G: any)
    local fonts = G.ImGui.GetIO().Fonts
    for _, font in ImGuiSettings.Fonts do
        if font.Name == "Default" then
            fonts:AddFontDefault()
        else
            fonts:AddFontFromFileTTF("fonts/" .. font.Name .. ".ttf", font.Size or 13.0)
        end
    end
end

function ImGuiSettings.ApplyBackend(G: any)
    local B = G.ImGui_ImplRoblox
    local cfg = ImGuiSettings.Backend
    B.SetRenderScale(cfg.RenderScale)
    B.SetRenderRate(cfg.RenderRate)
    B.SetRedrawBudget(cfg.RedrawBudgetMs)
    if cfg.BusyRenderRate then
        B.SetBusyRenderRate(cfg.BusyRenderRate)
    end
    if cfg.EditableImageCap then
        B.SetEditableImageCap(cfg.EditableImageCap)
    end
    B.SetTextProxy(cfg.TextProxy)
    B.SetProfiling(cfg.Profiling)
    B.SetStageTiming(cfg.StageTiming)
    if cfg.Parallel then
        B.EnableParallel(cfg.Parallel)
    end
end

return ImGuiSettings
