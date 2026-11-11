-- AUTO GENERATED FILE!! DO NOT MANUALLY EDIT!!
-- Use the `Developer/CompileSettings` story to update this.

local EnumTypes = require(script.Parent.EnumTypes)
type GetEnumImpl<Setting, Options> = EnumTypes.GetEnumImpl<Setting, Options>
type SetEnumImpl<Setting, Options> = EnumTypes.SetEnumImpl<Setting, Options>
type GetEnumSettingImpl<T, Setting, Options> = EnumTypes.GetEnumSettingImpl<T, Setting, Options>
type GetEnumChangedSignalImpl<Setting, Options> = EnumTypes.GetEnumChangedSignalImpl<Setting, Options>

export type BoolName =
    | "__UNIMPLEMENTED (DO NOT USE YET)__"

export type ColorName =
    | "__UNIMPLEMENTED (DO NOT USE YET)__"

export type NumberName =
    -- Flight
    | "FlySpeed"
    | "FlyBoostSpeed"

export type StringName =
    | "__UNIMPLEMENTED (DO NOT USE YET)__"

-- Enums

-- GetEnum
export type GetEnum = GetEnumImpl<"__UNIMPLEMENTED (DO NOT USE YET)__", never>

-- SetEnum
export type SetEnum = SetEnumImpl<"__UNIMPLEMENTED (DO NOT USE YET)__", never>

-- GetEnumSetting<T>
export type GetEnumSetting<T> = GetEnumSettingImpl<T, "__UNIMPLEMENTED (DO NOT USE YET)__", never>

-- GetEnumChangedSignal
export type GetEnumChangedSignal = GetEnumChangedSignalImpl<"__UNIMPLEMENTED (DO NOT USE YET)__", never>

export type SettingName =
    | BoolName
    | ColorName
    | NumberName
    | StringName

return table.freeze({
    Enums = table.freeze({}),
})
