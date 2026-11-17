--!strict
-- The building damage records as BuildingDamageService keeps and sends them (2026-11-17): one
-- record is building n of its chunk, the degree that failed and the wind's direction (byte),
-- written "n,degree,dir;..." in the DataStore and in the messages to the other servers.
local DamageMessages = {}

export type Rec = { n: number, degree: number, dir: number }
-- what waits to go to the other servers: a chunk's records, and whether they happened live
export type Outgoing = { c: string, list: { Rec }, live: boolean }

function DamageMessages.encode(list: { Rec }): string
	local out = table.create(#list)
	for i, r in list do
		out[i] = `{r.n},{r.degree},{r.dir}`
	end
	return table.concat(out, ";")
end

function DamageMessages.decode(s: string?): { Rec }
	local out = {}
	for n, degree, dir in string.gmatch(s or "", "(%d+),(%d+),(%d+)") do
		table.insert(out, { n = tonumber(n) :: number, degree = tonumber(degree) :: number, dir = tonumber(dir) :: number })
	end
	return out
end

-- add's records not yet in into (a union: a degree once failed stays failed); returns the new ones
function DamageMessages.merge(into: { Rec }, add: { Rec }): { Rec }
	local have = {}
	for _, r in into do
		have[r.n * 64 + r.degree] = true
	end
	local fresh = {}
	for _, r in add do
		local k = r.n * 64 + r.degree
		if not have[k] then
			have[k] = true
			table.insert(into, r)
			table.insert(fresh, r)
		end
	end
	return fresh
end

-- One message's entries from the front of outgoing (taken off it), as many as fit in maxBytes
-- of JSON: { { chunk, records, live 1/0 } }; a chunk's records too many for one message are
-- split over several. Nil when nothing waits.
function DamageMessages.pack(outgoing: { Outgoing }, maxBytes: number): { any }?
	if #outgoing == 0 then
		return nil
	end
	local batch, used = {}, 40
	while #outgoing > 0 do
		local o = outgoing[1]
		local take, d = #o.list, DamageMessages.encode(o.list)
		while take > 1 and #d + #o.c + 16 > maxBytes - 40 do
			take = math.max(1, take // 2)
			d = DamageMessages.encode(table.move(o.list, 1, take, 1, {}))
		end
		local size = #d + #o.c + 16
		if #batch > 0 and used + size > maxBytes then
			break
		end
		table.insert(batch, { o.c, d, if o.live then 1 else 0 })
		used += size
		if take < #o.list then
			o.list = table.move(o.list, take + 1, #o.list, 1, {})
		else
			table.remove(outgoing, 1)
		end
	end
	return batch
end

return DamageMessages
