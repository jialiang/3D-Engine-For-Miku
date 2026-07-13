class VMD extends FileParser {
  static Structure = {
    header: {
      magic: { type: "char", length: 30 },
      modelName: { type: "char", length: 20 },
    },
    motions: {
      count: { type: "long" },
      array: {
        length: "count",
        structure: {
          boneName: { type: "char", length: 15 },
          frameNum: { type: "long" },
          position: { type: "float", length: 3 },
          rotation: { type: "float", length: 4 },
          translateInterpolationX: { type: "float", length: 4 },
          translateInterpolationY: { type: "float", length: 4 },
          translateInterpolationZ: { type: "float", length: 4 },
          rotateInterpolation: { type: "float", length: 4 },
        },
      },
    },
    weights: {
      count: { type: "long" },
      array: {
        length: "count",
        structure: {
          morphName: { type: "char", length: 15 },
          frameNum: { type: "long" },
          weight: { type: "float" },
        },
      },
    },
  };

  boneToMotions = {};
  morphToWeights = {};

  activeBones = [];
  activeMorphs = [];

  lastConsumedFrameNum = -1;
  maxFrameNum = 0; // no further animation after this frame number

  constructor(url, arrayBuffer) {
    super(url, arrayBuffer, VMD.Structure);

    this.groupFramesByName();
  }

  groupFramesByName = () => {
    const { parsedData } = this;

    const group = (array, key) => {
      const map = {};

      array.forEach((data) => {
        const name = data[key];
        const frameNum = data.frameNum;

        if (frameNum > this.maxFrameNum) this.maxFrameNum = frameNum;

        if (map[name] == null) map[name] = { consumed: [], available: [] };

        map[name].available.push(data);
      });

      return map;
    };

    const boneToMotions = group(parsedData.motions.array, "boneName");
    const morphToWeights = group(parsedData.weights.array, "morphName");

    for (const key in boneToMotions)
      boneToMotions[key].available.sort((a, b) => a.frameNum - b.frameNum);
    for (const key in morphToWeights)
      morphToWeights[key].available.sort((a, b) => a.frameNum - b.frameNum);

    this.boneToMotions = boneToMotions;
    this.morphToWeights = morphToWeights;
  };

  // rewind the animation to the beginning so it can play again
  reset = () => {
    const restore = (map) => {
      for (const key in map) {
        const track = map[key];

        // frames were consumed in order, so putting them back in front
        // of the remaining ones restores the original sorted order
        track.available = [...track.consumed, ...track.available];
        track.consumed = [];
      }
    };

    restore(this.boneToMotions);
    restore(this.morphToWeights);

    this.lastConsumedFrameNum = -1;
  };

  // identify which bone and morph in vmd is present in pmd
  // so that we can skip those that are not in pmd when animating
  setActiveDataByPmd = (pmd) => {
    const findMissingAndActive = (inVmd, inPmd) => {
      const missing = [];
      const active = [];

      for (const name in inVmd) {
        if (inPmd[name] == null) missing.push(name);
        else active.push(name);
      }

      return {
        missing,
        active,
      };
    };

    const { boneToMotions: bonesInVmd, morphToWeights: morphsInVmd } = this;
    const bonesInPmd = pmd.parsedData.bones.hash;
    const morphsInPmd = pmd.parsedData.morphs.hash;

    const boneReport = findMissingAndActive(bonesInVmd, bonesInPmd);
    const morphReport = findMissingAndActive(morphsInVmd, morphsInPmd);

    console.info(`${boneReport.active.length} compatible bones.`);
    console.info(`${morphReport.active.length} compatible morphs.`);

    console.info(`${boneReport.missing.length} missing bones:\n${boneReport.missing.join("\n")}`);
    console.info(
      `${morphReport.missing.length} missing morphs:\n${morphReport.missing.join("\n")}`,
    );

    this.activeBones = boneReport.active;
    this.activeMorphs = morphReport.active;
  };

  // get all motions of next frame
  getNextAnimation = (timeElapsed) => {
    const { activeBones, activeMorphs, lastConsumedFrameNum } = this;
    const motions = {};
    const weights = {};

    // VMD runs at 30 fps
    const frameIncrement = timeElapsed === -1 ? 1 : timeElapsed / (1000 / 30);
    const frameNumToConsume = lastConsumedFrameNum + frameIncrement;

    activeBones.forEach(
      (boneName) => (motions[boneName] = this.getNextMotion(boneName, frameNumToConsume)),
    );
    activeMorphs.forEach(
      (morphName) => (weights[morphName] = this.getNextWeight(morphName, frameNumToConsume)),
    );

    this.lastConsumedFrameNum += frameIncrement;

    return {
      motions,
      weights,
    };
  };

  getNextMotion = (boneName, targetFrameNum) => {
    const { boneToMotions } = this;
    const { consumed, available } = boneToMotions[boneName];

    const firstAvailable = available[0];
    const lastConsumed = consumed[consumed.length - 1];
    const zero = {
      frameNum: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    };

    // all motion used up, return last motion for bone
    if (firstAvailable == null) return lastConsumed || zero;

    // exact match
    if (firstAvailable.frameNum === targetFrameNum) {
      consumed.push(available.shift());
      return firstAvailable;
    }

    // target frame number between last consumed and first available
    // so interpolate between those 2
    if (firstAvailable.frameNum > targetFrameNum) {
      const result = {
        frameNum: targetFrameNum,
        position: [],
        rotation: [],
      };

      const minValue = lastConsumed || zero;
      const maxValue = firstAvailable;

      // duplicate keyframes can share a frame number,
      // avoid dividing by zero by taking the newer one outright
      const frameSpan = maxValue.frameNum - minValue.frameNum;
      const weightOfMax = frameSpan === 0 ? 1 : (targetFrameNum - minValue.frameNum) / frameSpan;

      const interpolatedPosition = Utilities.vectorLerp(
        maxValue.position,
        minValue.position,
        weightOfMax,
      );
      const interpolatedRotation = Utilities.quatenionSlerp(
        maxValue.rotation,
        minValue.rotation,
        weightOfMax,
      );

      result.position.push(...interpolatedPosition);
      result.rotation.push(...interpolatedRotation);

      return result;
    }

    // firstAvailable.frameNum < targetFrameNum

    consumed.push(available.shift());
    return this.getNextMotion(boneName, targetFrameNum);
  };

  getNextWeight = (morphName, targetFrameNum) => {
    const { morphToWeights } = this;
    const { consumed, available } = morphToWeights[morphName];

    const firstAvailable = available[0];
    const lastConsumed = consumed[consumed.length - 1];
    const zero = {
      frameNum: 0,
      weight: 0,
    };

    // all frames used up, return last frame or default value
    if (firstAvailable == null) return (lastConsumed || zero).weight;

    //exact match
    if (firstAvailable.frameNum === targetFrameNum) {
      consumed.push(available.shift());
      return firstAvailable.weight;
    }

    // target frame number between last consumed and first available
    // so interpolate between those 2
    if (firstAvailable.frameNum > targetFrameNum) {
      const minValue = lastConsumed || zero;
      const maxValue = firstAvailable;

      // same divide-by-zero guard as in getNextMotion
      const frameSpan = maxValue.frameNum - minValue.frameNum;
      const weightOfMax = frameSpan === 0 ? 1 : (targetFrameNum - minValue.frameNum) / frameSpan;

      return Utilities.lerp(maxValue.weight, minValue.weight, weightOfMax);
    }

    // firstAvailable.frameNum < targetFrameNum

    consumed.push(available.shift());
    return this.getNextWeight(morphName, targetFrameNum);
  };
}
