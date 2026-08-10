// The maths Skeleton's posing needs, all of it pure and lifted from the game (ReDIVA).
//
// Two groups: the sine/cosine matrix operations, which take a rotation already resolved to
// its sine and cosine rather than an angle and the aiming helpers the procedural bones use
// to point one bone at another. They sit apart from Skeleton because none of them touches an
// instance, which is the only seam that file has.
class BoneMath {
  static limitAngle(angle) {
    const wrapped = ((Math.abs(angle) + Math.PI) % (Math.PI * 2)) - Math.PI;
    return angle < 0 ? -wrapped : wrapped;
  }

  // aim the matrix's local +X at a world target (ReDIVA exp_set_dir,
  // including its hacky Gram-Schmidt for the secondary axes)
  static expSetDir(world, targetX, targetY, targetZ, scratch) {
    BoneMath.inverseTransformPoint(world, [targetX, targetY, targetZ], scratch);

    const x = BoneMath.normalize(scratch);
    if (!x) return;

    const z = [-x[0] * x[2] - x[2], -x[2] * x[1], x[0] * x[0] + x[1] * x[1] + x[0]];
    if (!BoneMath.normalize(z)) return;

    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];

    BoneMath.applyRotationColumns(world, x, y, z);
  }

  // aim the matrix's local +Y along a direction given in local space
  // (ReDIVA exp_set_dir_zx)
  static expSetDirZX(world, direction) {
    const y = BoneMath.normalize(direction);
    if (!y) return;

    const z = [-y[0] * y[2], -y[2] * y[1] - y[2], y[1] * y[1] + y[0] * y[0] + y[1]];
    if (!BoneMath.normalize(z)) return;

    const x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];

    BoneMath.applyRotationColumns(world, x, y, z);
  }

  // lean the matrix about its local X by a fraction of the angle toward a
  // world target (ReDIVA exp_set_rot)
  static expSetRot(world, targetX, targetY, targetZ, factor, scratch) {
    BoneMath.inverseTransformPoint(world, [targetX, targetY, targetZ], scratch);

    const length = Math.hypot(scratch[1], scratch[2]);
    if (length <= 1e-6) return;

    const angle = Math.atan2(scratch[2], scratch[1]) * factor;
    BoneMath.rotateXSinCos(world, Math.sin(angle), Math.cos(angle));
  }

  static normalize(vector) {
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    if (length * length <= 1e-6) return null;

    vector[0] /= length;
    vector[1] /= length;
    vector[2] /= length;
    return vector;
  }

  // multiply a rotation given by its three column vectors onto the matrix
  static applyRotationColumns(matrix, x, y, z) {
    for (let row = 0; row < 3; row++) {
      const a = matrix[row];
      const b = matrix[4 + row];
      const c = matrix[8 + row];
      matrix[row] = a * x[0] + b * x[1] + c * x[2];
      matrix[4 + row] = a * y[0] + b * y[1] + c * y[2];
      matrix[8 + row] = a * z[0] + b * z[1] + c * z[2];
    }
  }

  // append rotations given as sine/cosine pairs onto a column-major matrix
  // (the solver works in sine/cosine directly, as the game does)
  static rotateZSinCos(matrix, sin, cos) {
    for (let i = 0; i < 4; i++) {
      const a = matrix[i];
      const b = matrix[4 + i];
      matrix[i] = a * cos + b * sin;
      matrix[4 + i] = b * cos - a * sin;
    }
  }

  static rotateYSinCos(matrix, sin, cos) {
    for (let i = 0; i < 4; i++) {
      const a = matrix[i];
      const b = matrix[8 + i];
      matrix[i] = a * cos - b * sin;
      matrix[8 + i] = a * sin + b * cos;
    }
  }

  static rotateXSinCos(matrix, sin, cos) {
    for (let i = 0; i < 4; i++) {
      const a = matrix[4 + i];
      const b = matrix[8 + i];
      matrix[4 + i] = a * cos + b * sin;
      matrix[8 + i] = b * cos - a * sin;
    }
  }

  static translateX(matrix, x) {
    matrix[12] += matrix[0] * x;
    matrix[13] += matrix[1] * x;
    matrix[14] += matrix[2] * x;
  }

  // rigid inverse: rotate the offset from the matrix's translation back
  // through the transposed rotation
  static inverseTransformPoint(matrix, point, out) {
    const x = point[0] - matrix[12];
    const y = point[1] - matrix[13];
    const z = point[2] - matrix[14];
    out[0] = matrix[0] * x + matrix[1] * y + matrix[2] * z;
    out[1] = matrix[4] * x + matrix[5] * y + matrix[6] * z;
    out[2] = matrix[8] * x + matrix[9] * y + matrix[10] * z;
  }
}
