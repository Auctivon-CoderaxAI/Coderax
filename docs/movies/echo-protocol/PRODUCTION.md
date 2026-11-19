# ECHO PROTOCOL — zero-cost production assessment

Measured on the owner's Windows workstation on 2026-11-17. This is an engineering
assessment, not legal advice; every model license must be re-read against the exact
weights and model card before commercial use.

## Measured host

| Resource | Measured value |
| --- | --- |
| CPU | Intel Core Ultra 7 255U |
| GPU | Intel integrated graphics (no CUDA device; `nvidia-smi` absent) |
| RAM | 15.5 GB |
| Free disk | ~76 GB |
| FFmpeg | 9.0.2 full build (`libx264`, `libx265`, `aac`, `whisper` filters) |
| Node.js | 24.19.0 |
| Python | 3.14.6 (no PyTorch installed) |
| ComfyUI | not installed |
| Video model weights | none |

## Stack evaluation

| Tool | Role | License posture | Runs here? |
| --- | --- | --- | --- |
| ComfyUI | Local workflow runtime and API | GPL-3.0; verify any bundled custom nodes separately | No — not installed |
| Wan 2.1 / Wan 2.2 | Image-to-video and text-to-video | Apache-2.0 for the released Wan 2.1 code/weights; confirm the exact checkpoint before use | No — needs a CUDA GPU and weights |
| LTX-Video | Fast image-to-video | Lightricks/LTX-Video license; read the model card before commercial use | No — needs a CUDA GPU and weights |
| CogVideoX | Text/image-to-video | CogVideoX license on the weights; Apache-2.0 code | No — needs a CUDA GPU and weights |
| Stable Audio Open | Sound effects and ambience | Stability AI community license; commercial terms depend on revenue and use | No — model and GPU not present |
| Piper TTS | Local dialogue reference voice | MIT | Not installed; CPU-feasible |
| Kokoro TTS | Higher-quality local dialogue | Apache-2.0 | Not installed; CPU-feasible |
| Whisper | Dialogue alignment and QA transcription | MIT | FFmpeg has a whisper filter; no model weights yet |
| FFmpeg | Encoding, assembly, loudness, QA | LGPL-2.1+ build; this build also carries GPL components | Yes |
| Blender | Previs, lighting reference, 3D layout | GPL | Not installed |

## What is implemented and verifiable today

- Owner-gated Coderax production hub: projects, characters, scenes, shots, job receipts.
- Deterministic six-beat shot planner with camera, lens, lighting, action, and continuity
  prompts built from the character bible.
- Real NeonFrame service client with HTTPS-or-loopback enforcement, bounded timeouts,
  token handling, and sanitized provider errors.
- Submission gate: a shot is submitted only when the generation service reports
  `/ready`; otherwise the job is persisted as `blocked` with the provider's own code.
- Approval gate: a shot cannot be approved without a verified artifact id.
- Real local integrations for the audio timing plan and MP4 assembly plan.
- Focused planner and runner tests: 9 passing.

## Exact blockers

1. **No CUDA GPU.** Wan/LTX/CogVideoX cannot generate the 3–5 second acted scene at usable
   quality on an Intel iGPU with 15.5 GB RAM. Rendering is marked BLOCKED.
2. **No ComfyUI runtime or reviewed video workflow.** `movie-generation` reports
   `PROVIDER_URL_MISSING` until `COMFYUI_URL` and `COMFYUI_WORKFLOWS_DIR` are configured.
3. **No model weights.** Weights must be obtained and used under their own licenses; no
   paid model access or unofficial API is used.
4. **`movie-generation` has no job-status or artifact route.** It accepts a reviewed
   workflow and returns a `prompt_id`, then stops. Coderax records `provider_accepted`
   and does not mark the shot rendered. A status + artifact route is required to close
   the loop.
5. **`movie-render` has no executor.** It builds a shell-free FFmpeg argument list and
   validates artifacts, but the API deliberately does not launch FFmpeg. A trusted
   render worker is required.
6. **No NeonFrame git repository exists.** Only the NeonFrame briefs and the
   `MovieStudioAI/*` modular services exist. The production engine used here is that
   existing pipeline, not a replacement.
7. **No zero-cost cloud GPU is assumed.** No hosting, subscription, credit, or GPU was
   purchased or requested.

## Path to the first verified clip

1. Provide a CUDA GPU (12–16 GB class for Wan 1.3B/5B or reduced-resolution LTX-Video),
   or a legitimately free local equivalent.
2. Install ComfyUI and obtain weights under their licenses.
3. Add a reviewed image-to-video workflow with stable character reference input and
   expose it as `NEONFRAME_VIDEO_WORKFLOW_ID`.
4. Add a job-status and artifact route to `movie-generation`.
5. Add a trusted FFmpeg worker to `movie-render`.
6. Render shot `S01-S4`, then run motion, identity, lip-sync, and audio checks before
   approval. A valid MP4 alone is not proof of acted motion.

## Path to a feature

The screenplay and 24-scene plan are the production spine. A feature needs, at minimum:
voice casting and a locked character bible; per-scene image references; shot-level
generation with retries; an edit decision list; music and ambience; a QC pass for
identity drift, lip sync, and continuity; and a human review gate before any publish.
None of that is claimed as complete.
