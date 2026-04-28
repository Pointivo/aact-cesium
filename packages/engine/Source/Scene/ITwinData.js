import Cesium3DTileset from "./Cesium3DTileset.js";
import defined from "../Core/defined.js";
import Resource from "../Core/Resource.js";
import ITwinPlatform from "../Core/ITwinPlatform.js";
import RuntimeError from "../Core/RuntimeError.js";
import Check from "../Core/Check.js";
import KmlDataSource from "../DataSources/KmlDataSource.js";
import GeoJsonDataSource from "../DataSources/GeoJsonDataSource.js";
import DeveloperError from "../Core/DeveloperError.js";
import ProjectedImageCollection from "./ProjectedImageCollection.js";

/**
 * Methods for loading iTwin platform data into CesiumJS
 *
 * @experimental This feature is not final and is subject to change without Cesium's standard deprecation policy.
 *
 * @see ITwinPlatform
 * @namespace ITwinData
 */
const ITwinData = {};

/**
 * Create a {@link Cesium3DTileset} for the given iModel id using iTwin's Mesh Export API.
 *
 * If there is not a completed export available for the given iModel id, the returned promise will resolve to <code>undefined</code>.
 * We recommend waiting 10-20 seconds and trying to load the tileset again.
 * If all exports are Invalid this will throw an error.
 *
 * See the {@link https://developer.bentley.com/apis/mesh-export/overview/|iTwin Platform Mesh Export API documentation} for more information on request parameters
 *
 * @example
 * const tileset = await Cesium.ITwinData.createTilesetFromIModelId({ iModelId });
 * if (Cesium.defined(tileset)) {
 *   viewer.scene.primitives.add(tileset);
 * }
 *
 * @experimental This feature is not final and is subject to change without Cesium's standard deprecation policy.
 *
 * @param {object} options
 * @param {string} options.iModelId The id of the iModel to load
 * @param {Cesium3DTileset.ConstructorOptions} [options.tilesetOptions] Object containing options to pass to the internally created {@link Cesium3DTileset}.
 * @param {string} [options.changesetId] The id of the changeset to load, if not provided the latest changesets will be used
 * @returns {Promise<Cesium3DTileset | undefined>} A promise that will resolve to the created 3D tileset or <code>undefined</code> if there is no completed export for the given iModel id
 *
 * @throws {RuntimeError} If all exports for the given iModel are Invalid
 * @throws {RuntimeError} If the iTwin API request is not successful
 */
ITwinData.createTilesetFromIModelId = async function ({
  iModelId,
  changesetId,
  tilesetOptions,
}) {
  const { exports } = await ITwinPlatform.getExports(iModelId, changesetId);

  if (
    exports.length > 0 &&
    exports.every((exportObj) => {
      return exportObj.status === ITwinPlatform.ExportStatus.Invalid;
    })
  ) {
    throw new RuntimeError(
      `All exports for this iModel are Invalid: ${iModelId}`,
    );
  }

  const completeExport = exports.find((exportObj) => {
    return exportObj.status === ITwinPlatform.ExportStatus.Complete;
  });

  if (!defined(completeExport)) {
    return;
  }

  // Convert the link to the tileset url while preserving the search paramaters
  // This link is only valid 1 hour
  const baseUrl = new URL(completeExport._links.mesh.href);
  baseUrl.pathname = `${baseUrl.pathname}/tileset.json`;
  const tilesetUrl = baseUrl.toString();

  const resource = new Resource({
    url: tilesetUrl,
  });

  return Cesium3DTileset.fromUrl(resource, tilesetOptions);
};

/**
 * Create a tileset for the specified reality data id. This function only works
 * with 3D Tiles meshes and point clouds.
 *
 * If the <code>type</code> or <code>rootDocument</code> are not provided this function
 * will first request the full metadata for the specified reality data to fill these values.
 *
 * The <code>maximumScreenSpaceError</code> of the resulting tileset will default to 4,
 * unless it is explicitly overridden with the given tileset options.
 *
 * @experimental This feature is not final and is subject to change without Cesium's standard deprecation policy.
 *
 * @param {object} options
 * @param {string} options.iTwinId The id of the iTwin to load data from
 * @param {string} options.realityDataId The id of the reality data to load
 * @param {ITwinPlatform.RealityDataType} [options.type] The type of this reality data
 * @param {string} [options.rootDocument] The path of the root document for this reality data
 * @param {Cesium3DTileset.ConstructorOptions} [options.tilesetOptions] Object containing
 * options to pass to the internally created {@link Cesium3DTileset}.
 * @returns {Promise<Cesium3DTileset>}
 *
 * @throws {RuntimeError} if the type of reality data is not supported by this function
 */
ITwinData.createTilesetForRealityDataId = async function ({
  iTwinId,
  realityDataId,
  type,
  rootDocument,
  tilesetOptions,
}) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.string("iTwinId", iTwinId);
  Check.typeOf.string("realityDataId", realityDataId);
  if (defined(type)) {
    Check.typeOf.string("type", type);
  }
  if (defined(rootDocument)) {
    Check.typeOf.string("rootDocument", rootDocument);
  }
  //>>includeEnd('debug');

  if (!defined(type) || !defined(rootDocument)) {
    const metadata = await ITwinPlatform.getRealityDataMetadata(
      iTwinId,
      realityDataId,
    );
    rootDocument = metadata.rootDocument;
    type = metadata.type;
  }

  const supportedRealityDataTypes = [
    ITwinPlatform.RealityDataType.Cesium3DTiles,
    ITwinPlatform.RealityDataType.PNTS,
    ITwinPlatform.RealityDataType.RealityMesh3DTiles,
    ITwinPlatform.RealityDataType.Terrain3DTiles,
    ITwinPlatform.RealityDataType.GaussianSplat3DTiles,
    ITwinPlatform.RealityDataType.GaussianSplats,
  ];

  if (!supportedRealityDataTypes.includes(type)) {
    throw new RuntimeError(`Reality data type is not a mesh type: ${type}`);
  }

  const tilesetAccessUrl = await ITwinPlatform.getRealityDataURL(
    iTwinId,
    realityDataId,
    rootDocument,
  );

  // The maximum screen space error was defined to default to 4 for
  // reality data tilesets, because they did not show the expected
  // amount of detail with the default value of 16. Values that are
  // given in the tilesetOptions should still override that default.
  const internalTilesetOptions = {
    maximumScreenSpaceError: 4,
    ...tilesetOptions,
  };

  return Cesium3DTileset.fromUrl(tilesetAccessUrl, internalTilesetOptions);
};

/**
 * Create a data source of the correct type for the specified reality data id.
 * This function only works for KML and GeoJSON type data.
 *
 * If the <code>type</code> or <code>rootDocument</code> are not provided this function
 * will first request the full metadata for the specified reality data to fill these values.
 *
 * @param {object} options
 * @param {string} options.iTwinId The id of the iTwin to load data from
 * @param {string} options.realityDataId The id of the reality data to load
 * @param {ITwinPlatform.RealityDataType} [options.type] The type of this reality data
 * @param {string} [options.rootDocument] The path of the root document for this reality data
 * @returns {Promise<GeoJsonDataSource | KmlDataSource>}
 *
 * @throws {RuntimeError} if the type of reality data is not supported by this function
 */
ITwinData.createDataSourceForRealityDataId = async function ({
  iTwinId,
  realityDataId,
  type,
  rootDocument,
}) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.string("iTwinId", iTwinId);
  Check.typeOf.string("realityDataId", realityDataId);
  if (defined(type)) {
    Check.typeOf.string("type", type);
  }
  if (defined(rootDocument)) {
    Check.typeOf.string("rootDocument", rootDocument);
  }
  //>>includeEnd('debug');

  if (!defined(type) || !defined(rootDocument)) {
    const metadata = await ITwinPlatform.getRealityDataMetadata(
      iTwinId,
      realityDataId,
    );
    rootDocument = metadata.rootDocument;
    type = metadata.type;
  }

  const supportedRealityDataTypes = [
    ITwinPlatform.RealityDataType.KML,
    ITwinPlatform.RealityDataType.GeoJSON,
  ];

  if (!supportedRealityDataTypes.includes(type)) {
    throw new RuntimeError(
      `Reality data type is not a data source type: ${type}`,
    );
  }

  const tilesetAccessUrl = await ITwinPlatform.getRealityDataURL(
    iTwinId,
    realityDataId,
    rootDocument,
  );

  if (type === ITwinPlatform.RealityDataType.GeoJSON) {
    return GeoJsonDataSource.load(tilesetAccessUrl);
  }

  // If we get here it's guaranteed to be a KML type
  return KmlDataSource.load(tilesetAccessUrl);
};

/**
 * Load data from the Geospatial Features API as GeoJSON.
 *
 * @param {object} options
 * @param {string} options.iTwinId The id of the iTwin to load data from
 * @param {string} options.collectionId The id of the data collection to load
 * @param {number} [options.limit=10000] number of items per page, must be between 1 and 10,000 inclusive
 * @returns {Promise<GeoJsonDataSource>}
 */
ITwinData.loadGeospatialFeatures = async function ({
  iTwinId,
  collectionId,
  limit,
}) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.string("iTwinId", iTwinId);
  Check.typeOf.string("collectionId", collectionId);
  if (defined(limit)) {
    Check.typeOf.number("limit", limit);
    Check.typeOf.number.lessThanOrEquals("limit", limit, 10000);
    Check.typeOf.number.greaterThanOrEquals("limit", limit, 1);
  }
  if (
    !defined(ITwinPlatform.defaultAccessToken) &&
    !defined(ITwinPlatform.defaultShareKey)
  ) {
    throw new DeveloperError(
      "Must set ITwinPlatform.defaultAccessToken or ITwinPlatform.defaultShareKey first",
    );
  }
  //>>includeEnd('debug');

  const pageLimit = limit ?? 10000;

  const tilesetUrl = `${ITwinPlatform.apiEndpoint}geospatial-features/itwins/${iTwinId}/ogc/collections/${collectionId}/items`;

  const resource = new Resource({
    url: tilesetUrl,
    headers: {
      Authorization: ITwinPlatform._getAuthorizationHeader(),
      Accept: "application/vnd.bentley.itwin-platform.v1+json",
    },
    queryParameters: {
      limit: pageLimit,
      client: "CesiumJS",
    },
  });

  return GeoJsonDataSource.load(resource);
};

/**
 * Create a {@link ProjectedImageCollection} from a CCOrientations or CCImageCollection
 * reality data item associated with the given iTwin.
 *
 * This loads the ccOrientations XML, parses it, and resolves image URLs
 * from a companion CCImageCollection in the same iTwin (or from the same
 * reality data container if images are co-located).
 *
 * @experimental This feature is not final and is subject to change without Cesium's standard deprecation policy.
 *
 * @param {object} options
 * @param {string} options.iTwinId The id of the iTwin
 * @param {string} options.realityDataId The id of the CCOrientations reality data
 * @param {string} [options.imageRealityDataId] The id of the CCImageCollection reality data.
 *   If not provided, the function will search for a CCImageCollection in the same iTwin.
 * @param {string} [options.iiifBaseUrl] Base URL of the IIIF tile server (e.g. "https://iiif.example.com").
 *   When provided, images are loaded via IIIF with progressive LOD instead of Azure blob storage.
 * @param {string} [options.iiifAuthHeader] Authorization header for IIIF requests (e.g. "Bearer ...").
 *   Required when using IIIF with share key auth (share keys don't work with IIIF servers).
 *   If not provided, uses the platform's default authorization header.
 * @param {number} [options.defaultPlaneDistance=50.0] Default projection plane distance.
 * @param {boolean} [options.showFrustums=true] Show frustum wireframes.
 * @param {boolean} [options.showCameraIcons=true] Show camera icons.
 * @param {boolean} [options.showLabels=false] Show camera labels.
 * @param {number} [options.alpha=1.0] Default image alpha.
 * @returns {Promise<ProjectedImageCollection>}
 *
 * @throws {RuntimeError} If the reality data type is not CCOrientations
 * @throws {RuntimeError} If no CCImageCollection is found and imageRealityDataId is not provided
 */
ITwinData.createProjectedImageCollectionForRealityDataId = async function ({
  iTwinId,
  realityDataId,
  imageRealityDataId,
  iiifBaseUrl,
  iiifAuthHeader,
  defaultPlaneDistance,
  frustumScale,
  showFrustums,
  showCameraIcons,
  showLabels,
  alpha,
  frustumColor,
}) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.string("iTwinId", iTwinId);
  Check.typeOf.string("realityDataId", realityDataId);
  //>>includeEnd('debug');

  // 1. Get ccOrientations metadata and URL
  const metadata = await ITwinPlatform.getRealityDataMetadata(
    iTwinId,
    realityDataId,
  );

  const supportedTypes = [
    ITwinPlatform.RealityDataType.CCOrientations,
    ITwinPlatform.RealityDataType.ContextScene,
  ];
  if (!supportedTypes.includes(metadata.type)) {
    throw new RuntimeError(
      `Reality data type "${metadata.type}" is not CCOrientations or ContextScene`,
    );
  }

  const isContextScene =
    metadata.type === ITwinPlatform.RealityDataType.ContextScene;

  // Get the orientations data URL.
  let orientationsUrl;
  if (defined(metadata.rootDocument)) {
    orientationsUrl = await ITwinPlatform.getRealityDataURL(
      iTwinId,
      realityDataId,
      metadata.rootDocument,
    );
  } else {
    const containerUrl = await ITwinPlatform.getRealityDataContainerUrl(
      iTwinId,
      realityDataId,
    );
    const candidates = isContextScene
      ? ["ContextScene.json", "contextscene.json", "ContextScene.xml"]
      : [
          "Orientations/Orientations.xml",
          "orientations.xml",
          "Orientations.xml",
          "ccorientations.xml",
          "CCOrientations.xml",
        ];
    let found = false;
    for (const candidate of candidates) {
      const candidateUrlObj = new URL(containerUrl);
      candidateUrlObj.pathname = `${candidateUrlObj.pathname}/${candidate}`;
      const testUrl = candidateUrlObj.toString();
      try {
        const testResource = new Resource({ url: testUrl });
        const text = await testResource.fetchText();
        if (defined(text) && text.length > 0) {
          orientationsUrl = testUrl;
          found = true;
          break;
        }
      } catch (e) {
        // not found, try next
      }
    }
    if (!found) {
      throw new RuntimeError(
        `Could not find orientations data in container for reality data ${realityDataId}. ` +
          `Tried: ${candidates.join(", ")}`,
      );
    }
  }

  // 2. Resolve the image container URL (skip when using IIIF tile server)
  let imageContainerUrl;

  if (!defined(iiifBaseUrl)) {
    if (defined(imageRealityDataId)) {
      imageContainerUrl = await ITwinPlatform.getRealityDataContainerUrl(
        iTwinId,
        imageRealityDataId,
      );
    } else {
      // Search for a CCImageCollection in the same iTwin
      const allData = await ITwinPlatform.listRealityData(iTwinId, {
        types: [ITwinPlatform.RealityDataType.CCImageCollection],
      });

      if (allData.length === 0) {
        // Fall back: try resolving images from the same container as orientations
        imageContainerUrl = await ITwinPlatform.getRealityDataContainerUrl(
          iTwinId,
          realityDataId,
        );
      } else {
        // Use the first CCImageCollection found
        imageContainerUrl = await ITwinPlatform.getRealityDataContainerUrl(
          iTwinId,
          allData[0].id,
        );
      }
    }
  }

  // 3. Build the image URL resolver
  let resolveImageUrl;
  let iiifOptions;

  if (defined(iiifBaseUrl)) {
    // IIIF mode: resolve images through the tile server
    const authHeader =
      iiifAuthHeader || ITwinPlatform._getAuthorizationHeader();
    const trimmedBase = iiifBaseUrl.replace(/\/+$/, "");

    resolveImageUrl = function (imagePath) {
      const normalized = imagePath.replace(/\\/g, "/");
      const stem = normalized
        .split("/")
        .pop()
        .replace(/\.[^.]+$/, "");
      const iiifImageBase = `${trimmedBase}/${iTwinId}/${stem}`;
      // Start with smallest thumbnail — LOD management will upgrade as needed
      return new Resource({
        url: `${iiifImageBase}/full/256,/0/default.jpg`,
        headers: { Authorization: authHeader },
      });
    };

    iiifOptions = {
      iiifBaseUrl: trimmedBase,
      iTwinId: iTwinId,
      authHeader: authHeader,
    };

    console.log("IIIF tile server:", trimmedBase);
    console.log(
      "Sample IIIF URL:",
      `${trimmedBase}/${iTwinId}/sample/full/1024,/0/default.jpg`,
    );
  } else {
    // Azure blob mode: resolve against the image container URL
    const containerUrlObj = new URL(imageContainerUrl);
    const containerBase = `${containerUrlObj.origin}${containerUrlObj.pathname}`;
    const containerSearch = containerUrlObj.search; // SAS token

    // Extract the container name (last path segment, typically a GUID)
    const pathSegments = containerUrlObj.pathname.split("/").filter((s) => s);
    const containerName = pathSegments[pathSegments.length - 1];

    resolveImageUrl = function (imagePath) {
      // imagePath may have backslashes from Windows paths in the XML
      let normalized = imagePath.replace(/\\/g, "/");

      // Strip leading container name if the ImagePath redundantly includes it
      if (normalized.startsWith(`${containerName}/`)) {
        normalized = normalized.substring(containerName.length + 1);
      }

      const url = `${containerBase}/${normalized}${containerSearch}`;
      return url;
    };

    console.log("Image container base:", containerBase);
    console.log(
      "Sample image URL will look like:",
      resolveImageUrl("sample/image.jpg"),
    );
  }

  // 4. Fetch and parse the ccOrientations XML
  const collectionOptions = {
    resolveImageUrl: resolveImageUrl,
    defaultPlaneDistance: defaultPlaneDistance ?? 50.0,
    frustumScale: frustumScale,
    showFrustums: showFrustums,
    showCameraIcons: showCameraIcons,
    showLabels: showLabels,
    alpha: alpha,
    frustumColor: frustumColor,
  };

  // Pass IIIF config so the collection can create IIIFImageSources per image
  if (defined(iiifOptions)) {
    collectionOptions.iiifBaseUrl = iiifOptions.iiifBaseUrl;
    collectionOptions.iTwinId = iiifOptions.iTwinId;
    collectionOptions.authHeader = iiifOptions.authHeader;
  }

  let collection;
  if (isContextScene) {
    collection = await ProjectedImageCollection.fromContextSceneUrl(
      orientationsUrl,
      collectionOptions,
    );
  } else {
    collection = await ProjectedImageCollection.fromCCOrientationsUrl(
      orientationsUrl,
      collectionOptions,
    );
  }

  return collection;
};

export default ITwinData;
