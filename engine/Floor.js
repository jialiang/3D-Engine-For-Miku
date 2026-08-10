class Floor {
  dataForAttributeBuffer = {};
  transform = new Transform();

  constructor(size = 60) {
    const half = size / 2;

    // prettier-ignore
    this.dataForAttributeBuffer = {
      position: [
        -half, 0, -half,
        half, 0, -half,
        -half, 0, half,

        -half, 0, half,
        half, 0, -half,
        half, 0, half,
      ],
    };

    this.verticesToDrawCount = 6;
  }
}
