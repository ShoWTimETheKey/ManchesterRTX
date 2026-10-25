# Third-party notices

Manchester RTX builds on the following work. The project's own code is under the MIT licence ([LICENSE](LICENSE)); the
components below keep their own licences.

| Component | Used for | Licence |
|---|---|---|
| [NVIDIA RTX Path Tracing (RTXPT)](https://github.com/NVIDIA-RTX/RTXPT) 1.8.1 | The renderer. This repository carries only patches against it (`rtxpt/patches/`); `setup.ps1` fetches the original. | NVIDIA RTX SDKs License. *This software contains source code provided by NVIDIA Corporation.* |
| [Donut](https://github.com/NVIDIA-RTX/Donut) | RTXPT's framework (patched in `rtxpt/patches/donut.patch`) | MIT |
| [NVIDIA Streamline](https://github.com/NVIDIA-RTX/Streamline) 2.14.16 with DLSS 310.9.16 (Super Resolution, Ray Reconstruction, Frame Generation) and Reflex | Upscaling, denoising, frame generation | NVIDIA Streamline / DLSS licences; the release redistributes the runtime DLLs under their terms |
| [NRD](https://github.com/NVIDIA-RTX/NRD), [RTXDI](https://github.com/NVIDIA-RTX/RTXDI), [Opacity Micro-Map SDK](https://github.com/NVIDIA-RTX/OMM), [NVAPI](https://github.com/NVIDIA/nvapi) | RTXPT dependencies | Their respective NVIDIA licences |
| [DirectX Shader Compiler](https://github.com/microsoft/DirectXShaderCompiler), DirectX 12 Agility SDK | Shader compilation, D3D12 runtime | University of Illinois/NCSA and LLVM licences; Microsoft Agility SDK licence |
| [Dear ImGui](https://github.com/ocornut/imgui), [GLFW](https://www.glfw.org/), [cxxopts](https://github.com/jarro2783/cxxopts), [JsonCpp](https://github.com/open-source-parsers/jsoncpp) | GUI, windowing, command line, JSON (through Donut / RTXPT) | MIT / zlib |
| [RTXPT-Assets](https://github.com/NVIDIA-RTX/RTXPT-Assets): `StandaloneTextures/q2rtx_env` (precomputed atmosphere and clouds from Quake II RTX), `StandaloneTextures/RGBANoiseMedium.png` | The physical sky | Distributed with RTXPT; see RTXPT-Assets |
| Droid Sans Mono (RTXPT-Assets `Fonts/DroidSans`) | RTXPT's developer panel | Apache License 2.0 |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) data (`data/osm/`) | Streets, buildings, water, land use, trees | © OpenStreetMap contributors, Open Database Licence (ODbL) 1.0. The city model is a Produced Work of this data. |

The GUI uses fonts installed with Windows at run time (DengXian, Microsoft YaHei, Bahnschrift, Segoe UI, Segoe Fluent
Icons); none are distributed.

University of Manchester, Manchester City Council, NVIDIA, RTX and DLSS names are used only to describe the subject and
the technology. This project is not affiliated with or endorsed by any of them.
