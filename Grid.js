class Grid {
  dataForAttributeBuffer = {};
  numberOfVerticesToDraw = 0;
  transform = new Transform();

  constructor(size = 2, horizontalCount = 13, verticalCount = 13) {
    const halfSize = size / 2;
    const positionArray = [];

    const totalVertices = (horizontalCount + verticalCount) * 2;

    for (let i = 0; i < horizontalCount; i++) {
      const y = (size / (horizontalCount - 1)) * i - halfSize;

      positionArray.push(y);
      positionArray.push(0);
      positionArray.push(-halfSize);

      positionArray.push(y);
      positionArray.push(0);
      positionArray.push(halfSize);
    }

    for (let i = 0; i < verticalCount; i++) {
      const x = (size / (verticalCount - 1)) * i - halfSize;

      positionArray.push(-halfSize);
      positionArray.push(0);
      positionArray.push(x);

      positionArray.push(halfSize);
      positionArray.push(0);
      positionArray.push(x);
    }

    const colorArray = Array(totalVertices)
      .fill(0)
      .reduce((total) => {
        total.push(0.9);
        total.push(0.9);
        total.push(0.9);
        total.push(1);
        return total;
      }, []);

    const normalArray = Array(totalVertices)
      .fill(0)
      .reduce((total) => {
        total.push(0);
        total.push(1);
        total.push(0);
        return total;
      }, []);

    this.dataForAttributeBuffer = {
      position: positionArray,
      normal: normalArray,
      color: colorArray,
    };
    this.verticesToDrawCount = totalVertices;
  }
}
