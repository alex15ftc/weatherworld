--!strict
-- The loops the live game's tornado voice plays (Voices.Loops), rendered by
-- `lune run tools/tornadoaudio/render.luau` (loop_noise.wav, loop_brown.wav, loop_debris.wav).
-- AudioStreamWriter, which plays the synth itself, works only in Studio; in a live server the
-- tornado is heard only once these are uploaded as audio assets and their ids recorded here.
-- Until then (nil) live servers play no tornado sound.
return {
	Noise = nil :: string?, -- "rbxassetid://..." white noise: the roar and the hiss
	Brown = nil :: string?, -- brown noise: the rumble
	Debris = nil :: string?, -- debris impacts at the reference rate (Acoustics.DEBRIS_RATE)
}
