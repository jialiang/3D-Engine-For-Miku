// Rebind the hood ribbons' vertices to the head alone, so the baked modal displacement is
// the only thing that moves them. See .ignored/plan.md, "Runtime shape".
//
// WHY THIS IS NEEDED. The runtime formula the basis was built for is
//
//   position = jointMatrix(j_kao_wj) * (rest + mean + sum of weight_i * basis_i)
//
// which assumes the head is the only thing skinning those vertices. It is not: the ribbon
// bone carries real weight along the strip, rising to 1.00 at the tip and that bone is
// driven by the committed spring bake. Left alone the vertex would be moved twice, once by
// the baked bone swing and again by the displacement that replaced it.
//
// Rebinding costs nothing at bind pose, where every palette matrix is the identity, so the
// mesh is unchanged in the modelling sense. It only changes what happens once the skeleton
// moves.
//
// WHY NOT SPLIT THE PRIMITIVE, which is what the plan first called for: 62 of the hood's
// 1,668 triangles have some corners on the ribbon and some on the hood, so no split along
// the vertex boundary is clean. Moving the 198 fully-ribbon triangles would leave those 62
// behind undeformed while their ribbon-side vertices moved, tearing the mesh at the knot.
// The basis instead carries a zero row for every non-ribbon vertex of the primitive, which
// costs 172kB and needs no surgery at all.
//
// SAFE BY CONSTRUCTION: writes a new file, re-loads it through the engine's own loader and
// checks that full linear blend skinning now equals head-only skinning and replaces the
// asset only if that holds. The original is tracked by git, so `git checkout` undoes it.
//
// usage: node tools/rebind-ribbon.js [--dry-run] [--in PATH] [--out PATH]

const fs = require("fs");
const path = require("path");

const { NodeIO } = require("@gltf-transform/core");

const ROOT = path.join(__dirname, "..");

// Matches RIBBON_WEIGHT_FLOOR in .ignored/probe-common.js: clears the 8-bit weight
// quantisation floor (1/255 is about 0.004) so a neighbouring hood vertex holding a
// rounding crumb of ribbon weight is not swept in.
const RIBBON_WEIGHT_FLOOR = 0.005;

const HOOD_MATERIAL = "m607hoodset";
const HEAD_JOINT = "j_kao_wj";
const RIBBON_JOINTS = ["j_ribon_l_000_wj", "j_ribon_r_000_wj"];

const readOption = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : fallback;
};

const main = async () => {
  const input = path.resolve(readOption("--in", path.join(ROOT, "models/pierretta/pierretta.glb")));
  // MUST END IN .glb. NodeIO picks its container from the extension, so a name like
  // "pierretta.glb.rebound" makes it write a JSON glTF with a separate .bin beside it and
  // the engine's loader then reads that JSON as binary and dies on a nonsense chunk length.
  const output = path.resolve(readOption("--out", input.replace(/\.glb$/i, ".rebound.glb")));

  if (!output.toLowerCase().endsWith(".glb")) {
    throw new Error(`--out must end in .glb so a binary container is written, got ${output}`);
  }
  const isDryRun = process.argv.includes("--dry-run");

  const io = new NodeIO();
  const document = await io.read(input);
  const root = document.getRoot();

  const skin = root.listSkins()[0];
  if (!skin) throw new Error("the glb has no skin");

  const joints = skin.listJoints();
  const indexOfJoint = (name) => joints.findIndex((joint) => joint.getName() === name);

  const head = indexOfJoint(HEAD_JOINT);
  const ribbons = RIBBON_JOINTS.map(indexOfJoint);

  if (head < 0) throw new Error(`the skin has no ${HEAD_JOINT}`);
  if (ribbons.some((joint) => joint < 0)) throw new Error("the skin is missing a ribbon joint");

  console.log(`${path.basename(input)}: ${joints.length} joints, ${HEAD_JOINT} at ${head}`);

  // The hood primitive, found by material rather than by mesh: the engine's own loader
  // names primitives after their material, so this is the same identification it uses.
  const targets = [];

  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial();
      if (!material?.getName().startsWith(HOOD_MATERIAL)) continue;
      targets.push({ mesh, primitive });
    }
  }

  if (targets.length !== 1) {
    throw new Error(`expected exactly one ${HOOD_MATERIAL} primitive, found ${targets.length}`);
  }

  const { primitive } = targets[0];
  const jointAccessor = primitive.getAttribute("JOINTS_0");
  const weightAccessor = primitive.getAttribute("WEIGHTS_0");

  if (!jointAccessor || !weightAccessor) throw new Error("the hood primitive is not skinned");
  if (primitive.getAttribute("JOINTS_1")) {
    throw new Error("the hood primitive has a second influence set, which this does not handle");
  }

  const count = jointAccessor.getCount();
  console.log(
    `  ${count} vertices; weights ${weightAccessor.getComponentType()}` +
      `${weightAccessor.getNormalized() ? " normalized" : ""}`,
  );

  // getElement and setElement work in denormalized space when the accessor is normalized,
  // so a weight of 1.0 lands as 255 in a normalized byte on its own.
  const jointSlot = [0, 0, 0, 0];
  const weightSlot = [0, 0, 0, 0];
  const rebound = [];

  for (let vertex = 0; vertex < count; vertex++) {
    jointAccessor.getElement(vertex, jointSlot);
    weightAccessor.getElement(vertex, weightSlot);

    const total = weightSlot.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) continue;

    const share = jointSlot.reduce(
      (sum, joint, slot) => (ribbons.includes(joint) ? sum + weightSlot[slot] / total : sum),
      0,
    );

    if (share < RIBBON_WEIGHT_FLOOR) continue;

    rebound.push({ vertex, share });

    if (!isDryRun) {
      jointAccessor.setElement(vertex, [head, 0, 0, 0]);
      weightAccessor.setElement(vertex, [1, 0, 0, 0]);
    }
  }

  const shares = rebound.map((entry) => entry.share).sort((left, right) => left - right);
  console.log(
    `  ${rebound.length} vertices carry ribbon weight ` +
      `(${(shares[0] * 100).toFixed(1)}% to ${(shares[shares.length - 1] * 100).toFixed(1)}%)`,
  );

  if (rebound.length !== 244) {
    throw new Error(`expected 244 ribbon vertices, found ${rebound.length}: refusing to guess`);
  }

  if (isDryRun) {
    console.log("\ndry run, nothing written");
    return;
  }

  await io.write(output, document);
  console.log(`\nwrote ${path.relative(ROOT, output)}`);

  // Verify through the ENGINE's loader, not this one, because the loader is what has to
  // agree: full linear blend skinning must now equal head-only skinning for every one of
  // those vertices, on frames spread across the take.
  const { verifyHeadOnly } = require("./verify-rebind");
  const worst = await verifyHeadOnly(
    output,
    rebound.map((entry) => entry.vertex),
  );

  console.log(`worst |full skinning - head only| over the take: ${(worst * 1000).toFixed(4)}mm`);

  // ASKED AS "not within tolerance" so that a NaN fails. Every comparison against NaN is
  // false, so the question the other way round lets an unanswerable result through as a
  // pass and this is the last check before the committed glb is replaced.
  if (!(worst <= 1e-6)) {
    throw new Error("the rebind did not take: those vertices are still driven by something else");
  }

  fs.copyFileSync(input, `${input}.backup`);
  fs.renameSync(output, input);
  console.log(
    `verified, so ${path.relative(ROOT, input)} is replaced ` +
      `(previous kept as ${path.basename(input)}.backup, and git tracks the original)`,
  );
};

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
