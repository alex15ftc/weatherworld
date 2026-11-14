-- Puts the world map and the world generator of a Rojo build into a copy of the published place,
-- leaving everything else in the place as it is (the Studio place holds content the repo does
-- not, so a Rojo build is never uploaded itself).
--   lune run tools/worldmap/patch-place.luau <published.rbxl> <rojo build.rbxl> <out.rbxl>
-- Replaced, each by the build's copy: ServerStorage.World (the generator), ServerStorage.WorldData
-- (the map's tiles and road graph) and ReplicatedStorage.Shared.MapData (the players' map).
-- Prints the instance counts before and after and what changed, for checking before an upload.
local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local publishedPath, buildPath, outPath = process.args[1], process.args[2], process.args[3]
assert(publishedPath and buildPath and outPath, "usage: patch-place.luau <published.rbxl> <rojo build.rbxl> <out.rbxl>")

local place = roblox.deserializePlace(fs.readFile(publishedPath))
local build = roblox.deserializePlace(fs.readFile(buildPath))

local function find(root: any, path: { string }): any
	local at = root
	for _, name in path do
		at = at and at:FindFirstChild(name)
	end
	return at
end

local TARGETS = {
	{ "ServerStorage", "World" },
	{ "ServerStorage", "WorldData" },
	{ "ReplicatedStorage", "Shared", "MapData" },
}

local before = #place:GetDescendants()
local delta = 0
for _, path in TARGETS do
	local old, new = find(place, path), find(build, path)
	local name = table.concat(path, ".")
	assert(old, `the published place has no {name}`)
	assert(new, `the build has no {name}`)
	local had, has = #old:GetDescendants(), #new:GetDescendants()
	local parent = old.Parent
	old:Destroy()
	new.Parent = parent
	delta += has - had
	print(`{name}: {had} -> {has} instances inside`)
end
local after = #place:GetDescendants()
print(`place: {before} -> {after} instances (expected {before + delta})`)
assert(after == before + delta, "the instance count is not what the replacements account for")

local bytes = roblox.serializePlace(place)
fs.writeFile(outPath, bytes)
print(`wrote {outPath}: {#bytes} bytes ({string.format("%.2f", #bytes / 1048576)} MiB; the upload limit is 10 MiB)`)
