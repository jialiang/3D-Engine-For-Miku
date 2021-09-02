class Transform {
  position;
  scale;
  rotation;

  modelMatrix;
  normalMatrix;

  forward;
  up;
  right;

  constructor() {
    this.position = [0, 0, 0];
    this.scale = [1, 1, 1];
    this.rotation = [0, 0, 0];

    this.modelMatrix = mat4.create();
    this.normalMatrix = mat4.create();

    this.forward = [0, 0, 0, 0];
    this.up = [0, 0, 0, 0];
    this.right = [0, 0, 0, 0];
  }

  static toRadian = (deg) => (deg * Math.PI) / 180;

  setTransformation(options) {
    const { position, scale, rotation, isIncremental = true } = options;
    const { position: oldPosition, scale: oldScale, rotation: oldRotation } = this;
    const { sumVecs } = Utilities;

    let newPosition = [0, 0, 0];
    let newScale = [0, 0, 0];
    let newRotation = [0, 0, 0];

    if (position) newPosition = position;
    if (scale) newScale = scale;
    if (rotation) newRotation = rotation;

    if (isIncremental) {
      if (position) newPosition = sumVecs(newPosition, oldPosition);
      if (scale) newScale = sumVecs(newScale, oldScale);
      if (rotation) newRotation = sumVecs(newRotation, oldRotation);
    }

    if (position) this.position = newPosition;
    if (scale) this.scale = newScale;
    if (rotation) this.rotation = newRotation;

    this.updateMatrix();

    return this;
  }

  updateMatrix() {
    const { modelMatrix, position, scale, rotation } = this;
    const { toRadian } = Transform;

    mat4.identity(modelMatrix);
    mat4.translate(modelMatrix, modelMatrix, position);
    mat4.rotateX(modelMatrix, modelMatrix, toRadian(rotation[0]));
    mat4.rotateY(modelMatrix, modelMatrix, toRadian(rotation[1]));
    mat4.rotateZ(modelMatrix, modelMatrix, toRadian(rotation[2]));
    mat4.scale(modelMatrix, modelMatrix, scale);

    this.calculateNormal();
    this.calculateOrientation();

    return modelMatrix;
  }

  calculateNormal() {
    const { modelMatrix } = this;

    const normalMatrix = mat4.create();

    mat4.invert(normalMatrix, modelMatrix);
    mat4.transpose(normalMatrix, normalMatrix);

    this.normalMatrix = normalMatrix;

    return normalMatrix;
  }

  calculateOrientation() {
    const { right, up, forward, modelMatrix } = this;
    const { multiplyVecByMat4 } = Utilities;

    const newRight = [1, 0, 0, 0];
    const newUp = [0, 1, 0, 0];
    const newForward = [0, 0, 1, 0];

    this.right = multiplyVecByMat4(newRight, modelMatrix);
    this.up = multiplyVecByMat4(newUp, modelMatrix);
    this.forward = multiplyVecByMat4(newForward, modelMatrix);

    return [right, up, forward];
  }
}

class CameraTransform extends Transform {
  viewMatrix;

  constructor() {
    super();

    this.viewMatrix = mat4.create();
  }

  panXYZ(x = 0, y = 0, z = 0) {
    const { up } = this;

    let newX = 0;
    let newY = 0;
    let newZ = 0;

    // panY
    newY += up[1] * y;

    // panZ
    newZ = z;

    return this.setTransformation({
      position: [newX, newY, newZ],
    });
  }

  updateMatrix() {
    const { modelMatrix, viewMatrix, position, rotation } = this;
    const { toRadian } = CameraTransform;

    // Order important!
    mat4.identity(modelMatrix);
    mat4.rotateZ(modelMatrix, modelMatrix, toRadian(rotation[2]));
    mat4.rotateY(modelMatrix, modelMatrix, toRadian(rotation[1]));
    mat4.rotateX(modelMatrix, modelMatrix, toRadian(rotation[0]));
    mat4.translate(modelMatrix, modelMatrix, position);

    this.calculateOrientation();
    this.calculateViewMatrix();

    return viewMatrix;
  }

  calculateViewMatrix() {
    const { viewMatrix, modelMatrix } = this;

    mat4.invert(viewMatrix, modelMatrix);

    return viewMatrix;
  }
}
