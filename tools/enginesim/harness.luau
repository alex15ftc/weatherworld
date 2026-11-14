-- Minimal Roblox shim so the EngineSim modules run under Lune.
local fs = require("@lune/fs")
local luau = require("@lune/luau")

local Harness = {}

-- Extra globals for the modules (e.g. an Enum shim); set before Harness.require
Harness.globals = {} :: { [string]: any }

-- Compile the modules with native codegen, as `--!native` does in Roblox.
Harness.native = true

-- Random shim (Roblox API subset)
local RandomShim = {}
RandomShim.__index = RandomShim
function RandomShim.new(seed: number?)
    return setmetatable({}, RandomShim)
end
function RandomShim:NextNumber(a: number?, b: number?)
    local r = math.random()
    if a and b then
        return a + (b - a) * r
    end
    return r
end

local cache = {}
local makeNode

-- Pre-scan the module tree: fs calls yield, which is illegal inside metamethods.
local dirs, files, listing = {}, {}, {}
local function scan(path)
    dirs[path] = true
    listing[path] = fs.readDir(path)
    for _, name in listing[path] do
        local child = path .. "/" .. name
        if fs.isDir(child) then
            scan(child)
        elseif string.match(name, "%.luau$") then
            files[child] = fs.readFile(child)
        end
    end
end
scan("Client/Modules")

local function isDir(p)
    return dirs[p] == true
end
local function isFile(p)
    return files[p] ~= nil
end

local function loadModule(node)
    if cache[node.__path] ~= nil then
        return cache[node.__path]
    end
    local file = node.__file
    local src = files[file]
    -- The shims go in as locals (through the chunk's varargs) rather than as a
    -- custom environment: a replaced environment turns off Luau's builtin
    -- fastcalls and import caching, which made the tests several times slower
    -- than the same code in Roblox. The prefix stays on line 1, so line
    -- numbers in errors still match the file.
    local names = { "script", "require", "Random", "warn" }
    local values: { any } = {
        node,
        function(target)
            return loadModule(target)
        end,
        RandomShim,
        function(...) print("WARN", ...) end,
    }
    for k, v in Harness.globals do
        table.insert(names, k)
        table.insert(values, v)
    end
    local prefix = "local " .. table.concat(names, ", ") .. " = ...; "
    local fn = luau.load(prefix .. src, { debugName = file, codegenEnabled = Harness.native })
    local result = fn(table.unpack(values))
    cache[node.__path] = result
    return result
end

function makeNode(path: string, parentNode)
    local node = { __path = path }
    local file
    if isDir(path) then
        if isFile(path .. "/init.luau") then
            file = path .. "/init.luau"
        end
    else
        file = path .. ".luau"
    end
    node.__file = file
    node.Name = string.match(path, "([^/]+)$")

    local mt = {}
    mt.__index = function(t, key)
        if key == "Parent" then
            if parentNode then return parentNode end
            local parentPath = string.match(path, "^(.*)/[^/]+$")
            local p = makeNode(parentPath, nil)
            rawset(t, "Parent", p)
            return p
        elseif key == "WaitForChild" or key == "FindFirstChild" then
            return function(self, name)
                local child = path .. "/" .. name
                if isDir(child) or isFile(child .. ".luau") then
                    return makeNode(child, node)
                end
                return nil
            end
        elseif key == "GetChildren" then
            return function()
                local list = {}
                for _, name in listing[path] do
                    local base = string.match(name, "^(.*)%.luau$")
                    if base and base ~= "init" then
                        table.insert(list, makeNode(path .. "/" .. base, node))
                    elseif isDir(path .. "/" .. name) then
                        table.insert(list, makeNode(path .. "/" .. name, node))
                    end
                end
                return list
            end
        elseif key == "IsA" then
            return function(_, class)
                return class == "ModuleScript" and file ~= nil
            end
        end
        local child = path .. "/" .. key
        if isDir(child) or isFile(child .. ".luau") then
            local n = makeNode(child, node)
            rawset(t, key, n)
            return n
        end
        error("no child " .. key .. " under " .. path)
    end
    return setmetatable(node, mt)
end

function Harness.require(path: string)
    return loadModule(makeNode(path, nil))
end

Harness.Random = RandomShim

return Harness
