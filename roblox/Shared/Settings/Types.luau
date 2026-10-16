-- AUTO GENERATED FILE!! DO NOT MANUALLY EDIT!!
-- Use the `Developer/CompileSettings` story to update this.

local EnumTypes = require(script.Parent.EnumTypes)
type GetEnumImpl<Setting, Options> = EnumTypes.GetEnumImpl<Setting, Options>
type SetEnumImpl<Setting, Options> = EnumTypes.SetEnumImpl<Setting, Options>
type GetEnumSettingImpl<T, Setting, Options> = EnumTypes.GetEnumSettingImpl<T, Setting, Options>
type GetEnumChangedSignalImpl<Setting, Options> = EnumTypes.GetEnumChangedSignalImpl<Setting, Options>

export type BoolName =
    -- Driving
    | "SteeringAssist"
    | "ShowCarHud"

export type ColorName =
    | "__UNIMPLEMENTED (DO NOT USE YET)__"

export type NumberName =
    | "__UNIMPLEMENTED (DO NOT USE YET)__"

export type StringName =
    -- Driving
    | "SpeedUnits"

-- Enums
export type EnumSpeedUnits =
    | "mph"
    | "km/h"

-- GetEnum
export type GetEnum =
    -- Driving
    & GetEnumImpl<"SpeedUnits", EnumSpeedUnits>

-- SetEnum
export type SetEnum =
    -- Driving
    & SetEnumImpl<"SpeedUnits", EnumSpeedUnits>

-- GetEnumSetting<T>
export type GetEnumSetting<T> =
    -- Driving
    & GetEnumSettingImpl<T, "SpeedUnits", EnumSpeedUnits>

-- GetEnumChangedSignal
export type GetEnumChangedSignal =
    -- Driving
    & GetEnumChangedSignalImpl<"SpeedUnits", EnumSpeedUnits>

export type SettingName =
    | BoolName
    | ColorName
    | NumberName
    | StringName

return table.freeze({
    Enums = table.freeze({
        SpeedUnits = newproxy() :: EnumSpeedUnits,
    })
})
