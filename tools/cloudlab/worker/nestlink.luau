-- The box side's link to a nest process (nest_worker.luau) over localhost HTTP, for
-- EngineRun.stepWithNestProcess (NestRemote). Each message is a JSON part and binary parts.
--   local link = NestLink.start(port, run.initRecord, run.initOpts)
--   run.nestLink = link   ...   link:stop()
-- The nest process runs Lune too: the LUNE environment variable names the executable ("lune" if
-- unset).
local net = require("@lune/net")
local serde = require("@lune/serde")
local process = require("@lune/process")
local task = require("@lune/task")

local NestLink = {}
NestLink.__index = NestLink

-- message framing: u32 JSON length, JSON, u32 part count, then each part as u32 length and bytes
-- (0xFFFFFFFF for a missing part)
function NestLink.frame(meta: any, parts: { buffer? }, n: number): string
	local out = { "" }
	local json = serde.encode("json", meta)
	out[1] = string.pack("<I4", #json) .. json .. string.pack("<I4", n)
	for i = 1, n do
		local p = parts[i]
		if p then
			table.insert(out, string.pack("<I4", buffer.len(p)))
			table.insert(out, buffer.tostring(p))
		else
			table.insert(out, string.pack("<I4", 0xFFFFFFFF))
		end
	end
	return table.concat(out)
end

function NestLink.unframe(s: string): (any, { buffer? })
	local jl = string.unpack("<I4", s, 1)
	local meta = serde.decode("json", string.sub(s, 5, 4 + jl))
	local o = 5 + jl
	local n = string.unpack("<I4", s, o)
	o += 4
	local parts = {}
	for i = 1, n do
		local len = string.unpack("<I4", s, o)
		o += 4
		if len == 0xFFFFFFFF then
			parts[i] = nil
		else
			parts[i] = buffer.fromstring(string.sub(s, o, o + len - 1))
			o += len
		end
	end
	return meta, parts
end

local function call(self: any, method: string, path: string, body: string?): string
	local res = net.request({ url = self.url .. path, method = method :: any, body = body })
	if not res.ok then
		error(string.format("nest process %s %s: %d %s", method, path, res.statusCode, string.sub(res.body or "", 1, 300)))
	end
	return res.body
end

function NestLink.start(port: number, record: any, opts: any): any
	local self = setmetatable({}, NestLink)
	self.url = "http://127.0.0.1:" .. port
	local token = tostring(math.random(1, 2 ^ 30)) .. tostring(os.time())
	self.child = process.create(process.env.LUNE or "lune", { "run", "tools/cloudlab/worker/nest_worker.luau", tostring(port), token }, { stdio = "inherit" } :: any)
	local ready = false
	for _ = 1, 100 do
		local ok, body = pcall(call, self, "GET", "/ping")
		if ok and body == token then
			ready = true
			break
		end
		task.wait(0.1)
	end
	if not ready then
		pcall(function()
			self.child:kill()
		end)
		error("nest process did not start on port " .. port .. " (port in use by another process?)")
	end
	call(self, "POST", "/init", serde.encode("json", { record = record, opts = opts }))
	return self
end

function NestLink.create(self: any, meta: any, region: buffer)
	call(self, "POST", "/create", NestLink.frame(meta, { region }, 1))
end

function NestLink.send(self: any, meta: any, old: buffer?, new: buffer)
	call(self, "POST", "/step", NestLink.frame(meta, { old, new }, 2))
end

-- the reply to the last step sent (waits for the nest process to finish it)
function NestLink.reply(self: any): (any, buffer, buffer)
	local meta, parts = NestLink.unframe(call(self, "GET", "/reply"))
	return meta, parts[1], parts[2] :: buffer
end

function NestLink.stop(self: any)
	pcall(call, self, "POST", "/stop")
	pcall(function()
		self.child:kill()
	end)
end

return NestLink
