# ffrwd/jsqr

QR codes in video: read them into a caption track, or mosaic them out
of the picture. ffmpeg has no barcode filter of any kind, so this is a
thing the compiler could not do before the package existed.

It is also the demonstration that an ffrwd module can be written in
**JavaScript**. The two wasm components here are
[jsQR](https://github.com/cozmo/jsQR) and about four hundred lines of
plain JS, compiled to wasip2 components by
[ComponentizeJS](https://github.com/bytecodealliance/ComponentizeJS)
against the same `ffrwd:av` world every Rust module is built against.
The host cannot tell the difference; read
[the cost](#what-javascript-in-wasm-costs) before you reach for it.

## Install

```
ffrwd install ffrwd/jsqr
```

## Exports

### `scan(v)` → `STRUCT(v video_stream, codes cue[])`

The picture untouched, and one cue per code beside it: the decoded
payload as the cue's text, spanning the time the code was on screen.
Project the `codes` column into a stream position and it mints a
subtitle track:

```sql
COPY (
  SELECT v, f.audio, ffrwd.jsqr.scan(v).codes
  FROM input('shelf.mp4') f, unnest(f.video) v
  WHERE v.index = 1
) TO 'labelled.mkv'
```

```
WEBVTT

00:00.033 --> 00:01.500
https://want.video/ffrwd/jsqr
```

Send the same column to a `.ndjson` destination instead and you get the
rows themselves, one JSON object per cue.

### `mosaic_codes(v)` → `video_stream`

The picture with every code pixelated in place. Mosaic rather than
blur, deliberately: a QR code carries up to 30% error correction and
reads straight through a blur, and deblurring a redacted code is a
known attack. The block is an eighth of each code's own box and never
under two pixels, which is what keeps it larger than the code's
modules — a fixed pixel count would quietly become decorative as
resolution rose.

```sql
COPY (
  SELECT ffrwd.jsqr.mosaic_codes(v), f.audio
  FROM input('desk.mp4') f, unnest(f.video) v
  WHERE v.index = 1
) TO 'redacted.mp4' WITH (video_codec 'libx264', crf 20)
```

## Recipes

- `codes` — the clip with a caption track of its QR payloads.
- `redact` — the clip with its QR codes mosaiced out.

```
ffrwd ffrwd.jsqr.codes -v source=shelf.mp4 -v dest=labelled.mkv
```

## Detection is retroactive

A decoder run frame by frame flickers: the same code reads on one
frame, misses on the next, and the output stutters. So the module
reads fifteen frames at a time and credits the first of them with
every code found anywhere in that window. A code the decoder only
catches on the fourteenth frame is carried back over the thirteen
before it, and a gap the window can span heals from both sides.

This costs nothing in latency. The frame the module speaks for is the
oldest one it holds, not the newest, so the look-ahead is the host's
buffer rather than a delay in the output. Each frame is still decoded
exactly once — the fifteen-fold overlap hits a cache keyed by
timestamp.

For `scan` it means a cue starts a window before the code was first
read and ends at its last real sighting: one cue per code per
appearance, not one row per frame. For `mosaic_codes` it means a code
is covered from before the decoder first managed to read it.

The window is fixed at fifteen frames. It is not a parameter, and
cannot be: the host settles a module's window from `describe()` before
it opens the call, so a parameter could only ever narrow behavior
inside a window already sized.

## What JavaScript in wasm costs

Honest numbers, measured on this package. The components are built
**ahead of time** (`enableAot`, which runs weval over the JavaScript);
the interpreted column is what the same build costs without it:

| | AOT | interpreted |
| --- | --- | --- |
| component size | 21.0 MiB | 13.6 MiB |
| in the archive, compressed | 6.2 MiB | 4.5 MiB |
| startup | ~1.20 s | ~0.75 s |
| per frame, 320×240 | ~0.19 s | ~0.23 s |
| 60 frames, 320×240, end to end | 12.6 s | 14.8 s |

AOT is the default here because frames outnumber starts in anything
this module is for: it costs half a second of startup and 1.7 MiB of
archive to take about 19% off every frame.

Both columns are slow, and that is the honest headline. The size is
SpiderMonkey, not jsQR — every ComponentizeJS component carries a
JavaScript engine, whatever you put in it. The speed is the same
engine: StarlingMonkey has no JIT, weval or not, and this is
pixel-crunching code, the worst case for it. The same JavaScript under
Node runs a 640×480 frame in 7.8 ms against ~0.59 s interpreted here,
so the component is roughly two orders slower than V8 and far slower
than the equivalent Rust module.

Take that as the shape of the road, not a verdict: JavaScript reaches
the world, the toolchain is three lines of build script, and for a
package whose value is a decoder nobody wants to port, the arithmetic
can still work out. Reach for Rust when frames are the product.

## Two codes at once

jsQR reads one code per pass, so the module paints each found code out
and rescans, up to eight times. Two codes of *different* sizes on one
frame come back one after another. Two codes of the **same** size
defeat it entirely — jsQR's locator groups finder patterns by module
size, mixes the patterns of the two codes, and finds neither. That is
a property of the decoder, tested here rather than papered over.

## Building it

```
npm install
ffrwd install -g ffrwd/wasm
npm run check
```

`check` stages the wit from the installed `ffrwd/wasm` package, bundles
`src/` with esbuild, componentizes each entry into `build/`, asks the
sidecar to describe both, and runs the unit tests. The tests need no
wasm and no ffmpeg: they encode QR codes in memory and run the
detection core over the pixels.

Two settings in `build.mjs` carry weight. `disableFeatures: ['http',
'fetch-event', 'random', 'clocks']` is load-bearing: without it
StarlingMonkey imports `wasi:http` for `fetch`, the sidecar reports the
module as needing the `http` capability, and the package would have to
declare a grant it never uses. `enableAot` is the ahead-of-time build
above; turning it off costs frames and buys back size and startup.

## License

This package is **Apache-2.0**, as is jsQR, whose decoder it carries.
