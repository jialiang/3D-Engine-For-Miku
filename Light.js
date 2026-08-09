class Light {
  color;
  transform = new CameraTransform();

  constructor(options = {}) {
    const {
      color = [1, 1, 1],
      position = [0, 0, 0],
      rotation = [0, 0, 0],
      projectionSize = 1,
    } = options;

    this.color = color;
    this.transform.setTransformation({ position, rotation });

    // a square frustum to match the square shadow map
    const width = projectionSize;
    const height = projectionSize;

    this.projectionMatrix = mat4.create();
    this.transformationMatrix = mat4.create();

    mat4.ortho(this.projectionMatrix, -width / 2, width / 2, -height / 2, height / 2, 0.1, 100);

    this.updateTransformation();
  }

  // World space into shadow-map texture space: project, then the half-scale-and-offset that
  // takes clip coordinates into the 0..1 the depth texture is sampled with.
  //
  // REBUILT WHENEVER THE LIGHT MOVES, which is why it is no longer inlined in the constructor.
  // A shadow frustum fixed at the world origin only covers a subject standing there and this
  // one is 30 units across against a character that travels nearly 2 metres of scene space
  // (24 units). Walk out of it and the shadow simply stops.
  updateTransformation() {
    const { transformationMatrix, projectionMatrix, transform } = this;

    mat4.identity(transformationMatrix);
    mat4.translate(transformationMatrix, transformationMatrix, [0.5, 0.5, 0.5]);
    mat4.scale(transformationMatrix, transformationMatrix, [0.5, 0.5, 0.5]);
    mat4.multiply(transformationMatrix, transformationMatrix, projectionMatrix);
    mat4.multiply(transformationMatrix, transformationMatrix, transform.viewMatrix);

    return transformationMatrix;
  }

  // Re-centre the frustum on `pivot`, keeping the light's direction and its offset along it.
  follow(pivot) {
    this.transform.setPivot(pivot);

    return this.updateTransformation();
  }
}
