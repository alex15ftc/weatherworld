--!strict
-- engine-sim's audio synthesizer for Roblox.
--
--   Synthesizer          faithful port of engine-sim's Synthesizer (44.1 kHz)
--   EngineAudioSimulator engine-sim's simulator -> synthesizer glue (latency
--                        control, exhaust delay lines, writeToSynthesizer)
--   EngineModel          compact engine physics that feeds it (stand-in for
--                        engine-sim's full physics, see the file header)
--   StreamOutput         44.1 -> 48 kHz into an AudioStreamWriter
--   Presets              engine definitions (GM LS V8 from engine-sim)
--   FuelMap              fuel table, ignition cut and exhaust afterfire

local Synthesizer = require(script.Synthesizer)
local EngineAudioSimulator = require(script.EngineAudioSimulator)
local EngineModel = require(script.EngineModel)
local StreamOutput = require(script.StreamOutput)
local Presets = require(script.Presets)
local FuelMap = require(script.FuelMap)
local ImpulseResponses = require(script.ImpulseResponses)
local Filters = require(script.Filters)
local ConvolutionFilter = require(script.ConvolutionFilter)
local RingBuffer = require(script.RingBuffer)

export type Synthesizer = Synthesizer.Synthesizer
export type AudioParameters = Synthesizer.AudioParameters
export type EngineAudioSimulator = EngineAudioSimulator.EngineAudioSimulator
export type EngineModel = EngineModel.EngineModel
export type StreamOutput = StreamOutput.StreamOutput
export type EnginePreset = Presets.EnginePreset
export type FuelMap = FuelMap.FuelMap

return {
    Synthesizer = Synthesizer,
    EngineAudioSimulator = EngineAudioSimulator,
    EngineModel = EngineModel,
    StreamOutput = StreamOutput,
    Presets = Presets,
    FuelMap = FuelMap,
    ImpulseResponses = ImpulseResponses,
    Filters = Filters,
    ConvolutionFilter = ConvolutionFilter,
    RingBuffer = RingBuffer,
}
