class Kinematics {
  boneArray = [];
  ikArray = [];

  constructor(boneArray, ikArray) {
    this.boneArray = boneArray;
    this.ikArray = ikArray;
  }

  update = (vmdMotions) => {
    const { dot, cross, norm, clamp, invertQuat, sumVecs, subtractVecs, multiplyVecByQuat, multiplyQuats } = Utilities;
    const { boneArray, ikArray } = this;

    // will contain vmd + ik motions
    const boneMotions = {};

    for (const key in vmdMotions) {
      boneMotions[key] = {
        position: [...vmdMotions[key].position],
        rotation: [...vmdMotions[key].rotation],
      };
    }

    // parent + bone motions
    const finalMotions = [];

    const resolveFk = (boneIndex) => {
      const finalMotion = finalMotions[boneIndex];

      if (finalMotion && !finalMotion.tainted) return finalMotion;

      const bone = boneArray[boneIndex];
      const boneMotion = boneMotions[bone.name];

      if (bone.parentIndex === -1) {
        finalMotions[boneIndex] = {
          position: sumVecs(bone.position, boneMotion.position),
          rotation: boneMotion.rotation,
          tainted: false,
        };

        return finalMotions[boneIndex];
      }

      const parentFinalMotion = resolveFk(bone.parentIndex);

      const positionAfterBoneMotion = sumVecs(bone.distanceFromParent, boneMotion.position);
      const positionRotatedByParent = multiplyVecByQuat(positionAfterBoneMotion, parentFinalMotion.rotation);
      const finalPosition = sumVecs(positionRotatedByParent, parentFinalMotion.position);

      const finalRotation = multiplyQuats(parentFinalMotion.rotation, boneMotion.rotation);

      finalMotions[boneIndex] = {
        position: finalPosition,
        rotation: finalRotation,
        tainted: false,
      };

      return finalMotions[boneIndex];
    };

    const resolveIKs = () => {
      ikArray.forEach((ik) => {
        const {
          targetIndex, // index of the target bone to reach
          effectorIndex, // index of the bone that should reach the target
          chainLength,
          iterations,
          angleLimit, // maximum rotation, 1.0 = 4 radians
          linkIndices, // indices of the parents of the effector bone
        } = ik;

        const angleLimitRad = angleLimit * 4;
        const targetPos = resolveFk(targetIndex).position;

        for (let i = 0; i < iterations; i++) {
          for (let j = 0; j < chainLength; j++) {
            const linkIndex = linkIndices[j];
            const link = boneArray[linkIndex];

            const linkTransform = resolveFk(linkIndex);
            const linkParentTransform = resolveFk(link.parentIndex);
            const effectorTransform = resolveFk(effectorIndex);

            const dirToEffector = norm(subtractVecs(effectorTransform.position, linkTransform.position));
            const dirToTarget = norm(subtractVecs(targetPos, linkTransform.position));

            const cosAngle = clamp(dot(dirToTarget, dirToEffector), -1, 1);

            let angle = Math.acos(cosAngle);
            const axis = norm(cross(dirToEffector, dirToTarget));

            if (angle < 0.00001) continue;
            if (angle > angleLimitRad) angle = angleLimitRad;

            const halfAngleSin = Math.sin(angle / 2);
            const halfAngleCos = Math.cos(angle / 2);

            const ikRotation = [
              axis[0] * halfAngleSin, //
              axis[1] * halfAngleSin, //
              axis[2] * halfAngleSin, //
              halfAngleCos,
            ];

            const linkParentRotationInv = invertQuat(linkParentTransform.rotation);
            let boneMotion = multiplyQuats(multiplyQuats(linkParentRotationInv, ikRotation), linkTransform.rotation);

            // constraint rotation on hinges
            if (link.name.indexOf("ひざ") > -1) {
              const w = Math.min(boneMotion.w, 1.0);
              boneMotion = [-Math.sqrt(1 - w * w), 0, 0, w];
            }

            boneMotions[link.name].rotation = norm(boneMotion);

            for (let k = 0; k < j; k++) finalMotions[linkIndices[k]].tainted = true;

            finalMotions[linkIndex].tainted = true;
            finalMotions[effectorIndex].tainted = true;
          }
        }
      });
    };

    resolveIKs();

    for (let i = 0; i < boneArray.length; i++) resolveFk(i);

    return finalMotions;
  };
}
