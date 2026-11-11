--!strict
-- Request / response on top of Network events: the RemoteFunction replacement.
--
--   local GetThing = Network.Request("GetThing", function(id: unknown): string
--       assert(type(id) == "string")
--       return id
--   end)
--
--   -- server: the handler may yield; what it returns goes back to the asker
--   GetThing:Server():OnInvoke(function(player, id) return things[id] end)
--
--   -- client: a Promise of the handler's results (rejected if the handler errors or on timeout)
--   GetThing:Client():Invoke("sword"):andThen(print)
--   local ok, thing = GetThing:Client():Invoke("sword"):await()
--
-- Two events carry it: "<name>?" (client -> server: request id, args) and "<name>!"
-- (server -> client: request id, ok, results). The args are checked by the validator on the
-- server, like any event from a client.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Packages = ReplicatedStorage:WaitForChild("Packages")

local Network = require(Packages.network)
local Promise = require(script.Parent.Parent.Promise)

type Promise = Promise.Class

local Request = {}
Request.__index = Request

local ServerSide = {}
ServerSide.__index = ServerSide

local ClientSide = {}
ClientSide.__index = ClientSide

export type ServerClass = typeof(setmetatable({} :: {
	_ask: Network.Class<...any>,
	_reply: Network.Class<...any>,
}, ServerSide))

export type ClientClass = typeof(setmetatable({} :: {
	_ask: Network.Class<...any>,
	_pending: { [number]: (ok: boolean, ...any) -> () },
	_nextId: number,
}, ClientSide))

export type Class = typeof(setmetatable({} :: {
	Id: string,
	_server: ServerClass?,
	_client: ClientClass?,
}, Request))

-- The server's side. `handler` runs in its own thread for each request; its return values are sent
-- back. An error in it rejects the asker's Promise (the message is not sent: it may hold server
-- details), and is warned here.
function ServerSide.OnInvoke(self: ServerClass, handler: (player: Player, ...any) -> ...any)
	local reply = self._reply:Server()

	self._ask:Server():On(function(player: Player, id: any, ...: any)
		local args = table.pack(...)

		task.spawn(function()
			local results = table.pack(xpcall(handler, debug.traceback, player, table.unpack(args, 1, args.n)))

			if not results[1] then
				warn(`[Network] request {self._ask.Id} from {player.Name} failed: {results[2]}`)
				reply:Fire(player, id, false)
				return
			end

			if player.Parent then
				reply:Fire(player, id, true, table.unpack(results, 2, results.n))
			end
		end)
	end)
end

-- The client's side: asks the server and returns a Promise of its answer. With `timeout`
-- (seconds) the Promise is rejected with "timeout" if no answer comes in time.
function ClientSide.Invoke(self: ClientClass, ...: any): Promise
	local id = self._nextId
	self._nextId += 1

	local args = table.pack(...)

	return Promise.new(function(resolve, reject, onCancel)
		self._pending[id] = function(ok: boolean, ...: any)
			if ok then
				resolve(...)
			else
				reject(`request {self._ask.Id} failed on the server`)
			end
		end

		onCancel(function()
			self._pending[id] = nil
		end)

		self._ask:Client():Fire(id, table.unpack(args, 1, args.n))
	end)
end

-- Invoke, yielding for the answer: returns (true, results...) or (false, error), like
-- pcall(remoteFunction.InvokeServer, ...).
function ClientSide.Await(self: ClientClass, ...: any): (boolean, ...any)
	return self:Invoke(...):await()
end

function Request.Server(self: Class): ServerClass
	return assert(self._server, "Server requests can only be accessed from the server!")
end

function Request.Client(self: Class): ClientClass
	return assert(self._client, "Client requests can only be accessed from the client!")
end

local function new(name: string, validate: ((...unknown) -> ...any)?): Class
	local check: (...any) -> ...any = validate or function(...: any): ...any
		return ...
	end

	local ask = Network.Event(`{name}?`, function(id: unknown, ...: unknown)
		assert(type(id) == "number" and id == id // 1, "bad request id")
		return id, check(...)
	end)

	local reply = Network.Event(`{name}!`, function(id: unknown, ok: unknown, ...: unknown)
		assert(type(id) == "number" and type(ok) == "boolean")
		return id, ok, ...
	end)

	local self = setmetatable({
		Id = name,
		_server = nil :: ServerClass?,
		_client = nil :: ClientClass?,
	}, Request)

	if pcall(ask.Server, ask) then
		self._server = setmetatable({
			_ask = ask,
			_reply = reply,
		}, ServerSide)
	end

	if pcall(ask.Client, ask) then
		local client = setmetatable({
			_ask = ask,
			_pending = {},
			_nextId = 1,
		}, ClientSide)

		reply:Client():On(function(id: any, ok: any, ...: any)
			local resume = client._pending[id]

			if resume then
				client._pending[id] = nil
				resume(ok, ...)
			end
		end)

		self._client = client
	end

	return self
end

return table.freeze({
	new = new,
})
