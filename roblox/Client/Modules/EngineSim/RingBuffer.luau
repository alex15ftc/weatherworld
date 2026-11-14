--!strict
--!native
-- Port of engine-sim include/ring_buffer.h (RingBuffer<T>).
-- Semantics are kept exactly, including the quirk that writing `capacity`
-- elements without reading wraps the write index onto the start index and the
-- buffer reports size 0 again.
--
-- Indices passed to / returned from this API are 0-based like the C++ version.

local RingBuffer = {}
RingBuffer.__index = RingBuffer

export type RingBuffer = typeof(setmetatable({} :: {
    _buffer: { number },
    _capacity: number,
    _writeIndex: number,
    _start: number,
}, RingBuffer))

function RingBuffer.new(capacity: number): RingBuffer
    local data = table.create(capacity, 0)
    return setmetatable({
        _buffer = data,
        _capacity = capacity,
        _writeIndex = 0,
        _start = 0,
    }, RingBuffer)
end

function RingBuffer.write(self: RingBuffer, value: number)
    self._buffer[self._writeIndex + 1] = value
    local w = self._writeIndex + 1
    if w >= self._capacity then
        w = 0
    end
    self._writeIndex = w
end

-- read(index): element `index` positions after start (does not consume)
function RingBuffer.read(self: RingBuffer, index: number): number
    local i = self._start + index
    if i >= self._capacity then
        i -= self._capacity
    end
    return self._buffer[i + 1]
end

-- read(n, target): copy n elements from start into target[1..n] (does not consume)
function RingBuffer.readInto(self: RingBuffer, n: number, target: { number })
    local buf = self._buffer
    local cap = self._capacity
    local i = self._start
    for k = 1, n do
        target[k] = buf[i + 1]
        i += 1
        if i >= cap then
            i = 0
        end
    end
end

-- readAndRemove(1, &v)
function RingBuffer.pop(self: RingBuffer): number
    local v = self._buffer[self._start + 1]
    self:removeBeginning(1)
    return v
end

function RingBuffer.removeBeginning(self: RingBuffer, n: number)
    local s = self._start + n
    if s >= self._capacity then
        s -= self._capacity
    end
    self._start = s
end

-- Roblox addition: empties the buffer with both indices at `index`.
function RingBuffer.reset(self: RingBuffer, index: number)
    self._start = index
    self._writeIndex = index
end

function RingBuffer.size(self: RingBuffer): number
    if self._writeIndex < self._start then
        return self._writeIndex + (self._capacity - self._start)
    end
    return self._writeIndex - self._start
end

function RingBuffer.writeIndex(self: RingBuffer): number
    return self._writeIndex
end

function RingBuffer.start(self: RingBuffer): number
    return self._start
end

function RingBuffer.capacity(self: RingBuffer): number
    return self._capacity
end

return RingBuffer
