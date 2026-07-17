// Plays the MOT1 body-motion binary (written by the dump repo's convert.js,
// where the byte layout is documented): per-track scalar keyframe curves
// sampled by a frame playhead into a flat values buffer. Which bone and
// channel a track drives comes from its boneIndex into the skeleton asset
// plus a channel/axis code (the skeleton runtime does that mapping).
//
// Sampling is forward-consuming like the old VMD player: each track keeps
// a cursor that only advances while playback moves forward, so a frame
// costs O(keys passed since the last frame). Seeking backwards rewinds the
// cursor to the start first (rare: song restarts).
//
// Interpolation is cubic hermite with one tangent per key shared as the
// in/out slope (the game's own curve model. Linear and static tracks ride
// the same path with zero tangents). A duplicated frame number is a step
// discontinuity: the cursor settles on the later key once the playhead
// passes it.
class Animation {
  static Channels = {
    position: 0,
    rotation: 1,
    ikTarget: 2,
  };

  static Structure = {
    magic: { type: "char", length: 4 },
    version: { type: "unsignedLong" },
    frameRate: { type: "unsignedLong" },
    frameCount: { type: "unsignedLong" },
    trackCount: { type: "unsignedLong" },
    tracks: {
      length: "trackCount",
      structure: {
        boneIndex: { type: "unsignedShort" },
        channelAxis: { type: "unsignedInteger" },
        kind: { type: "unsignedInteger" },
        keyCount: { type: "unsignedLong" },
        frames: { type: "unsignedShort", length: "keyCount" },
        values: { type: "float", length: "keyCount" },
        tangents: { type: "float", length: "keyCount" },
      },
    },
  };

  frameRate = 60;
  frameCount = 0;
  tracks = [];
  trackValues = null;

  constructor(url, arrayBuffer) {
    const parsed = new FileParser(url, arrayBuffer, Animation.Structure).parsedData;

    if (parsed.magic !== "MOT1") throw new Error(`${url} is not a MOT1 animation.`);
    if (parsed.version !== 1) throw new Error(`Unsupported MOT1 version ${parsed.version}.`);

    this.frameRate = parsed.frameRate;
    this.frameCount = parsed.frameCount;

    // a keyless track has nothing to sample and a fallback value would
    // clobber the rest offset its position slot holds, so it is dropped
    this.tracks = parsed.tracks.filter((track) => track.keyCount > 0);
    this.tracks = this.tracks.map((track) => ({
      boneIndex: track.boneIndex,
      channel: Math.floor(track.channelAxis / 3),
      axis: track.channelAxis % 3,
      frames: track.frames,
      values: track.values,
      tangents: track.tangents,
      cursor: 0,
    }));

    this.trackValues = new Float32Array(this.tracks.length);
  }

  // Sample every track at the given (fractional) frame.
  // Returns the shared trackValues buffer, one value per track in track order.
  sample(frame) {
    const { tracks, trackValues } = this;

    for (let index = 0; index < tracks.length; index++) {
      trackValues[index] = Animation.sampleTrack(tracks[index], frame);
    }

    return trackValues;
  }

  static sampleTrack(track, frame) {
    const { frames, values, tangents } = track;
    const lastIndex = frames.length - 1;

    // strict: an exact hit on a duplicated first frame settles on the
    // later key, like every other step discontinuity
    if (frame < frames[0]) return values[0];

    if (frame >= frames[lastIndex]) {
      track.cursor = lastIndex;
      return values[lastIndex];
    }

    if (frames[track.cursor] > frame) track.cursor = 0;
    while (frames[track.cursor + 1] <= frame) track.cursor++;

    // the span is never zero here: the while loop moved the cursor past
    // every key the playhead already reached, including step duplicates
    const keyIndex = track.cursor;
    const frameSpan = frames[keyIndex + 1] - frames[keyIndex];
    const t = (frame - frames[keyIndex]) / frameSpan;
    const t2 = t * t;
    const t3 = t2 * t;

    return (
      (2 * t3 - 3 * t2 + 1) * values[keyIndex] +
      (t3 - 2 * t2 + t) * frameSpan * tangents[keyIndex] +
      (-2 * t3 + 3 * t2) * values[keyIndex + 1] +
      (t3 - t2) * frameSpan * tangents[keyIndex + 1]
    );
  }
}
