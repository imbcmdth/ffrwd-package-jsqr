# ffrwd/jsqr

QR codes in video: read them into a caption track, or mosaic them out
of the picture. ffmpeg has no barcode filter of any kind, so this is a
thing the compiler could not do before the package existed.

Requires ffrwd 0.29.

It is also the demonstration that an ffrwd module can be written in
**JavaScript**. The two wasm components here are
[jsQR](https://github.com/cozmo/jsQR) and under five hundred lines of
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

### `scan(v)` → `STRUCT(start_t number, id number, text text)[]`

A row per frame for each code in view: the decoded payload as `text`,
as `start_t` the time this sighting of the code began, and as `id` how
many sightings began before it. Every row of one sighting carries the
same `start_t` and `id`, which name the sighting, and each row leaves
with the frame it describes.

`ffrwd.merge_spans` turns the rows into one cue per sighting, from the
frame the code was first read to the end of the last frame it was read
on. Selected beside the picture, the cues mint a subtitle track:

```sql
COPY (
  SELECT f.video[1], f.audio,
         ffrwd.merge_spans(ffrwd.jsqr.scan(f.video[1]), max_span => 30)
  FROM input('shelf.mp4') f
) TO 'labelled.mkv'
```

```
WEBVTT

00:00.333 --> 00:02.000
https://want.video/ffrwd/jsqr
```

Send `scan`'s rows, or the merged ones, to a `.ndjson` destination
instead and you get the rows themselves, one JSON object per line.

### `mosaic_codes(v)` → `video_stream`

The picture with every code pixelated in place. Mosaic rather than
blur, deliberately: a QR code carries up to 30% error correction and
reads straight through a blur, and deblurring a redacted code is a
known attack. The block is an eighth of each code's own box and never
under two pixels, which is what keeps it larger than the code's
modules; a fixed pixel count would quietly become decorative as
resolution rose.

```sql
COPY (
  SELECT ffrwd.jsqr.mosaic_codes(v), f.audio
  FROM input('desk.mp4') f, unnest(f.video) v
  WHERE v.index = 1
) TO 'redacted.mp4' WITH (video_codec 'libx264', crf 20)
```

## Recipes

- `codes`: the clip with a caption track of its QR payloads.
- `redact`: the clip with its QR codes mosaiced out.

```
ffrwd run ffrwd/jsqr:codes -v source=shelf.mp4 -v dest=labelled.mkv
```

## Flicker

A decoder run frame by frame flickers: the same code reads on one
frame, misses on the next. Each export closes those gaps in the way its
output allows.

`scan` keeps a sighting open while its code goes unread for up to
fourteen frames in a row, so a code the decoder drops for a few frames
is still one sighting and one cue. It does not reach back: each row is
written on the frame it describes, with nothing ahead of that frame
read, so a cue starts on the first frame the code was read.

`mosaic_codes` looks ahead instead. A frame is redacted by every code
found in it or in the fourteen frames after it, so a code is covered
from before the decoder first managed to read it, and a short gap heals
from both sides. The host hands it fifteen frames a call; each is still
decoded only once, since the overlap hits a cache keyed by timestamp,
and a frame with nothing to redact leaves without being copied.

The fifteen frames are the module's own constant, not a parameter.

`ffrwd.merge_spans` writes a sighting's cue once the stream is
`max_span` seconds past its start, or once the stream ends: in the
`codes` recipe, up to 30 seconds after the picture. Two codes first
read on the same frame come out as one cue, carrying the payload that
sorts last, until the reducer names a sighting by its `id` as well as
its start; `scan`'s rows already tell them apart.

## From 0.1

0.1's `scan` read fifteen frames a call and credited the first with
every code in them, returning the picture with a cue per run beside it.
0.2 reads one frame a call, writes the rows, and leaves the cues to
`ffrwd.merge_spans`, so on the same clip:

- a cue starts on the frame the code was first read, up to fourteen
  frames later than in 0.1;
- a cue ends at the end of the last frame the code was read on, one
  frame later than in 0.1, which ended at that frame's start;
- the picture does not pass through the module: the recipe copies it
  from the source, and `codes` takes the first video track (it no
  longer takes `track`).

`mosaic_codes`, and so `redact`, are frame for frame what they were.

## What JavaScript in wasm costs

Honest numbers, measured on this package. The components are built
**ahead of time** (`enableAot`, which runs weval over the JavaScript);
the interpreted column is what the same build costs without it:

| | AOT | interpreted |
| --- | --- | --- |
| component size | 22.1 MiB | 13.8 MiB |
| compressed | 6.2 MiB | 4.4 MiB |
| startup | ~1.3 s | ~0.8 s |
| per frame, 320×240 | ~0.15 s | ~0.22 s |
| 60 frames, 320×240, end to end | 14.1 s | 16.7 s |

AOT is the default here because frames outnumber starts in anything
this module is for: it costs half a second of startup and 1.8 MiB of
compressed component to take about 30% off every frame. A run pays the
startup three times where 0.1 paid it twice: the compiler opens the
component to have it describe itself and, new with nodes, to ask for
its shape, before the run opens it to work. A Rust node answers each in
a tenth of a second.

Both columns are slow, and that is the honest headline. The size is
SpiderMonkey, not jsQR: every ComponentizeJS component carries a
JavaScript engine, whatever you put in it. The speed is the same
engine: StarlingMonkey has no JIT, weval or not, and this is
pixel-crunching code, the worst case for it. The same JavaScript under
Node runs a 640×480 frame in 7.8 ms against ~0.59 s interpreted here,
so the component is roughly two orders slower than V8 and far slower
than the equivalent Rust module.

Take that as the shape of the road, not a verdict: JavaScript reaches
the world, the toolchain is three lines of build script, and for a
package whose value is a decoder nobody wants to port, the arithmetic
can still work out.

For this decoder it does not.
[`ffrwd/rsqr`](https://github.com/imbcmdth/ffrwd-package-rsqr) is the
same algorithm in Rust, and on the same clip it runs 10× faster at
320×240 and 24× at 640×480, in a component forty-five times smaller,
with `scan`'s rows byte-identical to this package's. Reach for that one;
this package is here to show what the JavaScript road costs, measured
rather than guessed.

## Two codes at once

jsQR reads one code per pass, so the module paints each found code out
and rescans, up to eight times. Two codes of *different* sizes on one
frame come back one after another. Two codes of the **same** size
defeat it entirely: jsQR's locator groups finder patterns by module
size, mixes the patterns of the two codes, and finds neither. That is
a property of the decoder, tested here rather than papered over. A
frame's rows are written in the order of their payloads, whichever
code the decoder met first, so `rsqr` and `jsqr` agree on them.

## Building it

```
npm install
ffrwd install
npm run check
```

`check` stages the wit from the `ffrwd/wasm` package the manifest
installs, bundles `src/` with esbuild, componentizes each entry into
`build/`, asks the sidecar to describe both and print their shapes, and
runs the unit tests. The tests need no wasm and no ffmpeg: they encode
QR codes in memory and run the detection core, and both nodes as the
host drives them, over the pixels.

Each component exports `node`, made by `src/node.js` against the
bindings ComponentizeJS generates: what
[`ffrwd-node`](https://github.com/imbcmdth/ffrwd-node) does for a Rust
module, cut to what these two use. The tick arrives as the host's
borrowed handle, a frame leaving untouched is a `same` payload naming
it, and an error is thrown as its message.

Two settings in `build.mjs` carry weight. `disableFeatures: ['http',
'fetch-event', 'random', 'clocks']` is load-bearing: without it
StarlingMonkey imports `wasi:http` for `fetch`, the sidecar reports the
module as needing the `http` capability, and the package would have to
declare a grant it never uses. `enableAot` is the ahead-of-time build
above; turning it off costs frames and buys back size and startup.

## License

This package is **Apache-2.0**, as is jsQR, whose decoder it carries.
