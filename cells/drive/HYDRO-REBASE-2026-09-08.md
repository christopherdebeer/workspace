# Hydro polish rebase

Rebased on the 8 September remote cell. Retains the newer calibrated audio graph, limiter, voice analysers, dedicated rattle/gravel/boil patterns, drone spatialisation and expanded water/sward sampling. Superseded local terrain/drone voices were intentionally not applied.

Hydro: grouped swell envelopes; high-energy standing amplitude 0.72→1.05 m and river amplitude 0.16→0.21 m before existing tuning/shoaling gates; lingering breaker wash; rain rings perturb surface normals within 90 m rather than adding white foam; lighting follows displaced mesh slopes using derivatives where supported, with an analytic fallback. Shoreline phase and wetness continuity retained; no geometry or draw-count increase. Per-fragment cost has changed and needs phone measurement.

Atmosphere: broad terrain-space fog pockets and sky-haze colour coupling; fixes descending-edge smoothstep to a defined ascending expression. Existing chart fog exclusion retained.

Audio extension: road hiss receives persistent local wetness separately from rainfall; existing rattle voice is suppressed when stationary, paused or wading. Existing air/contact gain remains in control. No extra audio nodes introduced by this rebase.

Validation: strict client TypeScript check passed; node client/hydro-rebase-check.mjs passes with esbuild/three installed, covering existing hydro self-tests, current audio graph wiring, stopped/airborne rattle, wet-road sound after rain and existing drone spool/distance behaviour. No subjective listening or GPU visual validation claimed; cloud WebGL was disabled in the previous check. Pixel-scale appearance and FPS require a device run.
