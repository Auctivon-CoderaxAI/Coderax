# ECHO PROTOCOL — Proof scene shot list

**Scene 1 — INT. MARA'S APARTMENT — NIGHT — 5.0s**
**Status: PLANNED. Rendering BLOCKED on this machine.** No rendered artifact exists.

## Continuity locks

- **Mara Voss**, 32, adult. Olive skin, hazel eyes, dark brown shoulder-length hair behind
  one ear, thin scar through the left eyebrow. Charcoal ribbed knit sweater, black
  trousers, bare feet. Same face, hair, wardrobe, and body type in every shot.
- **Ilya**, 29, adult. Auburn jaw-length hair, green eyes, freckles, mole under the right
  eye. Cream silk blouse and slate skirt; unseen until shot 5.
- Apartment: floor-to-ceiling glass, rain streaks, city bokeh in sodium and blue, warm
  interior practicals, polished floor with reflected neon.
- No text, captions, watermarks, logos, extra faces, or celebrity likeness.

| # | Time | Shot | Lens | Camera | Lighting | Action | Audio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.0–1.0 | Establishing wide | 28mm | Slow dolly-in, eye level | Motivated practicals, soft key, deep falloff | Mara stands at the rain-streaked window, palm on glass, city behind her | Rain on glass, low city rumble |
| 2 | 1.0–1.7 | Approach | 35mm | Handheld follow, chest height | Warm key frame-left, cool window fill | She hears a sound, turns her head, shifts her weight | Floor creak, rain intensity rises |
| 3 | 1.7–2.3 | Reaction close-up | 85mm | Static, shallow focus on eyes | Soft key, negative fill, window catchlights | Recognition moves through her face; a blink lands before the turn completes | Breath, distant elevator chime |
| 4 | 2.3–3.6 | Dialogue coverage | 50mm | Over-the-shoulder, slow push-in | Key-side practical, rim light against the city | She walks toward the doorway and speaks: **"You weren't supposed to find me."** Lips, jaw, and tongue synchronized | Dry line, close perspective; rain dips under the voice |
| 5 | 3.6–4.3 | Threshold reveal | 35mm | Tracking approach, parallax on the doorframe | Doorway spill, harder backlight, rain reflections | She stops at the threshold; the dark hallway enters frame; Ilya's silhouette is implied, not revealed | Rain, a soft footstep, room tone narrows |
| 6 | 4.3–5.0 | Final hold | 85mm | Slow push-in, locked horizon | Single soft source, controlled falloff | Close on Mara's decision; breath visible; eyes hold off-screen | Rain fades to a low pulse; cut on the blink |

## Generation prompt (shot 4)

> Photorealistic cinematic film footage for "ECHO PROTOCOL". Scene 1: INT. MARA'S
> APARTMENT - NIGHT. Rain, neon, intimacy, and the first tremor of threat. Mara Voss (32),
> olive skin, dark brown shoulder-length hair tucked behind one ear, hazel eyes, a thin
> scar through the left eyebrow, charcoal ribbed knit sweater, black trousers, bare feet.
> Action: she walks toward the doorway as the threshold enters frame; the camera tracks
> with the body, then settles. The speaker delivers the line with visible lip, jaw, and
> tongue articulation synchronized to the recorded line. Camera: over-the-shoulder, slow
> push-in, 50mm lens. Lighting: key-side practical, rim light separating the silhouette
> from the city. Continuity: the same adult actor face, hair, body type, and wardrobe in
> every shot of this scene. Natural body mechanics, weight, and eye-lines. Landscape 16:9.
> No text, no captions, no watermark, no logo, no extra faces, no celebrity likeness.

## Why no MP4 is attached

This machine reports:

- CPU: Intel Core Ultra 7 255U
- GPU: Intel integrated graphics (no CUDA device; `nvidia-smi` is not present)
- RAM: 15.5 GB
- Disk free: ~76 GB
- ComfyUI: not installed
- Video-model weights: none downloaded
- Python: 3.14.6, with no PyTorch installed

Diffusion video generation (Wan, LTX-Video, CogVideoX) is not feasible at usable quality
or within a session on this hardware. The requirement is explicit: a still image, a pan
over a photograph, or a slideshow is not a substitute for acted motion, so none is
presented as the scene. The production interface is implemented and tested up to the
provider boundary; the shot is marked **BLOCKED** with the provider's own code.

To unblock, the owner needs a CUDA-capable GPU with enough VRAM for the chosen model
(a 12–16 GB class card for Wan 1.3B/5B or LTX-Video at reduced resolution), ComfyUI with a
reviewed image-to-video workflow, model weights obtained under their licenses, and the
`NEONFRAME_VIDEO_WORKFLOW_ID` set to that workflow. After that, the dashboard can submit
the shot and the artifact still has to pass separate motion and lip-sync QA before it can
be approved.
