# Manchester RTX

![Deansgate at dusk, with the Liquid Glass interface](docs/images/hero.jpg)

**A real-time path-traced model of central Manchester.** The city is generated from OpenStreetMap at true scale and rendered with NVIDIA RTX Path Tracing, DLSS 4 Ray Reconstruction and Multi Frame Generation. It runs through five times of day on Manchester's real solar path, with rain, a ray-traced atmosphere and HDR10 output, under a Liquid Glass interface in English and Chinese.

[中文说明](README.zh-CN.md) · [Download for Windows](https://github.com/ShoWTimETheKey/ManchesterRTX/releases/latest) · [Technical notes (Chinese)](docs/notes.zh-CN.md)

> An independent fan project. Not affiliated with or endorsed by NVIDIA, the University of Manchester or Manchester City Council.

## Highlights

- **The city at 1:1 scale.** About 2.6 km × 3.2 km, from Victoria in the north to Whitworth Park in the south and from Salford to Ancoats. 7,600 buildings are voxelised at 0.6 m from OSM footprints and heights. Facade styles follow tags and districts: Victorian warehouses, terraced red brick, curtain walls and stone commercial blocks. Around them are 15,000 streets with kerbs and markings, railway and Metrolink viaducts, the canals and rivers, 4,400 street lamps, 6,900 trees and 28 tower cranes.
- **Landmarks in finer detail** (0.16–0.3 m), including:
  - the Town Hall, whose four clock faces always show the time of day being rendered;
  - the University of Manchester's Old Quad, with **UNIVERSITY OF MANCHESTER** in gilded letters over the Oxford Road gatehouse;
  - Central Library, John Rylands Library, the Cathedral, the Midland Hotel and the Kimpton Clocktower;
  - the Etihad Stadium and Old Trafford, set on small tabletop plinths.
- **Path tracing.**
  - [RTX Path Tracing](https://github.com/NVIDIA-RTX/RTXPT) 1.8.1 with DLSS Ray Reconstruction (transformer preset F).
  - Super Resolution or DLAA, and up to 4× Multi Frame Generation with UI recomposition and Reflex (Streamline 2.14.16, DLSS 310.9.16).
- **Time and weather.**
  - Noon, afternoon, overcast, dusk and night on 26 July, with the sun on its real path over Manchester.
  - Switching runs a 2–5 second time-lapse in which the clock, sun, clouds, haze, window and street lights, wet streets and the clock hands all move together. Rain can be switched on or off at any time.
- **Ray-traced atmosphere.**
  - Sun shafts cut by the city's own geometry, and height fog with aerial perspective.
  - Cloud shadows that drift with the sky's clouds, and stars at night.
- **HDR10.** The tone curve rolls off to the display's reported peak and uses Windows' SDR content brightness as paper white.
- **Liquid Glass interface.**
  - In the University of Manchester's purple and gold, in English and Chinese.
  - Viewpoints, a weather dock with a live clock, a settings sheet and a photo mode that accumulates a noise-free reference image.

| | |
|---|---|
| ![Town Hall at night](docs/images/night-town-hall.jpg) | ![Old Quad at noon](docs/images/noon-university.jpg) |
| Town Hall and Albert Square at night | The University's Old Quad at noon |
| ![Rainy night on Oxford Road](docs/images/rainy-night-oxford-road.jpg) | ![Castlefield in the afternoon](docs/images/afternoon-castlefield.jpg) |
| Oxford Road at street level, raining | Castlefield viaducts in the afternoon |
| ![Settings in English](docs/images/gui-en.jpg) | ![Settings in Chinese](docs/images/gui-zh.jpg) |
| The settings sheet in English… | …and in Chinese |

## Requirements

- Windows 10 or 11 (64-bit).
- An NVIDIA GeForce RTX GPU with a recent driver. Frame Generation needs an RTX 40 series card; Multi Frame Generation (3×, 4×) needs RTX 50.
- 12 GB of video memory or more is recommended at 4K; the app uses about 9.5 GB there.
- About 3 GB of disk space.

On an RTX 5080 at 4K with the High preset and 4× frame generation, the viewpoints run at roughly 155–200 fps.

## Run

1. Download `ManchesterRTX-…-win64.zip` from [Releases](https://github.com/ShoWTimETheKey/ManchesterRTX/releases/latest) and extract it.
2. Double-click **`ManchesterRTX.exe`**.

The city appears after about 20 seconds. Settings, including the language, are saved in `renderer\bin\ManchesterRTX.ini`. The language follows Windows by default; change it under **Settings → Interface → Language**.

| Input | Action | Key | Action |
|---|---|---|---|
| W A S D | Move | 1 – 8 | Fly to a viewpoint |
| Q / E | Down / up | Shift + 1 – 5 | Time of day and weather |
| Shift / Ctrl | Faster / slower | R | Rain on / off |
| Left drag | Look around | T | Auto tour |
| Right drag | Pan | P | Photo mode |
| Middle drag, Alt + left drag | Orbit | F12 | Screenshot (to `captures\`) |
| Scroll | Dolly in / out | H | Hide / show the interface |
| Click a landmark | Fly to it | F11 | Full screen / window |
| F1 | Controls | Esc | Close a panel / quit |

## Build from source

You need:
- Visual Studio 2022 or later with *Desktop development with C++*; its bundled CMake is enough.
- Git with Git LFS.
- Node.js 20 or later.
- About 25 GB of free disk space.

```powershell
git clone https://github.com/ShoWTimETheKey/ManchesterRTX.git
cd ManchesterRTX
.\setup.ps1
```

`setup.ps1` does the following:
- clones [RTXPT](https://github.com/NVIDIA-RTX/RTXPT) at the 1.8.1 commit this project was built on, with its submodules and sample assets, into `renderer\`;
- applies the patches in `rtxpt\patches\` and copies the Manchester module (`rtxpt\Manchester\`) and app data (`rtxpt\assets\`) into it;
- configures and builds the renderer (Streamline 2.14.16 is downloaded by CMake);
- builds the launcher.

Then generate the city from the OpenStreetMap extract in `data\osm\`. This takes about a minute and writes `renderer\Assets\Models\Manchester\manchester.glb`, 1.4 GB:

```powershell
node --max-old-space-size=16000 exporter\export2.mjs
```

Or let `.\setup.ps1 -Model release` take the model from the latest release instead.

| Path | Contents |
|---|---|
| `exporter\` | The city generator (Node.js, no dependencies):<br>• `export2.mjs` drives it;<br>• `city2\` has the ground, buildings, viaducts and rail, props, the Gothic and classical landmarks, the towers and stadiums, clock faces, lettering and the glTF writer;<br>• `gui-text.mjs` holds the interface's names in both languages. |
| `rtxpt\Manchester\` | The app inside RTXPT:<br>• the GUI (`ManchesterApp`);<br>• the Liquid Glass layer (`ManchesterUILayer`, `LiquidGlass.hlsl`);<br>• the ray-traced atmosphere (`ManchesterAtmosphere`, `Atmosphere.hlsl`). |
| `rtxpt\patches\` | Changes to RTXPT and Donut:<br>• app mode and HDR10 output;<br>• procedural sky and tone mapping;<br>• Streamline 2.14 with DLSS-G UI recomposition;<br>• premultiplied ImGui;<br>• frame-time smoothing and developer recording. |
| `launcher\` | `ManchesterRTX.exe`: a splash screen in both languages that starts the renderer and hands it the focus. |
| `data\osm\` | The OpenStreetMap extract the model is built from, and its Overpass query. |
| `tools\` | Scripts for screenshots, previews, glyphs, the splash, HDR inspection, and flicker and frame-pacing measurement. |
| `docs\` | Images and the detailed technical notes (Chinese). |

## How it works

- **City generation.** OSM ways and relations are projected to local metres and rasterised into voxel grids per building, then meshed into quads with greedy merging. Facades are generated per style: window bays and reveals, shopfronts, cornices and parapets, roof furniture, and shared party walls without windows. Landmarks have hand-written generators driven by their OSM parts. Everything is streamed into a single glTF binary.
- **Atmosphere.** A compute pass after Ray Reconstruction marches the air in front of each quarter-resolution pixel. At every step it traces a shadow ray to the sun through the scene's acceleration structure. Results are accumulated over frames with depth-checked reprojection, then composited at full resolution. Silhouette pixels are supersampled so that haze edges match the antialiased frame.
- **Stable motion.** Rays are built from camera-relative matrices; the city spans kilometres, and world-space unprojection loses about a pixel to float rounding. All motion advances on a smoothed frame time, so camera steps stay even when frame generation paces the display evenly.
- **Glass and frame generation.** The interface is drawn in linear light and encoded once in the swap chain's encoding: sRGB in SDR, PQ in HDR10. It is then blended exactly as DLSS-G recomposes UI, so generated frames show the same interface as rendered ones.

More detail, in Chinese, is in [docs/notes.zh-CN.md](docs/notes.zh-CN.md).

## Licences and credits

- The project's own code (exporter, launcher, the Manchester module, tools) is under the [MIT licence](LICENSE).
- **RTX Path Tracing** and its modifications in `rtxpt\patches\` are under the NVIDIA RTX SDKs licence. *This software contains source code provided by NVIDIA Corporation.* Donut is MIT. The DLSS and Streamline binaries in the release are redistributed under NVIDIA's terms.
- **Map data** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database Licence (ODbL).
- See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the full list.
