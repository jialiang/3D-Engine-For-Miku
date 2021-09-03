class Camera {
  projectionMatrix;
  transform;

  constructor(gl, options = {}) {
    const { fov = 45, near = 0.1, far = 100.0 } = options;

    const aspectRatio = gl.canvas.width / gl.canvas.height;

    this.projectionMatrix = mat4.create();
    this.transform = new CameraTransform();

    mat4.perspective(this.projectionMatrix, fov, aspectRatio, near, far);
  }
}

class CameraController {
  canvas;
  camera;

  rotateRate = 300;
  panRate = 20;
  zoomRate = 400;

  effectiveRotateRate;
  effectivePanRate;
  effectiveZoomRate;

  rotateOn;

  offset;
  initialPosition;
  previousPosition;

  tainted = false;

  constructor(gl, camera) {
    this.canvas = gl.canvas;
    this.camera = camera;

    const boundingBox = this.canvas.getBoundingClientRect();

    this.offset = { x: boundingBox.left, y: boundingBox.top };
    this.initialPosition = { x: 0, y: 0 };
    this.previousPosition = { x: 0, y: 0 };

    this.effectiveRotateRate = {
      x: this.rotateRate / this.canvas.width,
      y: this.rotateRate / this.canvas.height,
    };
    this.effectivePanRate = {
      x: this.panRate / this.canvas.width,
      y: this.panRate / this.canvas.height,
    };
    this.effectiveZoomRate = this.zoomRate / this.canvas.height;

    this.rotateOn = false;

    this.canvas.onmousedown = (e) => this.handleMouseDown(e);
    this.canvas.onmouseup = () => this.handleMouseUp();
    // this.canvas.onwheel = (e) => this.handleMouseWheel(e);
  }

  handleMouseDown(e) {
    e.preventDefault();

    const { pageX, pageY, button } = e;
    const { offset } = this;

    const position = {
      x: pageX - offset.x,
      y: pageY - offset.y,
    };

    this.initialPosition = position;
    this.previousPosition = position;

    if (button === 1) this.rotateOn = true;

    this.canvas.onmousemove = (e) => this.handleMouseMove(e);
  }

  handleMouseUp() {
    this.canvas.onmousemove = null;
    this.rotateOn = false;
  }

  // handleMouseWheel(e) {
  //   const { camera, effectiveZoomRate } = this;
  //   const { deltaY } = e;

  //   const clampedDelta = Math.max(-1, Math.min(1, deltaY));
  //   const normalizedDelta = clampedDelta * effectiveZoomRate;

  //   camera.transform.panXYZ(0, 0, normalizedDelta);
  // }

  handleMouseMove(e) {
    const { pageX, pageY, shiftKey } = e;
    const { offset, previousPosition, camera, effectiveRotateRate, effectivePanRate, rotateOn } = this;

    const currentPosition = {
      x: pageX - offset.x,
      y: pageY - offset.y,
    };
    const delta = {
      x: currentPosition.x - previousPosition.x,
      y: currentPosition.y - previousPosition.y,
    };

    // if (shiftKey || rotateOn) {
    camera.transform.setTransformation({
      // rotation: [-delta.y * effectiveRotateRate.y, -delta.x * effectiveRotateRate.x, 0],
      rotation: [0, -delta.x * effectiveRotateRate.x, 0],
    });
    // } else {
    //   camera.transform.panXYZ(-delta.x * effectivePanRate.x, delta.y * effectivePanRate.y, 0);
    // }

    this.previousPosition = currentPosition;
    this.tainted = true;
  }
}
