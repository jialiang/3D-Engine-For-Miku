// Read and write the MOT1 clips the runtime plays, for the offline bakes.
//
// MOT1 is not a game format: the dump repo's convert.js writes it and its
// byte layout is documented there (FORMATS.md, "MOT1"). Animation.js parses it
// at runtime. These are the pieces a bake needs on the Node side, shared by
// tools/ground.js and tools/softbody.js.
//
// Exposed as a module: serializeMot1, parseMot1 and loadMergedMotion.

const fs = require("fs");
const path = require("path");

// TANGENTS ARE INT16, VALUES ARE NOT, which is the opposite of the obvious split. A tangent
// is a derivative and barely compresses, costing 4.70MB gzipped of the motion set against
// the values' 3.37MB, while the rig is far less sensitive to it: 0.14mm of bone travel
// against 0.42mm. Quantising the values as well saves LESS over the wire, because float32
// values hold structure gzip exploits and int16 packs it away.
//
// ONE LAYOUT, deliberately. A curve with a key on every frame could drop both the frame
// numbers and the tangents and store values alone, at 2 bytes a key against 8, which is
// worth about 4x on such a file. Nothing here is one: the grounding bake was the only
// candidate and it writes keyframes into the clip instead. A second encoding that no file
// used would be a branch nothing exercises.
const serializeMot1 = (tracks, frameRate, frameCount) => {
  const totalKeys = tracks.reduce((sum, track) => sum + track.keys.length, 0);
  const buffer = Buffer.alloc(20 + tracks.length * 12 + totalKeys * 8);
  const normalizeZero = (value) => (value === 0 ? 0 : value);
  let offset = 0;

  buffer.write("MOT1", offset, "ascii");
  offset = buffer.writeUInt32LE(2, offset + 4);
  offset = buffer.writeUInt32LE(frameRate, offset);
  offset = buffer.writeUInt32LE(frameCount, offset);
  offset = buffer.writeUInt32LE(tracks.length, offset);

  for (const track of tracks) {
    // one scale per track, since a finger curl and a hip swing do not share a range
    const peak = track.keys.reduce((most, key) => Math.max(most, Math.abs(key.tangent)), 0);
    const scale = peak === 0 ? 1 : peak / 32767;

    offset = buffer.writeUInt16LE(track.boneIndex, offset);
    offset = buffer.writeUInt8(track.channelAxis, offset);
    offset = buffer.writeUInt8(track.kind, offset);
    offset = buffer.writeUInt32LE(track.keys.length, offset);
    offset = buffer.writeFloatLE(scale, offset);

    for (const key of track.keys) offset = buffer.writeUInt16LE(key.frame, offset);
    for (const key of track.keys) offset = buffer.writeFloatLE(normalizeZero(key.value), offset);
    for (const key of track.keys)
      offset = buffer.writeInt16LE(Math.round(key.tangent / scale), offset);
  }

  if (offset !== buffer.length) throw new Error(`wrote ${offset} of ${buffer.length} bytes`);

  return buffer;
};

// Hands back plain floats, so a bake never sees how the tangents were stored.
const parseMot1 = (buffer) => {
  const version = buffer.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported MOT1 version ${version}.`);

  const trackCount = buffer.readUInt32LE(16);
  const tracks = [];
  let offset = 20;

  for (let track = 0; track < trackCount; track++) {
    const boneIndex = buffer.readUInt16LE(offset);
    const channelAxis = buffer.readUInt8(offset + 2);
    const kind = buffer.readUInt8(offset + 3);
    const keyCount = buffer.readUInt32LE(offset + 4);
    const tangentScale = buffer.readFloatLE(offset + 8);
    offset += 12;

    const frames = [];
    const values = [];
    const tangents = [];

    for (let key = 0; key < keyCount; key++) frames.push(buffer.readUInt16LE(offset + key * 2));
    offset += keyCount * 2;
    for (let key = 0; key < keyCount; key++) values.push(buffer.readFloatLE(offset + key * 4));
    offset += keyCount * 4;

    for (let key = 0; key < keyCount; key++) {
      tangents.push(buffer.readInt16LE(offset + key * 2) * tangentScale);
    }

    offset += keyCount * 2;

    tracks.push({ boneIndex, channelAxis, kind, frames, values, tangents });
  }

  return tracks;
};

// Stitch a windowed motion (per-window MOT1 chunks, see the dump repo's
// convert.js) back into one whole-timeline MOT1 buffer for a bake to analyze:
// each track's curve is the interior keys of every window in order, dropping
// the anchor keys the chunks keep past their edges (each anchor duplicates a
// neighbouring window's key). Returns an ArrayBuffer an Animation can load.
//
// ONLY SAFE FOR CLIPS NOBODY UNWRAPPED. The body motion qualifies. The
// recorded osage clip does NOT. Whatever wrote it absorbs each Euler channel's
// turns into a running offset per window file, so two keys either side of a
// seam can sit a whole turn apart and a cubic through them spins the part
// right around. The runtime never hits this because StreamedAnimation samples
// one chunk at a time.
const loadMergedMotion = (clipDirectory) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(clipDirectory, "manifest.json"), "utf8"));
  const { frameRate, frameCount, windowSize, chunks } = manifest;

  const tracksByChannel = new Map();

  chunks.forEach((name, windowIndex) => {
    const windowStart = windowIndex * windowSize;
    const windowEnd = Math.min(windowStart + windowSize, frameCount);

    for (const track of parseMot1(fs.readFileSync(path.join(clipDirectory, name)))) {
      const channel = `${track.boneIndex}:${track.channelAxis}`;
      let merged = tracksByChannel.get(channel);

      if (!merged) {
        merged = {
          boneIndex: track.boneIndex,
          channelAxis: track.channelAxis,
          kind: track.kind,
          keys: [],
        };
        tracksByChannel.set(channel, merged);
      }

      track.frames.forEach((frame, key) => {
        if (frame >= windowStart && frame < windowEnd) {
          merged.keys.push({ frame, value: track.values[key], tangent: track.tangents[key] });
        }
      });
    }
  });

  const buffer = serializeMot1([...tracksByChannel.values()], frameRate, frameCount);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
};

module.exports = { serializeMot1, parseMot1, loadMergedMotion };
