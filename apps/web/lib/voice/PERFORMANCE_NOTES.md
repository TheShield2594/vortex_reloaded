# Voice Audio Processing Performance Notes

- The input chain runs: `MediaStreamSource -> Gain -> Compressor -> Noise Gate -> 6-band EQ -> Gain -> MediaStreamDestination`.
- CPU safeguard: the chain auto-bypasses when hardware concurrency is low (`<=2`), sample rate is very high (`>=96kHz`), or browser-reported `baseLatency > 50ms`.
- When bypass is active, raw microphone stream is used so voice join/mute/deafen/screen share behavior remains functional.
- Noise gate uses an analyser + requestAnimationFrame loop to avoid AudioWorklet setup complexity and to keep failure mode simple.
- Recommended profile for constrained devices: keep EQ flat, disable spatial pan, and leave compressor ratio <= 3.
