-- Lists the scripts that differ between a published place and a Rojo build of the repo: changed
-- (the source differs, line endings aside), only in the build, only in the place. For deciding
-- what a publish has to carry (tools/worldmap/patch-place.luau).
--   lune run tools/worldmap/diff-place.luau <published.rbxl> <rojo build.rbxl>
local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local function scripts(path: string): { [string]: string }
	local out = {}
	for _, d in roblox.deserializePlace(fs.readFile(path)):GetDescendants() do
		if d:IsA("LuaSourceContainer") then
			out[d:GetFullName()] = (string.gsub(d.Source, "\r\n", "\n"))
		end
	end
	return out
end

local published, build = scripts(process.args[1]), scripts(process.args[2])
local changed, added, extra = {}, {}, {}
for name, source in build do
	if published[name] == nil then
		table.insert(added, name)
	elseif published[name] ~= source then
		table.insert(changed, name)
	end
end
for name in published do
	if build[name] == nil then
		table.insert(extra, name)
	end
end
for _, list in { { "changed", changed }, { "only in the build", added }, { "only in the place", extra } } do
	table.sort(list[2])
	print(`{list[1]}: {#list[2]}`)
	for _, name in list[2] do
		if not string.find(name, "WorldData.", 1, true) then
			print("  " .. name)
		end
	end
end
