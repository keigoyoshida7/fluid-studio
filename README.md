# FLUID — A study of motion

A small, interactive 3D liquid laboratory. Drag through the water, change gravity and viscosity, and explore four different flows with water, chrome, amber, and ink materials.

**[Open the live simulation →](https://keigoyoshida7.github.io/fluid-studio/)**

## Controls

- Drag to stir. Select **視点を回す** to orbit the camera; scroll or pinch to zoom.
- **Space** pauses and resumes; **R** resets the current scene; **H** opens the guide.
- Switch between Cascade, Release, Orbit, and Rain. Cascade and Rain recirculate a fixed set of particles.
- Change gravity, viscosity, swirl, simulation speed, lighting, and material in the side panel.
- Save a PNG using the camera button, or open the canvas full screen.
- Rendering quality offers 1,800 / 3,600 / 6,000 particles. Small screens start with the light setting.

## How it works

The simulation evolves particles in three spatial dimensions using **Position Based Fluids (PBF)**. A uniform grid finds neighbors; density constraints project positions toward incompressibility; gravity, wall collisions, XSPH viscosity, localized stirring, and optional rotational forces affect the liquid. Physics runs in a dedicated Web Worker while Three.js renders independently.

The surface renderer projects sphere depths, smooths them with a bilateral filter, reconstructs surface normals, and shades the continuous liquid with thickness-based absorption, transmission, Fresnel reflections, and procedural studio illumination. It uses no prerecorded animation, environment images, remote simulation service, or API keys.

This is an interactive visual simulation, with limited particle resolution and an approximate surface. It is not a production FLIP solver or a substitute for offline Houdini/Blender simulation and rendering. Gravity-free Orbit adds confinement and swirl forces. Cascade/Rain explicitly recycle particles into their sources, rather than simulating a closed isolated fluid. Heavy settings can run more slowly than real time.

References:

- Macklin & Müller, [Position Based Fluids (2013)](https://mmacklin.com/pbf_sig_preprint.pdf).
- van der Laan, Green & Sainz, [Screen Space Fluid Rendering with Curvature Flow (2009)](https://wstahw.win.tue.nl/edu/2IV06/andrei/particle_rendering/provided/p91-van_der_laan.pdf). This project uses bilateral depth smoothing, not their full curvature flow method.
- [Three.js](https://threejs.org/).

## Run locally

Requires Node.js 20.19+ or 22.12+ and a WebGL 2 capable browser with float render-target support.

```sh
npm ci
npm run dev
```

```sh
npm test       # numerical physics verification across all four presets
npm run build # production output in docs/
npm run preview
```

The checks exercise finite coordinates, tank containment, density stability, interaction, live source recirculation, and pressure relaxation of an initially compressed packet.

## Publish

GitHub Pages serves the committed `docs/` directory on the `main` branch. After source edits, run `npm ci && npm test && npm run build` and commit both source and updated `docs/`. Vite uses relative asset paths so the main bundle and module worker load under the repository subpath.

No login is needed to use the public site. Simulation and PNG export run locally in the visitor's browser; the app includes no analytics or server storage.
