# FLUID — A study of motion

A browser-based 3D liquid instrument. Shape transparent water, play a kick sequence, and move through the sculpture with a continuously morphing camera.

**[Open the live simulation →](https://keigoyoshida7.github.io/fluid-studio/)**

## Play

The interface is monochrome; the 3D scene keeps its optical colors. Switch **JA / EN** in the header; your language preference is saved locally.

- Drag to stir; select **視点を回す** to orbit manually. Scroll or pinch to zoom.
- The **CAMERA OFF / ON** button smoothly morphs camera position, focal point, and lens. Choose Drift, Orbit, or Intimate in the side panel. Switching it off holds the current composition.
- **Space** pauses the water, **R** resets the scene, **K** plays a kick, **H** opens the guide.
- The sequencer starts only when you choose **音をはじめる**. Toggle sixteen steps, set BPM, swing, volume, or tap your tempo. Four patterns include a 5-in-16 Euclidean rhythm and Heartbeat.
- **音源を読み込む** plays and analyzes a local audio file; **マイク入力** explicitly requests microphone access. Bass onsets excite the liquid; microphone input is analyzed silently.
- Choose Pulse, Vortex, or Levitate for three different physical kick responses. **時のレンズ** slows the water briefly around each kick; **光の余韻** makes light and experimental materials respond to sound.
- Cascade, Release, Orbit, and Rain provide four starting flows. Cascade/Rain recirculate a fixed set of particles.
- Save a PNG with the camera icon or view the canvas fullscreen.

## Eight optical materials

Water, Chrome, Amber, and Ink are joined by four experimental optics:

- **Polar**: anisotropic reflections and traveling polarization ribbons.
- **Abyss**: dark transparent water with a procedural luminous vein pattern that responds to sound. The veins are a surface optical effect, not a volumetric physical simulation.
- **Nacre**: thin-film iridescence with spatially varying film thickness.
- **Phase**: moving transitions between a clear body and mirror-like fronts across the same surface.

Adjust surface smoothness, clarity, and dispersion independently.

## Vasodilation / fast vessel study

The Flow model selector switches to an artistic vasodilation scene: smooth branching translucent vessels with 22,000 internal flow tracers. **Vessel dilation** slowly changes their baseline width; musical kicks add a separate travelling pulse. **Flow speed** controls advection. The GPU animates the vessel and tracers while the PBF solver and liquid reconstruction are suspended, so this mode remains light.

The motion uses a kinematic tube model with an idealized parabolic velocity profile. It is a visual study, not a blood-cell simulation, physiological predictor, or clinical flow calculation. Baseline dilation and heartbeat distension are separate controls/processes. Relevant original work: [Furchgott & Zawadzki (1980)](https://pubmed.ncbi.nlm.nih.gov/6253831/) on endothelial-dependent smooth muscle relaxation, and [Hoeks et al. (1985)](https://pubmed.ncbi.nlm.nih.gov/3892817/) on arterial diameter changes through the cardiac cycle.

## Particle and surface detail

Particle count is independent of rendering quality: **1,800 / 3,600 / 6,000 / 12,000 / 20,000 / 32,000**. Finer particles preserve the same water volume. The surface grid has four resolutions, up to **108³** samples, with smooth gradient normals and antialiasing.

High particle counts are computationally expensive. The physics worker may advance slower than real time at 20–32k, while the camera and drawing continue independently. Start at 3,600–6,000 particles and use **高精細** or **極細** surface quality before increasing particle count. Small screens start with 1,800 particles.

## How it works

A Position Based Fluids solver runs in a Web Worker with spatial neighbors, density constraints, XSPH viscosity, cohesion, collisions, and physically applied musical impulses. A second worker reconstructs a continuous SPH density isosurface using Marching Cubes. This produces actual 3D geometry rather than visible point-sprite silhouettes.

Three.js physical transmission uses water's IOR of 1.333, thickness-based absorption, procedural HDR studio illumination, PMREM reflections, dispersion, and antialiasing. The experimental materials add continuous spatial optical fields. No remote textures or simulation service are required.

Web Audio schedules synthesized kicks against its audio clock. Local file/microphone analysis uses bass onset detection; arbitrary music is not guaranteed to match an exact DAW beat grid. Authored continuous camera paths blend position, target, and FOV without cuts.

This is an interactive visual instrument with approximate PBF water and limited surface resolution. It is not an offline FLIP solver or path-traced Houdini render. Orbit uses a central confinement force. Music and sources apply external forces/recirculation explicitly.

Primary references:

- [Macklin & Müller, Position Based Fluids (2013)](https://mmacklin.com/pbf_sig_preprint.pdf)
- [Three.js physical material documentation](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)
- [Web Audio specification](https://www.w3.org/TR/webaudio-1.0/)

## Develop

Use Node.js 20.19+ or 22.12+ and a recent WebGL 2 browser.

```sh
npm ci
npm run dev
npm test          # physics, audio clock/lifecycle, camera/beat motion, surface geometry
npm run test:detail # optional 12k/32k numerical checks and timings
npm run build    # static production bundle in docs/
npm run preview
```

The audio tests use mocked Web Audio and do not request microphone access. Browser QA checks actual local playback, materials, camera toggles, responsive layout, and both worker paths.

GitHub Pages serves the committed `docs/` directory on `main`. After source edits, rebuild and commit source plus `docs/`. All assets and both workers use relative URLs for the repository subpath.

Simulation, audio decoding/analysis, and PNG export run in the visitor's browser. The application includes no analytics, audio upload, or server storage. Audio/microphone permissions remain under browser control.
