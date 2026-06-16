import { Cartesian3, Matrix3, ProjectedImageCollection } from "../../index.js";

describe("Scene/ProjectedImageCollection", function () {
  describe("fromCCOrientationsXml", function () {
    // Known rotation matrix (world→camera, row-major M_ij):
    //   Row 0: [0.1, 0.2, 0.3]
    //   Row 1: [0.4, 0.5, 0.6]
    //   Row 2: [0.7, 0.8, 0.9]
    // After transpose (camera→world), visual layout becomes:
    //   [0.1, 0.4, 0.7]
    //   [0.2, 0.5, 0.8]
    //   [0.3, 0.6, 0.9]
    // Column 0 = (0.1, 0.2, 0.3) = original Row 0
    // Column 1 = (0.4, 0.5, 0.6) = original Row 1
    // Column 2 = (0.7, 0.8, 0.9) = original Row 2
    // After XRightYDown adjustment (negate col 1):
    //   Col 1: (-0.4, -0.5, -0.6)

    const KNOWN_XML = `<?xml version="1.0"?>
<BlocksExchange>
  <Block>
    <Photogroup>
      <ImageDimensions><Width>100</Width><Height>100</Height></ImageDimensions>
      <FocalLength>50</FocalLength>
      <SensorSize>36</SensorSize>
      <Photo>
        <Id>0</Id>
        <ImagePath>test.jpg</ImagePath>
        <Pose>
          <Rotation>
            <M_00>0.1</M_00><M_01>0.2</M_01><M_02>0.3</M_02>
            <M_10>0.4</M_10><M_11>0.5</M_11><M_12>0.6</M_12>
            <M_20>0.7</M_20><M_21>0.8</M_21><M_22>0.9</M_22>
          </Rotation>
          <Center><x>-4052052</x><y>2966088</y><z>-3873742</z></Center>
        </Pose>
      </Photo>
    </Photogroup>
  </Block>
</BlocksExchange>`;

    it("transposes rotation matrix from world-to-camera to camera-to-world", async function () {
      const collection = await ProjectedImageCollection.fromCCOrientationsXml(
        KNOWN_XML,
        {
          resolveImageUrl: () => "http://example.com/test.jpg",
        },
      );

      expect(collection.length).toBe(1);

      const item = collection.get(0);
      const rot = item.primitive._cameraRotation;

      // Column 0 (right) = original Row 0 of XML
      const col0 = new Cartesian3();
      Matrix3.getColumn(rot, 0, col0);
      expect(col0.x).toBeCloseTo(0.1, 10);
      expect(col0.y).toBeCloseTo(0.2, 10);
      expect(col0.z).toBeCloseTo(0.3, 10);

      // Column 1 (up) = negated original Row 1 (XRightYDown: up = -down)
      const col1 = new Cartesian3();
      Matrix3.getColumn(rot, 1, col1);
      expect(col1.x).toBeCloseTo(-0.4, 10);
      expect(col1.y).toBeCloseTo(-0.5, 10);
      expect(col1.z).toBeCloseTo(-0.6, 10);

      // Column 2 (forward) = original Row 2 of XML
      const col2 = new Cartesian3();
      Matrix3.getColumn(rot, 2, col2);
      expect(col2.x).toBeCloseTo(0.7, 10);
      expect(col2.y).toBeCloseTo(0.8, 10);
      expect(col2.z).toBeCloseTo(0.9, 10);
    });
  });
});
