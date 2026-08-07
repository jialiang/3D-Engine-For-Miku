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

const serializeMot1 = (tracks, frameRate, frameCount) => {
  const totalKeys = tracks.reduce((sum, track) => sum + track.keys.length, 0);
  const buffer = Buffer.alloc(20 + tracks.length * 8 + totalKeys * 10);
  const normalizeZero = (value) => (value === 0 ? 0 : value);
  let offset = 0;

  buffer.write("MOT1", offset, "ascii");
  offset = buffer.writeUInt32LE(1, offset + 4);
  offset = buffer.writeUInt32LE(frameRate, offset);
  offset = buffer.writeUInt32LE(frameCount, offset);
  offset = buffer.writeUInt32LE(tracks.length, offset);

  for (const track of tracks) {
    offset = buffer.writeUInt16LE(track.boneIndex, offset);
    offset = buffer.writeUInt8(track.channelAxis, offset);
    offset = buffer.writeUInt8(track.kind, offset);
    offset = buffer.writeUInt32LE(track.keys.length, offset);

    for (const key of track.keys) offset = buffer.writeUInt16LE(key.frame, offset);
    for (const key of track.keys) offset = buffer.writeFloatLE(normalizeZero(key.value), offset);
    for (const key of track.keys) offset = buffer.writeFloatLE(normalizeZero(key.tangent), offset);
  }

  if (offset !== buffer.length) throw new Error(`wrote ${offset} of ${buffer.length} bytes`);

  return buffer;
};

const parseMot1 = (buffer) => {
  const trackCount = buffer.readUInt32LE(16);
  const tracks = [];
  let offset = 20;

  for (let track = 0; track < trackCount; track++) {
    const boneIndex = buffer.readUInt16LE(offset);
    const channelAxis = buffer.readUInt8(offset + 2);
    const kind = buffer.readUInt8(offset + 3);
    const keyCount = buffer.readUInt32LE(offset + 4);
    offset += 8;

    const frames = [];
    const values = [];
    const tangents = [];
    for (let key = 0; key < keyCount; key++) frames.push(buffer.readUInt16LE(offset + key * 2));
    offset += keyCount * 2;
    for (let key = 0; key < keyCount; key++) values.push(buffer.readFloatLE(offset + key * 4));
    offset += keyCount * 4;
    for (let key = 0; key < keyCount; key++) tangents.push(buffer.readFloatLE(offset + key * 4));
    offset += keyCount * 4;

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
