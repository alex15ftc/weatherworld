-- Brings a copy of the published place up to date with a Rojo build of the repo, leaving
-- everything the repo does not hold as it is (the Studio place has content of its own: the car
-- template, assets, extras in ServerStorage; so a Rojo build is never uploaded itself).
--   lune run tools/worldmap/patch-place.luau <published.rbxl> <rojo build.rbxl> <out.rbxl>
-- What it does:
--   the map's data is replaced whole by the build's: ServerStorage.WorldData (tiles, road graph,
--   towns) and ReplicatedStorage.Shared.MapData (the players' map);
--   every script the build has is given the build's source where the place's differs, and a
--   script the place lacks is added beside its siblings (its parent must exist in the place).
-- Scripts only the place has are left alone. It prints what changed and the instance counts, for
-- checking before an upload; tools/worldmap/diff-place.luau lists the differences on their own.
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

-- The path of an instance from its place, as names.
local function pathOf(inst: any): { string }
	local names = {}
	while inst and inst.Parent do
		table.insert(names, 1, inst.Name)
		inst = inst.Parent
	end
	return names
end

local WHOLE = {
	{ "ServerStorage", "WorldData" },
	{ "ReplicatedStorage", "Shared", "MapData" },
}

local before = #place:GetDescendants()
local delta = 0
for _, path in WHOLE do
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

local same = function(a: string, b: string): boolean
	return (string.gsub(a, "\r\n", "\n")) == (string.gsub(b, "\r\n", "\n"))
end
local changed, added, orphans = {}, {}, {}
-- (parents before children, so a new module's own new children find it)
local scripts = {}
for _, d in build:GetDescendants() do
	if d:IsA("LuaSourceContainer") then
		table.insert(scripts, d)
	end
end
table.sort(scripts, function(a, b)
	return #pathOf(a) < #pathOf(b)
end)
for _, d in scripts do
	local path = pathOf(d)
	local name = table.concat(path, ".")
	local mine = find(place, path)
	if mine then
		if mine:IsA("LuaSourceContainer") and not same(mine.Source, d.Source) then
			mine.Source = d.Source
			table.insert(changed, name)
		end
	else
		local parentPath = table.clone(path)
		table.remove(parentPath)
		local parent = find(place, parentPath)
		if parent then
			local copy = d:Clone()
			-- (its children are added on their own turns)
			for _, child in copy:GetChildren() do
				child:Destroy()
			end
			copy.Parent = parent
			delta += 1
			table.insert(added, name)
		else
			table.insert(orphans, name)
		end
	end
end
for _, list in { { "scripts changed", changed }, { "scripts added", added }, { "scripts NOT added (no parent in the place)", orphans } } do
	print(`{list[1]}: {#list[2]}`)
	for _, name in list[2] do
		print("  " .. name)
	end
end
assert(#orphans == 0, "some of the build's scripts have no place to go: add their parents to the place first")

local after = #place:GetDescendants()
print(`place: {before} -> {after} instances (expected {before + delta})`)
assert(after == before + delta, "the instance count is not what the changes account for")

local bytes = roblox.serializePlace(place)
fs.writeFile(outPath, bytes)
print(`wrote {outPath}: {#bytes} bytes ({string.format("%.2f", #bytes / 1048576)} MiB; the upload limit is 10 MiB)`)
