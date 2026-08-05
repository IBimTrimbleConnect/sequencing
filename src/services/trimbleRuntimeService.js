import {
  extractRuntimeObjectProperties,
} from "../utils/runtimeObjectProperties";

const normalizeId = (value) => {
  if (
    value == null ||
    value === ""
  ) {
    return null;
  }

  return String(value);
};

const getLoadedModelId = (model) =>
  model?.id ??
  model?.modelId ??
  null;

const getExternalId = (object) =>
  normalizeId(
    object?.externalId ??
      object?.external_id ??
      object?.objectId,
  );

const createUnavailableObject = ({
  object,
  externalId,
}) => ({
  ...object,

  externalId,

  /*
   * Runtime-only fields.
   */
  modelId: null,
  runtimeId: null,
  id: null,

  asmPos:
    object?.asmPos || "",

  asmName:
    object?.asmName || "",

  name:
    object?.name || "",

  positionCode:
    object?.positionCode || "",

  rawWeight:
    object?.rawWeight ?? null,

  weight:
    object?.rawWeight ??
    object?.weight ??
    null,

  rawLength:
    object?.rawLength ?? null,

  length:
    object?.rawLength ??
    object?.length ??
    null,

  rawCog:
    object?.rawCog ?? null,

  cog:
    object?.rawCog ??
    object?.cog ??
    null,

  objectAvailable: false,
});

/**
 * Hydrate objects using only external_id.
 *
 * For each currently loaded model:
 * 1. Try to convert all unresolved external IDs.
 * 2. Keep the first model that resolves each external ID.
 * 3. Load object properties using the resolved runtime IDs.
 *
 * model_external_id is intentionally not used.
 */
export async function hydrateSequenceObjects({
  tcapi,
  objects,
}) {
  if (!tcapi?.viewer) {
    throw new Error(
      "Trimble Viewer API is required.",
    );
  }

  if (
    !Array.isArray(objects) ||
    objects.length === 0
  ) {
    return [];
  }

  const loadedModels =
    await tcapi.viewer.getModels(
      "loaded",
    );

  if (
    !Array.isArray(
      loadedModels,
    ) ||
    !loadedModels.length
  ) {
    return objects.map(
      (object) =>
        createUnavailableObject({
          object,
          externalId:
            getExternalId(object),
        }),
    );
  }

  const normalizedModels =
    loadedModels
      .map((model) => {
        const modelId =
          getLoadedModelId(model);

        if (modelId == null) {
          return null;
        }

        return {
          ...model,
          id: modelId,
        };
      })
      .filter(Boolean);

  const entries = objects.map(
    (object, objectIndex) => ({
      object,
      objectIndex,

      externalId:
        getExternalId(object),
    }),
  );

  const uniqueExternalIds = [
    ...new Set(
      entries
        .map(
          (entry) =>
            entry.externalId,
        )
        .filter(Boolean),
    ),
  ];

  /*
   * externalId -> {
   *   modelId,
   *   runtimeId,
   *   propertyItem,
   *   runtimeProperties
   * }
   */
  const resolvedByExternalId =
    new Map();

  for (
    const model of
    normalizedModels
  ) {
    const unresolvedExternalIds =
      uniqueExternalIds.filter(
        (externalId) =>
          !resolvedByExternalId.has(
            externalId,
          ),
      );

    if (
      !unresolvedExternalIds.length
    ) {
      break;
    }

    let runtimeIds = [];

    try {
      runtimeIds =
        await tcapi.viewer.convertToObjectRuntimeIds(
          model.id,
          unresolvedExternalIds,
        );
    } catch (error) {
      console.error(
        "Failed to resolve runtime IDs:",
        {
          modelId:
            model.id,

          externalIds:
            unresolvedExternalIds,

          error,
        },
      );

      continue;
    }

    const matchedEntries = [];

    unresolvedExternalIds.forEach(
      (externalId, index) => {
        const runtimeId =
          runtimeIds?.[index];

        if (
          runtimeId == null ||
          runtimeId === "" ||
          runtimeId === 0
        ) {
          return;
        }

        matchedEntries.push({
          externalId,
          runtimeId,
        });
      },
    );

    if (
      !matchedEntries.length
    ) {
      continue;
    }

    const uniqueRuntimeIds = [
      ...new Set(
        matchedEntries.map(
          (entry) =>
            entry.runtimeId,
        ),
      ),
    ];

    let propertyItems = [];

    try {
      propertyItems =
        await tcapi.viewer.getObjectProperties(
          model.id,
          uniqueRuntimeIds,
        );
    } catch (error) {
      console.error(
        "Failed to load object properties:",
        {
          modelId:
            model.id,

          runtimeIds:
            uniqueRuntimeIds,

          error,
        },
      );
    }

    const propertyByRuntimeId =
      new Map(
        (propertyItems || [])
          .filter(
            (item) =>
              item?.id != null,
          )
          .map((item) => [
            String(item.id),
            item,
          ]),
      );

    for (
      const matchedEntry of
      matchedEntries
    ) {
      const propertyItem =
        propertyByRuntimeId.get(
          String(
            matchedEntry.runtimeId,
          ),
        ) || null;

      const runtimeProperties =
        propertyItem
          ? extractRuntimeObjectProperties(
              propertyItem,
            )
          : {
              asmPos: "",
              asmName: "",
              name: "",
              positionCode: "",
              rawWeight: null,
              weight: null,
              rawLength: null,
              length: null,
              rawCog: null,
              cog: null,
            };

      resolvedByExternalId.set(
        matchedEntry.externalId,
        {
          modelId:
            model.id,

          runtimeId:
            matchedEntry.runtimeId,

          propertyItem,
          runtimeProperties,
        },
      );
    }
  }

  return entries.map(
    ({
      object,
      externalId,
    }) => {
      if (!externalId) {
        return createUnavailableObject({
          object,
          externalId: null,
        });
      }

      const resolved =
        resolvedByExternalId.get(
          externalId,
        );

      if (!resolved) {
        return createUnavailableObject({
          object,
          externalId,
        });
      }

      return {
        ...object,

        externalId,

        /*
         * Runtime-only values.
         * Do not save these fields to Supabase.
         */
        modelId:
          resolved.modelId,

        runtimeId:
          resolved.runtimeId,

        /*
         * Existing UI components currently use id
         * as the viewer runtime ID.
         */
        id:
          resolved.runtimeId,

        objectAvailable: true,

        properties:
          resolved.propertyItem
            ?.properties || [],

        product:
          resolved.propertyItem
            ?.product || null,

        ...resolved.runtimeProperties,
      };
    },
  );
}
