// Does the engine's own loader agree that the ribbon vertices are head-driven?
//
// Kept apart from tools/rebind-ribbon.js on purpose. The rebind is performed with
// gltf-transform and has to be checked with the loader the engine actually ships, or all
// it proves is that gltf-transform can read back what gltf-transform wrote. This loads the
// candidate glb through GLTF.js and compares full linear blend skinning against skinning by
// the head alone, which is the assumption the shipped basis rests on.
//
// usage: node tools/verify-rebind.js [PATH]

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

const HOOD_MATERIAL = "m607hoodset";
const HEAD_JOINT = "j_kao_wj";

// Spread rather than exhaustive: the palettes differ most where the head turns fastest and
// a rebind that held on these but not elsewhere would have to be a very strange bug.
const FRAMES = [0, 860, 3000, 5800, 8788, 12000, 16383, 18350];

let loadedClasses = null;

// Memoised because vm.runInThisContext declares into the SHARED global, so calling this
// twice in one process throws "Identifier 'glMatrix' has already been declared".
const loadClasses = () => {
  if (loadedClasses) return loadedClasses;

  const sources = [
    "glMatrix-mat4.js",
    "Utilities.js",
    "FileParser.js",
    "GLTF.js",
    "Animation.js",
    "OsageRig.js",
    "BoneMath.js",
    "Rig.js",
    "Skeleton.js",
  ]
    .map((file) => fs.readFileSync(path.join(ROOT, file), "utf8"))
    .join("\n");

  loadedClasses = vm.runInThisContext(
    `${sources}\n({ mat4, Utilities, GLTF, Animation, Skeleton })`,
  );

  return loadedClasses;
};

const readBuffer = (file) => {
  const buffer = fs.readFileSync(file);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

// THE SET TO CHECK IS PASSED IN, NOT DERIVED FROM THE WEIGHTS. Selecting "vertices the head
// does not already own" was the first version and the rebind makes that set empty: the
// check would then iterate nothing and report a flawless pass on the very run it is meant to
// validate. The same shape of bug once had a knot-drift gate reporting 0.00mm while the
// ribbon left the head by 130mm. Identify the vertices before changing them.
const verifyHeadOnly = async (file, indices) => {
  if (!indices?.length) throw new Error("no vertices to check, so there is nothing to prove");

  const { Utilities, GLTF, Animation, Skeleton } = loadClasses();
  Utilities.loadImage = async () => null;

  const { loadMergedMotion } = require("./mot1");
  const motions = path.join(ROOT, "motions");

  const model = await GLTF.load(readBuffer(file));
  const skeletonJson = JSON.parse(fs.readFileSync(path.join(motions, "mik_skeleton.json"), "utf8"));

  const animation = new Animation("pv_743.bin", loadMergedMotion(path.join(motions, "pv_743")));
  // No ribbon chain rig: it was retired with the spring bake this rebind replaced. The
  // comparison does not need it either, since what it checks is that these vertices follow
  // the head and nothing else.
  const skeleton = new Skeleton(skeletonJson, animation, model.skin, model.nodes);

  const primitive = model.primitives.find((entry) => entry.name.startsWith(HOOD_MATERIAL));
  if (!primitive) throw new Error(`no ${HOOD_MATERIAL} primitive`);

  const { position, boneIndices, boneWeights } = primitive.attributeBuffer;

  // A missed lookup returns -1, which indexes the palette out of bounds and turns every
  // comparison below into NaN. NaN then slips through both this file's gate and the
  // baker's, because every comparison against it is false, so the check passes by being
  // unanswerable. Fail here instead.
  const head = model.skin.jointNames.indexOf(HEAD_JOINT);
  if (head < 0) throw new Error(`the skin has no ${HEAD_JOINT}`);

  const transform = (matrix, point) => [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];

  let worst = 0;

  for (const frame of FRAMES) {
    const palette = skeleton.pose(animation, Math.min(frame, animation.frameCount - 1));

    for (const vertex of indices) {
      const raw = [0, 1, 2, 3].map((slot) => boneWeights[vertex * 4 + slot]);
      const total = raw.reduce((sum, weight) => sum + weight, 0);
      if (total <= 0) continue;

      const rest = [position[vertex * 3], position[vertex * 3 + 1], position[vertex * 3 + 2]];
      let blended = [0, 0, 0];

      raw.forEach((weight, slot) => {
        if (weight <= 0) return;

        const joint = boneIndices[vertex * 4 + slot];
        const moved = transform(palette.subarray(joint * 16, joint * 16 + 16), rest);
        blended = [0, 1, 2].map((axis) => blended[axis] + moved[axis] * (weight / total));
      });

      const headOnly = transform(palette.subarray(head * 16, head * 16 + 16), rest);
      worst = Math.max(
        worst,
        Math.hypot(...[0, 1, 2].map((axis) => blended[axis] - headOnly[axis])),
      );
    }
  }

  return worst;
};

// Which vertices carry ribbon weight, read from a glb that still has the original weights.
// The selection matches tools/rebind-ribbon.js: total ribbon share over the quantisation
// floor, which at 8-bit weights is about 0.004.
const ribbonVerticesOf = async (file) => {
  const { Utilities, GLTF } = loadClasses();
  Utilities.loadImage = async () => null;

  const model = await GLTF.load(readBuffer(file));
  const primitive = model.primitives.find((entry) => entry.name.startsWith(HOOD_MATERIAL));
  if (!primitive) throw new Error(`no ${HOOD_MATERIAL} primitive in ${path.basename(file)}`);

  const { boneIndices, boneWeights, position } = primitive.attributeBuffer;
  const ribbons = ["j_ribon_l_000_wj", "j_ribon_r_000_wj"].map((name) =>
    model.skin.jointNames.indexOf(name),
  );

  const indices = [];

  for (let vertex = 0; vertex < position.length / 3; vertex++) {
    const raw = [0, 1, 2, 3].map((slot) => boneWeights[vertex * 4 + slot]);
    const total = raw.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) continue;

    const share = raw.reduce(
      (sum, weight, slot) =>
        ribbons.includes(boneIndices[vertex * 4 + slot]) ? sum + weight / total : sum,
      0,
    );

    if (share >= 0.005) indices.push(vertex);
  }

  return indices;
};

module.exports = { verifyHeadOnly, ribbonVerticesOf };

if (require.main === module) {
  const file = process.argv[2] ?? path.join(ROOT, "models/pierretta/pierretta.glb");

  // Standalone, the set comes from the pre-rebind backup, because the rebound file can no
  // longer tell you which vertices used to carry ribbon weight.
  const backup = `${path.join(ROOT, "models/pierretta/pierretta.glb")}.backup`;
  if (!fs.existsSync(backup)) {
    console.error(`need ${path.basename(backup)} to know which vertices to check`);
    process.exit(1);
  }

  ribbonVerticesOf(backup)
    .then((indices) => verifyHeadOnly(file, indices))
    .then((worst) => {
      console.log(`${path.relative(ROOT, file)}: worst deviation ${(worst * 1000).toFixed(4)}mm`);

      // Phrased so a NaN fails rather than passes: see the same gate in rebind-ribbon.js.
      if (!(worst <= 1e-6)) {
        console.error("SOME vertices are still driven by another joint");
        process.exit(1);
      }

      console.log("every non-head-owned vertex of the hood primitive skins as head-only");
    })
    .catch((error) => {
      console.error(error.message ?? error);
      process.exit(1);
    });
}
