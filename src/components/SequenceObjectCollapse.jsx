import React, {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  Empty,
  Dropdown,
  Button,
  DatePicker,
  Input,
  Tooltip,
  App,
  Modal,
  Tree,
  Checkbox,
} from "antd";
import * as WorkspaceAPI from "trimble-connect-workspace-api";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";

import {
  FileOutlined,
  DeleteOutlined,
  EditOutlined,
  CloseOutlined,
  CameraOutlined,
  EyeInvisibleOutlined,
  ZoomInOutlined,
} from "@ant-design/icons";

import {
  SetObjectsRequest,
  SetActiveSimulationItem,
  UpdateSequenceObjectSortDatesRequest,
} from "../store/sequence/action";

import {
  DEFAULT_FORMATTING,
  convertMassFromKg,
  getDisplayMassUnit,
  normalizeProjectFormatting,
} from "../utils/projectFormatting";
import dayjs from "dayjs";
import {
  getSequenceColumnValue,
  useSequenceColumnConfig,
} from "../context/SequenceColumnConfigContext";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

const getExternalId = (object) =>
  object?.externalId ?? object?.external_id ?? object?.objectId ?? null;

const getRuntimeId = (object) =>
  object?.runtimeId ?? object?.objectRuntimeId ?? null;

const getObjectModelId = (object) => object?.modelId ?? null;

const getObjectKey = (object) =>
  String(object?.dbId ?? getExternalId(object) ?? "");

const getObjectDate = (object) => object?.assignedDate ?? object?.date ?? "";
const getObjectEndDate = (object) => object?.endDate ?? object?.end_date ?? "";

/*
 * Convert Trimble viewer.getObjectProperties() output to a flat
 * DataTable value dictionary keyed by Column.field.
 *
 * Example:
 *
 * {
 *   class: "IFCELEMENTASSEMBLY",
 *   name: "Column",
 *   properties: [
 *     {
 *       name: "PropertySet",
 *       properties: [
 *         {
 *           name: "WEIGHT",
 *           value: 121.5
 *         }
 *       ]
 *     }
 *   ]
 * }
 *
 * =>
 *
 * {
 *   name: "Column",
 *   entity_class: "IFCELEMENTASSEMBLY",
 *   "PropertySet+WEIGHT": 121.5
 * }
 */
/*
 * Header display only.
 *
 * Keep column.field unchanged for value lookup, but if the field
 * contains "+", display only the property name after the last "+".
 *
 * Examples:
 *   PropertySet+AREA        -> AREA
 *   PropertySet+WEIGHT      -> WEIGHT
 *   Assembly+ASSEMBLY_POS   -> ASSEMBLY_POS
 *   entity_class            -> existing label / entity_class
 */
const psetPropertyMetadataCache = new Map();

const getColumnHeaderLabel = (
  column,
  _psetMetadataRevision = 0,
) => {
  const field =
    String(
      column?.field || "",
    ).trim();

  const propKey =
    getExternalPsetPropertyKey(
      field,
    );

  if (propKey) {
    const metadata =
      psetPropertyMetadataCache.get(
        propKey,
      );

    if (
      metadata?.displayName
    ) {
      return metadata.displayName;
    }
  }

  if (
    field.includes(
      "+",
    )
  ) {
    const parts =
      field.split(
        "+",
      );

    const propertyName =
      String(
        parts[
          parts.length - 1
        ] || "",
      ).trim();

    if (
      propertyName
    ) {
      return propertyName;
    }
  }

  return (
    column?.label ||
    field
  );
};

const buildDataTableValueMap = (
  objectProperties,
) => {
  const values = {};

  if (!objectProperties) {
    return values;
  }

  /*
   * Built-in DataTable fields.
   */
  values.name =
    objectProperties?.name ??
    "";

  values.entity_class =
    objectProperties?.class ??
    "";

  /*
   * Property Set fields.
   *
   * The DataTable Column.field format observed in Trimble:
   *
   * PropertySet+WEIGHT
   *
   * maps directly to:
   *
   * propertySet.name = "PropertySet"
   * property.name    = "WEIGHT"
   */
  for (
    const propertySet of
      objectProperties?.properties ||
      []
  ) {
    const psetName =
      propertySet?.name;

    if (!psetName) {
      continue;
    }

    for (
      const property of
        propertySet?.properties ||
        []
    ) {
      const propertyName =
        property?.name;

      if (!propertyName) {
        continue;
      }

      const field =
        `${psetName}+${propertyName}`;

      values[field] =
        property?.value ?? "";
    }
  }

  return values;
};

const getExternalPsetPropertyKey = (
  field,
) => {
  const value =
    String(
      field || "",
    ).trim();

  if (!value) {
    return "";
  }

  /*
   * Direct PSet field:
   *
   * prop_xxx
   */
  if (
    value
      .toLowerCase()
      .startsWith(
        "prop_",
      )
  ) {
    return value;
  }

  /*
   * Trimble DataTable preset may return:
   *
   * Assembly+prop_xxx
   * Rebar+prop_xxx
   * Cast Unit+prop_xxx
   * Anything+prop_xxx
   *
   * PSet REST API itself only returns the prop_xxx key
   * inside items[].props.
   */
  const parts =
    value.split(
      "+",
    );

  const propPart =
    parts.find(
      (part) =>
        String(
          part || "",
        )
          .trim()
          .toLowerCase()
          .startsWith(
            "prop_",
          ),
    );

  return String(
    propPart || "",
  ).trim();
};

const isExternalPsetField = (
  field,
) =>
  Boolean(
    getExternalPsetPropertyKey(
      field,
    ),
  );

/*
 * PSet API response:
 *
 * {
 *   items: [
 *     {
 *       link: "frn:entity:{guid}",
 *       props: {
 *         "prop_xxx": 5000
 *       }
 *     }
 *   ]
 * }
 *
 * Merge props from every returned PSet instance.
 */
const buildExternalPsetValueMap = (
  response,
  requestedFields = [],
) => {
  const values = {};

  const items =
    Array.isArray(
      response?.items,
    )
      ? response.items
      : [];

  /*
   * Example requested field:
   *
   * Assembly+prop_44c83...
   *
   * PSet API returns:
   *
   * props: {
   *   "prop_44c83...": 5000
   * }
   *
   * Build a reverse lookup:
   *
   * prop_44c83...
   *     -> ["Assembly+prop_44c83..."]
   */
  const requestedFieldMap =
    new Map();

  (
    Array.isArray(
      requestedFields,
    )
      ? requestedFields
      : []
  ).forEach(
    (requestedField) => {
      const fullField =
        String(
          requestedField || "",
        ).trim();

      const propKey =
        getExternalPsetPropertyKey(
          fullField,
        );

      if (
        !fullField ||
        !propKey
      ) {
        return;
      }

      if (
        !requestedFieldMap.has(
          propKey,
        )
      ) {
        requestedFieldMap.set(
          propKey,
          [],
        );
      }

      requestedFieldMap
        .get(
          propKey,
        )
        .push(
          fullField,
        );
    },
  );

  for (
    const pset of items
  ) {
    const props =
      pset?.props;

    if (
      !props ||
      typeof props !==
        "object" ||
      Array.isArray(props)
    ) {
      continue;
    }

    Object.entries(
      props,
    ).forEach(
      ([
        propKey,
        propValue,
      ]) => {
        /*
         * Always expose the raw PSet property key.
         */
        values[
          propKey
        ] =
          propValue;

        /*
         * Also expose the exact Trimble DataTable Column.field,
         * because table rendering is based on column.field.
         */
        const matchingFields =
          requestedFieldMap.get(
            propKey,
          ) ||
          [];

        matchingFields.forEach(
          (fullField) => {
            values[
              fullField
            ] =
              propValue;
          },
        );
      },
    );
  }

  return values;
};

/*
 * =====================================================
 * PSET - 3 API FLOW
 * =====================================================
 *
 * API 1: Organizer ProjectContext/PSetLibs -> libId(s)
 * API 2: /libs/{libId}/defs -> property name + libId + defId
 * API 3: /batch-get -> values for object GUIDs
 */

const psetDefinitionCache =
  new Map();

/*
 * Project-wide PSet cache.
 *
 * key:
 *   projectId|psetApiUrl|sorted-selected-prop-fields
 *
 * value:
 *   Map<externalGuid, { [columnField]: value }>
 *
 * Every SequenceObjectCollapse instance shares this cache so changing
 * the App-level ColumnSet triggers one background load for all objects
 * in all Plans/SubPlans rather than one request per visible table.
 */
const projectPsetValueCache =
  new Map();

const projectPsetLoadPromiseCache =
  new Map();

const createProjectPsetCacheKey = ({
  projectId,
  psetApiUrl,
  externalPsetFields,
}) =>
  [
    String(
      projectId || "",
    ),
    String(
      psetApiUrl || "",
    ),
    [...new Set(
      (
        Array.isArray(
          externalPsetFields,
        )
          ? externalPsetFields
          : []
      )
        .map(
          (field) =>
            String(
              field || "",
            ).trim(),
        )
        .filter(Boolean),
    )]
      .sort()
      .join(","),
  ].join("|");

const invalidateProjectPsetCache = ({
  projectId,
  psetApiUrl,
  externalPsetFields,
}) => {
  const cacheKey =
    createProjectPsetCacheKey({
      projectId,
      psetApiUrl,
      externalPsetFields,
    });

  projectPsetValueCache.delete(
    cacheKey,
  );

  projectPsetLoadPromiseCache.delete(
    cacheKey,
  );
};

const scheduleLazyTask = (
  callback,
) => {
  if (
    typeof window !==
      "undefined" &&
    typeof window.requestIdleCallback ===
      "function"
  ) {
    const id =
      window.requestIdleCallback(
        callback,
        {
          timeout:
            1000,
        },
      );

    return () =>
      window.cancelIdleCallback?.(
        id,
      );
  }

  const id =
    window.setTimeout(
      callback,
      0,
    );

  return () =>
    window.clearTimeout(
      id,
    );
};

const getOrgApiUrlFromPsetApiUrl = (
  psetApiUrl,
) => {
  const value =
    String(
      psetApiUrl || "",
    ).trim();

  if (!value) {
    return "";
  }

  return value.replace(
    "://pset-api.",
    "://org-api.",
  );
};

const getPsetAccessToken = async (
  tcapi,
) => {
  let token =
    String(
      window.localStorage.getItem(
        "trimbleToken",
      ) || "",
    ).trim();

  if (token) {
    return token;
  }

  const tokenResponse =
    await tcapi.extension
      .requestPermission(
        "accesstoken",
      );

  token =
    String(
      typeof tokenResponse ===
        "string"
        ? tokenResponse
        : tokenResponse?.accessToken ||
          tokenResponse?.token ||
          tokenResponse?.value ||
          "",
    ).trim();

  if (token) {
    window.localStorage.setItem(
      "trimbleToken",
      token,
    );
  }

  return token;
};

const fetchPsetJson = async (
  url,
  token,
  options = {},
) => {

  if (options?.body) {
    try {
    } catch {
    }
  }

  const response =
    await fetch(
      url,
      {
        ...options,

        headers: {
          Authorization:
            `Bearer ${token}`,

          Accept:
            "application/json",

          ...(options?.body
            ? {
                "Content-Type":
                  "application/json",
              }
            : {}),

          ...(options?.headers ||
            {}),
        },
      },
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      "[PSET][HTTP] Error body:",
      errorText,
    );

    throw new Error(
      `PSet request failed: ${response.status} ${response.statusText}`,
    );
  }

  const data =
    await response.json();

  return data;
};

const extractPsetLibraryIds = (
  response,
) => {
  /*
   * Actual Organizer response:
   *
   * {
   *   links: [
   *     "frn:lib:q68734nd822rgwbo5okc0snj7n808yqu",
   *     "frn:lib:yb9x298w53qhmsliwrv4bgzafly1oe7v"
   *   ]
   * }
   *
   * So parse `frn:lib:` directly instead of trying to infer ids
   * recursively from arbitrary metadata fields.
   */
  const links =
    Array.isArray(
      response?.links,
    )
      ? response.links
      : [];

  const libIds =
    links
      .map(
        (link) => {
          const value =
            String(
              link || "",
            ).trim();

          const prefix =
            "frn:lib:";

          if (
            !value.startsWith(
              prefix,
            )
          ) {
            return null;
          }

          return value.slice(
            prefix.length,
          );
        },
      )
      .filter(Boolean);


  return [
    ...new Set(
      libIds,
    ),
  ];
};

/*
 * API 1
 *
 * GET
 * {orgApiUrl}/forests/project%3A{projectId}%3Adata/
 * trees/ProjectContext/nodes/PSetLibs?deleted&fields=metadata
 */
const getProjectPsetLibraryIds =
  async ({
    projectId,
    psetApiUrl,
    token,
  }) => {
    if (
      !projectId ||
      !psetApiUrl ||
      !token
    ) {
      return [];
    }

    const orgApiUrl =
      getOrgApiUrlFromPsetApiUrl(
        psetApiUrl,
      );



    if (!orgApiUrl) {
      return [];
    }

    const forestId =
      encodeURIComponent(
        `project:${projectId}:data`,
      );

    const response =
      await fetchPsetJson(
        `${orgApiUrl}` +
          `/forests/${forestId}` +
          `/trees/ProjectContext` +
          `/nodes/PSetLibs` +
          `?deleted&fields=metadata`,
        token,
      );

    const libIds =
      extractPsetLibraryIds(
        response,
      );

    return libIds;
  };

/*
 * API 2
 *
 * GET {psetApiUrl}/libs/{libId}/defs
 *
 * definition.id                     -> defId
 * definition.schema.props[prop_xxx] -> property definition
 * definition.i18n["en-US"].props[prop_xxx]
 *                                   -> display name, e.g. IBIM_LENGTH
 */
const discoverPsetPropertyMetadata =
  async ({
    projectId,
    psetApiUrl,
    token,
    requestedFields,
  }) => {
    const requestedPropKeys =
      new Set(
        (
          Array.isArray(
            requestedFields,
          )
            ? requestedFields
            : []
        )
          .map(
            getExternalPsetPropertyKey,
          )
          .filter(Boolean),
      );

    if (
      !requestedPropKeys.size
    ) {
      return new Map();
    }

    const cacheKey =
      `${projectId || ""}|${psetApiUrl || ""}`;

    let definitions =
      psetDefinitionCache.get(
        cacheKey,
      );

    if (!definitions) {
      definitions = [];

      const libIds =
        await getProjectPsetLibraryIds({
          projectId,
          psetApiUrl,
          token,
        });

      for (
        const libId of libIds
      ) {
        try {
          const response =
            await fetchPsetJson(
              `${psetApiUrl}` +
                `/libs/${encodeURIComponent(
                  libId,
                )}/defs`,
              token,
            );

          const items =
            Array.isArray(
              response?.items,
            )
              ? response.items
              : [];

          items.forEach(
            (definition) => {
              definitions.push({
                ...definition,

                libId:
                  definition?.libId ||
                  libId,
              });
            },
          );
        } catch (error) {
          console.warn(
            `Unable to load PSet definitions for library ${libId}:`,
            error,
          );
        }
      }

      psetDefinitionCache.set(
        cacheKey,
        definitions,
      );
    }

    const result =
      new Map();

    definitions.forEach(
      (definition) => {
        const libId =
          String(
            definition?.libId ||
              "",
          ).trim();

        const defId =
          String(
            definition?.id ||
              definition?.defId ||
              "",
          ).trim();

        const props =
          definition?.schema
            ?.props;

        if (
          !libId ||
          !defId ||
          !props ||
          typeof props !==
            "object" ||
          Array.isArray(props)
        ) {
          return;
        }

        const displayProps =
          definition?.i18n?.["en-US"]?.props ||
          {};

        Object.entries(
          props,
        ).forEach(
          ([
            propKey,
            propDefinition,
          ]) => {
            if (
              !requestedPropKeys.has(
                propKey,
              )
            ) {
              return;
            }

            const metadata = {
              propKey,

              libId,

              defId,

              definitionName:
                String(
                  definition?.name ||
                    "",
                ),

              displayName:
                String(
                  displayProps?.[
                    propKey
                  ] ||
                    propKey,
                ),

              type:
                String(
                  propDefinition?.type ||
                    "",
                ),
            };

            psetPropertyMetadataCache.set(
              propKey,
              metadata,
            );

            result.set(
              propKey,
              metadata,
            );
          },
        );
      },
    );

    return result;
  };

const chunkArray = (
  items,
  size,
) => {
  const result = [];

  for (
    let index = 0;
    index < items.length;
    index += size
  ) {
    result.push(
      items.slice(
        index,
        index + size,
      ),
    );
  }

  return result;
};

/*
 * API 3
 *
 * POST {psetApiUrl}/batch-get
 */
const loadExternalPsetValues = async ({
  tcapi,
  objects,
  projectId,
  psetApiUrl,
  externalPsetFields,
}) => {
  const result =
    new Map();

  if (
    !tcapi ||
    !projectId ||
    !psetApiUrl ||
    !Array.isArray(
      objects,
    ) ||
    !objects.length ||
    !Array.isArray(
      externalPsetFields,
    ) ||
    !externalPsetFields.length
  ) {
    return result;
  }

  const token =
    await getPsetAccessToken(
      tcapi,
    );

  if (!token) {
    throw new Error(
      "Unable to obtain the Trimble Connect access token for Property Set values.",
    );
  }


  const propertyMetadata =
    await discoverPsetPropertyMetadata({
      projectId,
      psetApiUrl,
      token,
      requestedFields:
        externalPsetFields,
    });

  if (
    !propertyMetadata.size
  ) {
    return result;
  }

  /*
   * One PSet instance returns all props in one definition.
   * Therefore unique by libId + defId, not by propKey.
   */
  const definitions =
    Array.from(
      new Map(
        Array.from(
          propertyMetadata.values(),
        ).map(
          (metadata) => [
            `${metadata.libId}|${metadata.defId}`,
            {
              libId:
                metadata.libId,

              defId:
                metadata.defId,
            },
          ],
        ),
      ).values(),
    );

  const identities =
    Array.from(
      new Map(
        objects
          .flatMap(
            (object) => {
              const guid =
                String(
                  getExternalId(
                    object,
                  ) || "",
                ).trim();

              if (!guid) {
                return [];
              }

              return definitions.map(
                ({
                  libId,
                  defId,
                }) => ({
                  guid,

                  link:
                    `frn:entity:${guid}`,

                  libId,

                  defId,
                }),
              );
            },
          )
          .map(
            (identity) => [
              `${identity.guid}|${identity.libId}|${identity.defId}`,
              identity,
            ],
          ),
      ).values(),
    );


  const batches =
    chunkArray(
      identities,
      99,
    );

  for (
    const batch of batches
  ) {

    let pending =
      batch.map(
        ({
          link,
          libId,
          defId,
        }) => ({
          link,
          libId,
          defId,
        }),
      );

    for (
      let attempt = 0;
      attempt < 2 &&
      pending.length;
      attempt += 1
    ) {
      let response;

      try {
        response =
          await fetchPsetJson(
            `${psetApiUrl}/batch-get`,
            token,
            {
              method:
                "POST",

              body:
                JSON.stringify({
                  psets:
                    pending,
                }),
            },
          );
      } catch (error) {
        console.warn(
          "Unable to batch load PSet values:",
          error,
        );

        break;
      }

      const psets =
        Array.isArray(
          response?.responses
            ?.psets,
        )
          ? response.responses
              .psets
          : Array.isArray(
                response?.items,
              )
            ? response.items
            : [];

      psets.forEach(
        (pset) => {
          const link =
            String(
              pset?.link || "",
            );

          const prefix =
            "frn:entity:";

          if (
            !link.startsWith(
              prefix,
            )
          ) {
            return;
          }

          const guid =
            link.slice(
              prefix.length,
            );

          const mappedValues =
            buildExternalPsetValueMap(
              {
                items: [
                  pset,
                ],
              },
              externalPsetFields,
            );

          result.set(
            guid,
            {
              ...(result.get(
                guid,
              ) || {}),
              ...mappedValues,
            },
          );
        },
      );

      pending =
        Array.isArray(
          response?.unprocessed
            ?.psets,
        )
          ? response.unprocessed
              .psets
          : [];
    }
  }

  return result;
};

const loadProjectExternalPsetValues =
  async ({
    tcapi,
    objects,
    projectId,
    psetApiUrl,
    externalPsetFields,
  }) => {
    const cacheKey =
      createProjectPsetCacheKey({
        projectId,
        psetApiUrl,
        externalPsetFields,
      });

    if (
      projectPsetValueCache.has(
        cacheKey,
      )
    ) {
      return projectPsetValueCache.get(
        cacheKey,
      );
    }

    if (
      projectPsetLoadPromiseCache.has(
        cacheKey,
      )
    ) {
      return projectPsetLoadPromiseCache.get(
        cacheKey,
      );
    }

    const promise =
      loadExternalPsetValues({
        tcapi,
        objects,
        projectId,
        psetApiUrl,
        externalPsetFields,
      })
        .then(
          (values) => {
            projectPsetValueCache.set(
              cacheKey,
              values,
            );

            return values;
          },
        )
        .finally(
          () => {
            projectPsetLoadPromiseCache.delete(
              cacheKey,
            );
          },
        );

    projectPsetLoadPromiseCache.set(
      cacheKey,
      promise,
    );

    return promise;
  };


/*
 * Fetch properties in model batches.
 *
 * One call is made per model:
 *
 * viewer.getObjectProperties(
 *   modelId,
 *   runtimeIds
 * )
 *
 * Return:
 *
 * Map {
 *   "modelId:runtimeId" => {
 *      [Column.field]: value
 *   }
 * }
 */
const loadDataTableValues = async (
  tcapi,
  objects,
  {
    projectId = "",
    psetApiUrl = "",
    externalPsetFields = [],
  } = {},
) => {
  const result =
    new Map();

  if (
    !tcapi ||
    !Array.isArray(objects) ||
    !objects.length
  ) {
    return result;
  }

  const modelGroups =
    new Map();

  for (
    const object of objects
  ) {
    const modelId =
      getObjectModelId(
        object,
      );

    const runtimeId =
      getRuntimeId(
        object,
      );

    if (
      modelId == null ||
      runtimeId == null
    ) {
      continue;
    }

    const modelKey =
      String(modelId);

    if (
      !modelGroups.has(
        modelKey,
      )
    ) {
      modelGroups.set(
        modelKey,
        {
          modelId,
          runtimeIds:
            [],
        },
      );
    }

    modelGroups
      .get(modelKey)
      .runtimeIds.push(
        runtimeId,
      );
  }

  for (
    const group of
      modelGroups.values()
  ) {
    if (
      !group.runtimeIds.length
    ) {
      continue;
    }

    const objectProperties =
      await tcapi.viewer
        .getObjectProperties(
          group.modelId,
          group.runtimeIds,
        );

    for (
      const objectProperty of
        Array.isArray(
          objectProperties,
        )
          ? objectProperties
          : []
    ) {
      /*
       * Trimble ObjectProperties.id corresponds to
       * the runtime object ID supplied to the call.
       */
      const runtimeId =
        objectProperty?.id;

      if (
        runtimeId == null
      ) {
        continue;
      }

      const key =
        `${group.modelId}:${runtimeId}`;

      result.set(
        key,
        buildDataTableValueMap(
          objectProperty,
        ),
      );
    }
  }

  /*
   * Resolve fields whose DataTable Column.field starts with prop_
   * from Trimble Property Set REST API.
   */
  if (
    externalPsetFields.length &&
    psetApiUrl
  ) {

    const externalValuesByGuid =
      await loadExternalPsetValues({
        tcapi,
        objects,
        projectId,
        psetApiUrl,
        externalPsetFields,
      });

    for (
      const object of objects
    ) {
      const modelId =
        getObjectModelId(
          object,
        );

      const runtimeId =
        getRuntimeId(
          object,
        );

      const guid =
        String(
          getExternalId(
            object,
          ) ||
            "",
        );

      if (
        modelId == null ||
        runtimeId == null ||
        !guid
      ) {
        continue;
      }

      const objectKey =
        `${modelId}:${runtimeId}`;

      const modelValues =
        result.get(
          objectKey,
        ) ||
        {};

      const externalValues =
        externalValuesByGuid.get(
          guid,
        ) ||
        {};

      result.set(
        objectKey,
        {
          ...modelValues,
          ...externalValues,
        },
      );
    }
  }

  return result;
};

const DATE_FORMATS = [
  "YYYY-MM-DD",
  "DD-MM-YYYY",
  "DD/MM/YYYY",
  "YYYY/MM/DD",
];

const parseDate = (value) => {
  if (!value) {
    return null;
  }

  if (dayjs.isDayjs(value)) {
    return value.isValid()
      ? value
      : null;
  }

  for (const format of DATE_FORMATS) {
    const parsed = dayjs(
      value,
      format,
      true,
    );

    if (parsed.isValid()) {
      return parsed;
    }
  }

  const fallback = dayjs(value);

  return fallback.isValid()
    ? fallback
    : null;
};

/*
 * Saturday -> next Monday
 * Sunday   -> next Monday
 */
const shiftWeekendForward = (value) => {
  const parsed = parseDate(value);

  if (!parsed) {
    return null;
  }

  let result = parsed.startOf("day");

  if (result.day() === 6) {
    result = result.add(2, "day");
  } else if (result.day() === 0) {
    result = result.add(1, "day");
  }

  return result;
};

/*
 * Add/subtract working days, skipping Saturday/Sunday.
 *
 * Friday + 1 -> Monday
 * Monday - 1 -> Friday
 */
const addWorkingDays = (value, amount) => {
  let result = shiftWeekendForward(value);

  if (!result) {
    return null;
  }

  const days = Number(amount) || 0;

  if (days === 0) {
    return result;
  }

  const direction = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);

  while (remaining > 0) {
    result = result.add(direction, "day");

    const day = result.day();

    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return result;
};

const addSequenceDays = (value, amount, considerWeekend = false) => {
  const parsed = parseDate(value);

  if (!parsed) {
    return null;
  }

  if (considerWeekend) {
    return parsed
      .startOf("day")
      .add(Number(amount) || 0, "day");
  }

  return addWorkingDays(value, amount);
};

const isSameObject = (first, second) => {
  if (!first || !second) {
    return false;
  }

  const firstDbId = first?.dbId;

  const secondDbId = second?.dbId;

  if (firstDbId != null && secondDbId != null) {
    return String(firstDbId) === String(secondDbId);
  }

  return String(getExternalId(first)) === String(getExternalId(second));
};

const createSortDatesBetween = ({ previousItem, nextItem, count }) => {
  if (!Number.isInteger(count) || count <= 0) {
    return [];
  }

  const defaultGap = 1000;

  const previousTime = previousItem?.sortDatetime
    ? new Date(previousItem.sortDatetime).getTime()
    : null;

  const nextTime = nextItem?.sortDatetime
    ? new Date(nextItem.sortDatetime).getTime()
    : null;

  if (previousTime == null && nextTime == null) {
    const baseTime = Date.now();

    return Array.from({ length: count }, (_, index) =>
      new Date(baseTime + index).toISOString(),
    );
  }

  if (previousTime == null) {
    return Array.from({ length: count }, (_, index) =>
      new Date(nextTime - defaultGap * (count - index)).toISOString(),
    );
  }

  if (nextTime == null) {
    return Array.from({ length: count }, (_, index) =>
      new Date(previousTime + defaultGap * (index + 1)).toISOString(),
    );
  }

  const availableGap = nextTime - previousTime;
  const step = availableGap / (count + 1);

  if (step < 1) {
    throw new Error(
      "There is not enough sort_datetime space between adjacent objects.",
    );
  }

  return Array.from({ length: count }, (_, index) =>
    new Date(previousTime + Math.floor(step * (index + 1))).toISOString(),
  );
};

/*
 * Column definitions come from the App-level Trimble DataTable config.
 */
const AUTO_FIT_MIN_WIDTH = 60;
const AUTO_FIT_MAX_WIDTH = 360;
const AUTO_FIT_HORIZONTAL_PADDING = 24;

/*
 * Measure text using the browser canvas so a column can initially
 * fit its header and visible cell content.
 */
const measureTextWidth = (
  value,
  font = "12px Arial",
) => {
  const text =
    String(
      value ?? "",
    );

  if (
    typeof document ===
      "undefined"
  ) {
    return (
      text.length *
      7
    );
  }

  const canvas =
    measureTextWidth.canvas ||
    (
      measureTextWidth.canvas =
        document.createElement(
          "canvas",
        )
    );

  const context =
    canvas.getContext(
      "2d",
    );

  if (!context) {
    return (
      text.length *
      7
    );
  }

  context.font =
    font;

  return context.measureText(
    text,
  ).width;
};

const clampColumnWidth = (
  width,
  minWidth =
    AUTO_FIT_MIN_WIDTH,
  maxWidth =
    AUTO_FIT_MAX_WIDTH,
) =>
  Math.min(
    maxWidth,
    Math.max(
      minWidth,
      Math.ceil(
        width,
      ),
    ),
  );

const DEFAULT_COLUMN_WIDTHS = {
  drag: 34,
  index: 54,
  date: 110,
  endDate: 110,
  actions: 72,
};

const MIN_COLUMN_WIDTHS = {
  drag: 28,
  index: 44,
  date: 90,
  endDate: 90,
  actions: 56,
};

const ResizableHeaderCell = ({
  columnKey,
  width,
  minWidth,
  align = "left",
  children,
  onResize,
  onAutoFit,
}) => {
  const handleMouseDown = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      const startX =
        event.clientX;

      const startWidth =
        width;

      const handleMouseMove = (
        moveEvent,
      ) => {
        const delta =
          moveEvent.clientX -
          startX;

        const nextWidth =
          Math.max(
            minWidth,
            startWidth +
              delta,
          );

        onResize(
          columnKey,
          nextWidth,
        );
      };

      const handleMouseUp =
        () => {
          window.removeEventListener(
            "mousemove",
            handleMouseMove,
          );

          window.removeEventListener(
            "mouseup",
            handleMouseUp,
          );

          document.body.style.cursor =
            "";

          document.body.style.userSelect =
            "";
        };

      document.body.style.cursor =
        "col-resize";

      document.body.style.userSelect =
        "none";

      window.addEventListener(
        "mousemove",
        handleMouseMove,
      );

      window.addEventListener(
        "mouseup",
        handleMouseUp,
      );
    },
    [
      columnKey,
      minWidth,
      onResize,
      width,
    ],
  );

  return (
    <th
      style={{
        position:
          "relative",

        width,

        minWidth,

        padding:
          "5px 8px 5px 6px",

        textAlign:
          align,

        whiteSpace:
          "nowrap",

        overflow:
          "hidden",

        textOverflow:
          "ellipsis",

        borderBottom:
          "1px solid #d9d9d9",

        /*
         * Visible vertical separator between columns.
         */
        borderRight:
          "1px solid #d9d9d9",

        userSelect:
          "none",
      }}
    >
      <span
        title={
          typeof children === "string"
            ? children
            : undefined
        }
        style={{
          display:
            "block",

          width:
            "100%",

          overflow:
            "hidden",

          textOverflow:
            "ellipsis",

          whiteSpace:
            "nowrap",
        }}
      >
        {children}
      </span>

      <span
        onMouseDown={
          handleMouseDown
        }
        onDoubleClick={(
          event,
        ) => {
          event.preventDefault();
          event.stopPropagation();

          if (
            typeof onAutoFit ===
            "function"
          ) {
            onAutoFit(
              columnKey,
            );

            return;
          }

          const defaultWidth =
            DEFAULT_COLUMN_WIDTHS[
              columnKey
            ];

          if (
            defaultWidth
          ) {
            onResize(
              columnKey,
              defaultWidth,
            );
          }
        }}
        onClick={(
          event,
        ) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        style={{
          position:
            "absolute",

          top:
            0,

          right:
            -3,

          width:
            7,

          height:
            "100%",

          cursor:
            "col-resize",

          zIndex:
            3,

          /*
           * Keep the resize boundary visible while also
           * providing a wider mouse hit area.
           */
          borderRight:
            "1px solid transparent",
        }}
      />
    </th>
  );
};

const cellStyle = {
  center: {
    padding: "4px",
    textAlign: "center",
    verticalAlign: "middle",
    borderBottom: "1px solid #f0f0f0",
    borderRight: "1px solid #e8e8e8",
  },
  index: {
    padding: "4px 6px",
    fontWeight: 600,
    whiteSpace: "nowrap",
    verticalAlign: "middle",
    borderBottom: "1px solid #f0f0f0",
    borderRight: "1px solid #e8e8e8",
  },
  text: {
    padding: "4px 6px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
    borderBottom: "1px solid #f0f0f0",
    borderRight: "1px solid #e8e8e8",
  },
  number: {
    padding: "4px 6px",
    textAlign: "right",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
    borderBottom: "1px solid #f0f0f0",
    borderRight: "1px solid #e8e8e8",
  },
  date: {
    padding: "4px 6px",
    textAlign: "center",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
    borderBottom: "1px solid #f0f0f0",
    borderRight: "1px solid #e8e8e8",
  },
};

const SortableSubItem = React.memo(
  ({
    item,
    displayIndex,
    icon,

    selectedIds,
    setSelectedIds,

    lastSelected,
    setLastSelected,

    setFocusedIndex,
    currentObjects,

    onAssignDate,
    onDelete,
    onDeleteMulti,

    selectObjectsInViewer,
    setActiveItem,
    listRef,

    onAddCamera,
    onChangeCamera,
    onDeleteCamera,
    onZoomIn,

    onOpenMoveModal,

    visibleProperties = [],
    projectFormatting,
    isOwner = false,
    nodeMode = false,
  }) => {
    const { message } = App.useApp();

    const [assignDate, setAssignDate] = useState(null);
    const [assignEndDate, setAssignEndDate] = useState(null);

    const [dateStep, setDateStep] = useState(0);
    const [considerWeekend, setConsiderWeekend] = useState(false);

    const sortableId = getObjectKey(item);

    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({
        id: sortableId,
        disabled: !isOwner,
      });

    const isSelected = selectedIds.some((selected) =>
      isSameObject(selected, item),
    );

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      cursor: "pointer",
      background: isSelected ? "#e6f4ff" : "#fff",
      boxShadow: isSelected
        ? "inset 0 0 0 1px #91caff"
        : "none",
    };

    const handleClick = async (event) => {
      event.stopPropagation();

      listRef.current?.focus();

      const isCtrlSelect = event.ctrlKey || event.metaKey;

      const isShiftSelect = event.shiftKey;

      let nextSelection = [];

      if (isShiftSelect && lastSelected) {
        const startIndex = currentObjects.findIndex((obj) =>
          isSameObject(obj, lastSelected),
        );

        const endIndex = currentObjects.findIndex((obj) =>
          isSameObject(obj, item),
        );

        if (startIndex !== -1 && endIndex !== -1) {
          const range = currentObjects.slice(
            Math.min(startIndex, endIndex),
            Math.max(startIndex, endIndex) + 1,
          );

          nextSelection = [
            ...new Map(
              [...selectedIds, ...range].map((obj) => [getObjectKey(obj), obj]),
            ).values(),
          ];

          setSelectedIds(nextSelection);

          setLastSelected(item);
        }
      } else if (isCtrlSelect) {
        const exists = selectedIds.some((selected) =>
          isSameObject(selected, item),
        );

        nextSelection = exists
          ? selectedIds.filter((selected) => !isSameObject(selected, item))
          : [...selectedIds, item];

        setSelectedIds(nextSelection);

        setLastSelected(item);
      } else {
        nextSelection = [item];

        setSelectedIds(nextSelection);

        setLastSelected(item);
        setActiveItem(item);
      }

      const clickedIndex = currentObjects.findIndex((obj) =>
        isSameObject(obj, item),
      );

      if (clickedIndex !== -1) {
        setFocusedIndex(clickedIndex);
      }

      await selectObjectsInViewer(nextSelection);
    };

    const handleDeleteClick = (event) => {
      event.stopPropagation();

      if (!isOwner) {
        return;
      }

      onDelete(item);
    };

    const handleGoToCamera = useCallback(
      async (selectedItem) => {
        if (!selectedItem?.camera) {
          message.warning("This item does not have a saved camera.");

          return;
        }

        try {
          const tcapi = await WorkspaceAPI.connect(window.parent);

          await tcapi.viewer.setCamera(selectedItem.camera, {
            animationTime: 1000,
          });
        } catch (error) {
          console.error("Go to camera failed:", error);

          message.error("Unable to restore the saved camera.");
        }
      },
      [message],
    );

    const contextMenuItems = useMemo(() => {
      const items = [
        {
          key: "zoomIn",
          icon: <ZoomInOutlined />,
          label: "Zoom To Selected",

          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onZoomIn(item);
          },
        },
      ];

      /*
       * Viewer can only use read-only actions.
       */
      if (!isOwner) {
        return items;
      }

      items.unshift(
        {
          key: "assignDate",
          label: (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <DatePicker
                size="small"
                placeholder="Start date"
                value={assignDate}
                onChange={setAssignDate}
              />

              <DatePicker
                size="small"
                placeholder="End date"
                value={assignEndDate}
                minDate={assignDate || undefined}
                onChange={setAssignEndDate}
              />

              <Input
                size="small"
                type="number"
                style={{
                  width: 50,
                }}
                value={dateStep}
                onChange={(event) => setDateStep(event.target.value)}
              />

              <Checkbox
                checked={considerWeekend}
                onChange={(event) => {
                  setConsiderWeekend(event.target.checked);
                }}
              >
                Weekend
              </Checkbox>

              <Button
                size="small"
                type="text"
                disabled={!assignDate && !assignEndDate && !Number(dateStep)}
                icon={<EditOutlined />}
                onClick={(event) => {
                  event.stopPropagation();

                  onAssignDate(
                    assignDate,
                    assignEndDate,
                    dateStep,
                    considerWeekend,
                  );
                }}
              />
            </div>
          ),
        },

        {
          type: "divider",
        },
      );

      items.push(
        {
          key: "addView",
          icon: <CameraOutlined />,
          label: "Add Camera",

          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onAddCamera(item);
          },
        },

        {
          key: "updateView",
          icon: <CameraOutlined />,
          label: "Change Camera",

          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onChangeCamera(item);
          },
        },

        {
          key: "deleteView",
          danger: true,
          icon: <EyeInvisibleOutlined />,
          label: "Delete Camera",

          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onDeleteCamera(item);
          },
        },
      );

      /*
       * Move the clicked object, or all currently selected objects when
       * the clicked object belongs to the selection, to another SubPlan.
       *
       * Only SubPlans in the same Plan are offered.
       */
      items.push(
        {
          type: "divider",
        },
        {
          key: "moveToSubPlan",
          label: nodeMode ? "Move to Sub Plan" : "Move to Sub Plan",
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onOpenMoveModal?.(item);
          },
        },
      );

      items.push(
        {
          type: "divider",
        },

        {
          key: "delete",
          danger: true,
          icon: <DeleteOutlined />,
          label: "Delete",

          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onDeleteMulti();
          },
        },
      );

      return items;
    }, [
      assignDate,
      assignEndDate,
      dateStep,
      considerWeekend,
      isOwner,
      nodeMode,
      item,
      onAddCamera,
      onAssignDate,
      onChangeCamera,
      onDeleteCamera,
      onDeleteMulti,
      onZoomIn,
      onOpenMoveModal,
    ]);

    const objectDate = getObjectDate(item);

    const displayDate = objectDate
      ? dayjs(objectDate).format("DD-MM-YYYY")
      : "";

    const objectEndDate = getObjectEndDate(item);
    const displayEndDate = objectEndDate
      ? dayjs(objectEndDate).format("DD-MM-YYYY")
      : "";

    return (
      <Dropdown
        trigger={["contextMenu"]}
        menu={{
          items: contextMenuItems,
        }}
      >
        <tr
          ref={setNodeRef}
          data-object-key={sortableId}
          style={style}
          {...attributes}
          onClick={handleClick}
          tabIndex={-1}
        >
          <td style={cellStyle.center}>
            {isOwner ? (
              <span
                {...listeners}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "grab",
                  touchAction: "none",
                }}
                onClick={(event) => event.stopPropagation()}
              >
                {icon}
              </span>
            ) : (
              <span>{icon}</span>
            )}
          </td>

          <td style={cellStyle.index}>
            {displayIndex}
          </td>

          {visibleProperties.map(
            (property) => {
              const rawValue =
                getSequenceColumnValue(
                  item,
                  property,
                  {
                    projectFormatting,
                  },
                );

              const displayValue =
                rawValue == null
                  ? ""
                  : String(
                      rawValue,
                    );

              return (
                <td
                  key={
                    property.field
                  }
                  title={
                    displayValue
                  }
                  style={{
                    ...cellStyle.text,

                    textAlign:
                      property.align ||
                      "left",
                  }}
                >
                  {property.field ===
                  "assemblyPos" ? (
                    <strong>
                      {displayValue ||
                        getExternalId(
                          item,
                        ) ||
                        getRuntimeId(
                          item,
                        )}
                    </strong>
                  ) : (
                    displayValue
                  )}
                </td>
              );
            },
          )}

          <td style={cellStyle.date}>
            {displayDate}
          </td>

          <td style={cellStyle.date}>
            {displayEndDate}
          </td>

          <td
            style={{
              ...cellStyle.center,
              borderRight: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              {item.camera && (
                <Tooltip title="Go to saved camera">
                  <Button
                    size="small"
                    type="text"
                    icon={<CameraOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleGoToCamera(item);
                    }}
                    style={{
                      color: "#1677ff",
                    }}
                  />
                </Tooltip>
              )}

              {isOwner && (
                <Tooltip title="Delete">
                  <Button
                    size="small"
                    type="text"
                    icon={<CloseOutlined />}
                    onClick={handleDeleteClick}
                  />
                </Tooltip>
              )}
            </div>
          </td>
        </tr>
      </Dropdown>
    );
  },
);

const SequenceObjectCollapse = ({
  subPlan,
  activeSimulationItem,
  displayIndexMap,
  isOwner = false,
  loadedModelIds = [],

  // Generic node-mode adapter used by the recursive V2 hierarchy.
  nodeMode = false,
  sequenceObjectsOverride = null,
  projectIdOverride = null,
  moveTargets = [],
  onPersistObjects = null,
  onMoveObjects = null,
}) => {
  const dispatch = useDispatch();

  const reduxSequenceObjects = useSelector(
    (state) => state.sequence.sequenceObjects || [],
  );

  const subPlans = useSelector(
    (state) => state.sequence.subPlans || [],
  );

  const plans = useSelector(
    (state) => state.sequence.plans || [],
  );

  const reduxProjectId = useSelector((state) => state.sequence.projectId || "");

  const sequenceObjects = sequenceObjectsOverride || reduxSequenceObjects;
  const projectId = projectIdOverride || reduxProjectId;
  const currentGroupId = String(subPlan?.id ?? "");

  const loading = useSelector((state) => state.sequence.pending);

  const [selectedIds, setSelectedIds] = useState([]);

  const [lastSelected, setLastSelected] = useState(null);

  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveTriggerItem, setMoveTriggerItem] = useState(null);
  const [moveTargetSubPlanId, setMoveTargetSubPlanId] = useState(null);

  const [focusedIndex, setFocusedIndex] = useState(0);

  const [localObjects, setLocalObjects] = useState([]);


  /*
   * Values resolved from Trimble viewer.getObjectProperties()
   * using exact DataTable Column.field keys.
   *
   * Map key:
   *   modelId:runtimeId
   *
   * Map value:
   *   {
   *     "PropertySet+WEIGHT": 121.5,
   *     "PropertySet+ASSEMBLY_POS": "C5-1",
   *     "entity_class": "IFCELEMENTASSEMBLY",
   *     ...
   *   }
   */
  const [
    dataTableValueMap,
    setDataTableValueMap,
  ] = useState(
    new Map(),
  );

  const [
    loadingDataTableValues,
    setLoadingDataTableValues,
  ] = useState(false);


  const [projectFormatting, setProjectFormatting] =
    useState(DEFAULT_FORMATTING);

  const [
    columnWidths,
    setColumnWidths,
  ] = useState({
    ...DEFAULT_COLUMN_WIDTHS,
  });

  const [
    psetMetadataRevision,
    setPsetMetadataRevision,
  ] = useState(0);


  /*
   * Columns manually resized by the user are not overwritten by
   * automatic fitting when row data changes.
   */
  const manuallyResizedColumnsRef =
    useRef(
      new Set(),
    );

  const {
    selectedFields:
      visiblePropertyKeys,

    selectedColumns:
      visibleProperties,

    selectedColumnSet,

    psetApiUrl,
    psetReloadRevision,
  } =
    useSequenceColumnConfig();

  const externalPsetFields =
    useMemo(
      () => {
        const allFields =
          visibleProperties
            .map(
              (column) =>
                String(
                  column?.field ||
                    "",
                ).trim(),
            )
            .filter(Boolean);

        const psetFields =
          allFields.filter(
            (field) =>
              isExternalPsetField(
                field,
              ),
          );

        return psetFields;
      },
      [
        visibleProperties,
      ],
    );

  /*
   * One Trimble DataTable preset is used for the entire App.
   *
   * Every Plan/SubPlan/Sequence Object table therefore renders
   * the same ordered ColumnSet.columns list.
   */
  /*
   * Ensure every DataTable field has a resize width.
   */
  useEffect(
    () => {
      setColumnWidths(
        (previous) => {
          const next = {
            ...previous,
          };

          visibleProperties.forEach(
            (column) => {
              if (
                !next[
                  column.field
                ]
              ) {
                /*
                 * Initial width is intentionally compact.
                 * The content auto-fit effect below will size the
                 * column from actual visible cell values only.
                 *
                 * Header text may be ellipsized and therefore does
                 * not force the column wider.
                 */
                next[
                  column.field
                ] =
                  column.minWidth ||
                  AUTO_FIT_MIN_WIDTH;
              }
            },
          );

          return next;
        },
      );
    },
    [
      visibleProperties,
    ],
  );

  const handleColumnResize =
    useCallback(
      (
        columnKey,
        nextWidth,
      ) => {
        manuallyResizedColumnsRef.current.add(
          columnKey,
        );

        setColumnWidths(
          (previous) => ({
            ...previous,

            [columnKey]:
              Math.round(
                nextWidth,
              ),
          }),
        );
      },
      [],
    );

  const tcapiRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    const connectApi = async () => {
      try {
        const tcapi = await WorkspaceAPI.connect(window.parent);

        tcapiRef.current = tcapi;

        const settings = await tcapi.project.getSettings();

        const formatting = normalizeProjectFormatting(
          settings?.formatting || DEFAULT_FORMATTING,
        );

        if (mounted) {
          setProjectFormatting(formatting);
        }
      } catch (error) {
        console.error("Connect Trimble API failed:", error);

        if (mounted) {
          setProjectFormatting(DEFAULT_FORMATTING);
        }
      }
    };

    connectApi();

    return () => {
      mounted = false;
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const reduxObjects = useMemo(() => {
    const currentObjectsGroup = sequenceObjects.find((group) => {
      if (nodeMode) {
        return group && String(group.nodeId) === currentGroupId;
      }

      return group && String(group.subPlanId) === currentGroupId;
    });

    return currentObjectsGroup?.objects || [];
  }, [sequenceObjects, currentGroupId, nodeMode]);

  useEffect(() => {
    if (!nodeMode) {
      setLocalObjects(reduxObjects);
      return;
    }

    /*
     * A Node mutation may send DB-only rows back to this component. Preserve
     * the already hydrated Trimble runtime fields while accepting the new
     * persisted values.
     */
    setLocalObjects((previousObjects) => {
      const previousByExternalId = new Map(
        (previousObjects || []).map((object) => [
          String(getExternalId(object) ?? ""),
          object,
        ]),
      );

      return (reduxObjects || []).map((incomingObject) => {
        const previousObject = previousByExternalId.get(
          String(getExternalId(incomingObject) ?? ""),
        );

        const incomingHasRuntime =
          getObjectModelId(incomingObject) != null &&
          getRuntimeId(incomingObject) != null &&
          incomingObject?.objectAvailable !== false;

        if (!previousObject || incomingHasRuntime) {
          return incomingObject;
        }

        return {
          ...incomingObject,
          ...previousObject,
          dbId: incomingObject.dbId ?? previousObject.dbId,
          trimbleProjectId:
            incomingObject.trimbleProjectId ??
            previousObject.trimbleProjectId,
          subPlanId: incomingObject.subPlanId,
          nodeId: incomingObject.nodeId ?? previousObject.nodeId,
          externalId:
            incomingObject.externalId ?? getExternalId(previousObject),
          assignedDate: incomingObject.assignedDate,
          date: incomingObject.date,
          sortDatetime: incomingObject.sortDatetime,
          camera: incomingObject.camera,
          createdAt: incomingObject.createdAt ?? previousObject.createdAt,
          updatedAt: incomingObject.updatedAt ?? previousObject.updatedAt,
        };
      });
    });
  }, [reduxObjects, nodeMode]);

  const currentObjects = localObjects;

  /*
   * All Sequence Objects in every Plan/SubPlan.
   *
   * PSet values are loaded project-wide whenever the selected ColumnSet
   * changes. Runtime/model availability is not required for PSet REST
   * calls because the external GUID is the identity used by batch-get.
   */
  const allProjectObjects =
    useMemo(
      () =>
        sequenceObjects
          .flatMap(
            (group) =>
              Array.isArray(
                group?.objects,
              )
                ? group.objects
                : [],
          )
          .filter(
            (object) =>
              Boolean(
                String(
                  getExternalId(
                    object,
                  ) || "",
                ).trim(),
              ),
          ),
      [
        sequenceObjects,
      ],
    );

  /*
   * Allow moving Sequence Objects to ANY other SubPlan,
   * including SubPlans that belong to another Plan.
   *
   * Sort by Plan first, then SubPlan name.
   */
  const moveTargetSubPlans = useMemo(
    () => {
      if (nodeMode) {
        return (Array.isArray(moveTargets) ? moveTargets : [])
          .filter((item) => String(item?.id) !== currentGroupId)
          .sort((first, second) =>
            String(first?.name || "").localeCompare(
              String(second?.name || ""),
              undefined,
              { numeric: true, sensitivity: "base" },
            ),
          );
      }

      return subPlans
        .filter((item) => String(item?.id) !== String(subPlan?.id))
        .sort((first, second) => {
          const firstPlan = String(first?.planName ?? first?.plan?.name ?? first?.planId ?? "");
          const secondPlan = String(second?.planName ?? second?.plan?.name ?? second?.planId ?? "");
          const planCompare = firstPlan.localeCompare(secondPlan, undefined, { numeric: true, sensitivity: "base" });
          if (planCompare !== 0) return planCompare;
          return String(first?.name || "").localeCompare(String(second?.name || ""), undefined, { numeric: true, sensitivity: "base" });
        });
    },
    [subPlans, subPlan?.id, nodeMode, moveTargets, currentGroupId],
  );

  const moveSubPlanTreeData = useMemo(() => {
    if (nodeMode) {
      const items = moveTargetSubPlans;
      const byParent = new Map();
      const roots = [];

      items.forEach((item) => {
        const parentId = item?.parentId ?? item?.parent_id ?? null;
        const key = String(parentId ?? "__ROOT__");
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key).push(item);
      });

      const build = (parentId) => {
        const key = String(parentId ?? "__ROOT__");
        return (byParent.get(key) || [])
          .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { numeric: true, sensitivity: "base" }))
          .map((item) => ({
            title: item?.name || "Unnamed Node",
            key: `node-${item.id}`,
            nodeId: String(item.id),
            isNode: true,
            selectable: true,
            children: build(item.id),
          }));
      };

      return build(null);
    }

    return plans
      .map((plan) => {
        const children = moveTargetSubPlans
          .filter((targetSubPlan) => String(targetSubPlan?.planId) === String(plan?.id))
          .sort((first, second) => String(first?.name || "").localeCompare(String(second?.name || ""), undefined, { numeric: true, sensitivity: "base" }))
          .map((targetSubPlan) => ({
            title: targetSubPlan?.name || "Unnamed Sub Plan",
            key: `subplan-${targetSubPlan.id}`,
            subPlanId: String(targetSubPlan.id),
            isSubPlan: true,
            selectable: true,
          }));

        return {
          title: plan?.name || "Unnamed Plan",
          key: `plan-${plan.id}`,
          selectable: false,
          children,
        };
      })
      .filter((planNode) => Array.isArray(planNode.children) && planNode.children.length > 0);
  }, [plans, moveTargetSubPlans, nodeMode]);

  const loadedModelIdSet = useMemo(
    () =>
      new Set(
        (loadedModelIds || [])
          .filter((modelId) => modelId != null && modelId !== "")
          .map(String),
      ),
    [loadedModelIds],
  );

  /*
   * Chỉ hiển thị và thao tác với object thuộc
   * model đang được load trong Trimble Connect.
   */
  const visibleObjects = useMemo(() => {
    if (!loadedModelIdSet.size) {
      return [];
    }

    return currentObjects.filter((object) => {
      const modelId = getObjectModelId(object);

      const runtimeId = getRuntimeId(object);

      if (
        modelId == null ||
        runtimeId == null ||
        object?.objectAvailable === false
      ) {
        return false;
      }

      return loadedModelIdSet.has(String(modelId));
    });
  }, [currentObjects, loadedModelIdSet]);

  useEffect(
    () => {
      let cancelled =
        false;

      const hydrateDataTableValues =
        async () => {
          if (
            psetReloadRevision > 0 &&
            projectId &&
            psetApiUrl &&
            externalPsetFields.length
          ) {
            invalidateProjectPsetCache({
              projectId,
              psetApiUrl,
              externalPsetFields,
            });
          }

          if (
            !visibleObjects.length
          ) {
            setDataTableValueMap(
              new Map(),
            );

            setLoadingDataTableValues(
              false,
            );

            return;
          }

          setLoadingDataTableValues(
            true,
          );

          try {
            const tcapi =
              tcapiRef.current ||
              (await WorkspaceAPI.connect(
                window.parent,
              ));

            tcapiRef.current =
              tcapi;

            /*
             * =====================================================
             * STAGE 1
             * =====================================================
             *
             * Load normal model properties first.
             *
             * Do NOT wait for external Property Set REST API here.
             * This lets the table immediately display values such as:
             *
             * PropertySet+WEIGHT
             * PropertySet+AREA
             * PropertySet+VOLUME
             * PropertySet+ASSEMBLY_POS
             * ...
             */
            const modelValueMap =
              await loadDataTableValues(
                tcapi,
                visibleObjects,
                {
                  psetApiUrl:
                    "",

                  externalPsetFields:
                    [],
                },
              );

            if (
              cancelled
            ) {
              return;
            }

            /*
             * Render all normal model values immediately.
             */
            setDataTableValueMap(
              new Map(
                modelValueMap,
              ),
            );

            setLoadingDataTableValues(
              false,
            );

            /*
             * =====================================================
             * STAGE 2
             * =====================================================
             *
             * Lazy project-wide external PSet loading.
             *
             * Normal viewer/model properties above have already been
             * rendered, so PSet discovery and batch-get never block the
             * existing table values.
             *
             * Changing the App-level ColumnSet changes
             * externalPsetFields, which creates a new project cache key
             * and triggers one background load for ALL project objects.
             */
            if (
              !externalPsetFields.length ||
              !psetApiUrl ||
              !projectId ||
              !allProjectObjects.length
            ) {
              return;
            }

            await new Promise(
              (resolve) => {
                scheduleLazyTask(
                  resolve,
                );
              },
            );

            if (
              cancelled
            ) {
              return;
            }

            const externalValuesByGuid =
              await loadProjectExternalPsetValues({
                tcapi,
                objects:
                  allProjectObjects,
                projectId,
                psetApiUrl,
                externalPsetFields,
              });

            if (
              cancelled
            ) {
              return;
            }

            /*
             * API 2 may have resolved raw prop_xxx names to i18n names
             * such as IBIM_LENGTH.
             */
            setPsetMetadataRevision(
              (value) =>
                value + 1,
            );

            /*
             * Merge only values belonging to this visible SubPlan table.
             * Other Plan/SubPlan tables reuse the same project-wide cache.
             */
            setDataTableValueMap(
              (
                previousMap,
              ) => {
                const nextMap =
                  new Map(
                    previousMap,
                  );

                for (
                  const object of
                    visibleObjects
                ) {
                  const modelId =
                    getObjectModelId(
                      object,
                    );

                  const runtimeId =
                    getRuntimeId(
                      object,
                    );

                  const guid =
                    String(
                      getExternalId(
                        object,
                      ) ||
                        "",
                    ).trim();

                  if (
                    modelId == null ||
                    runtimeId == null ||
                    !guid
                  ) {
                    continue;
                  }

                  const objectKey =
                    `${modelId}:${runtimeId}`;

                  const currentValues =
                    nextMap.get(
                      objectKey,
                    ) ||
                    {};

                  const externalValues =
                    externalValuesByGuid.get(
                      guid,
                    ) ||
                    {};

                  nextMap.set(
                    objectKey,
                    {
                      ...currentValues,
                      ...externalValues,
                    },
                  );
                }

                return nextMap;
              },
            );

          } catch (
            error
          ) {
            console.error(
              "Load DataTable property values failed:",
              error,
            );

            if (
              !cancelled
            ) {
              /*
               * Do not clear already rendered model values if only
               * the later PSet request fails.
               */
              setLoadingDataTableValues(
                false,
              );
            }
          }
        };

      hydrateDataTableValues();

      return () => {
        cancelled =
          true;
      };
    },
    [
      visibleObjects,
      allProjectObjects,
      projectId,
      psetApiUrl,
      externalPsetFields,
      psetReloadRevision,
    ],
  );

  /*
   * Attach the resolved DataTable values to the visible objects.
   *
   * The render path then becomes:
   *
   * ColumnSet.columns
   *      ↓
   * column.field
   *      ↓
   * item.dataTableValues[column.field]
   */
  const hydratedVisibleObjects =
    useMemo(
      () =>
        visibleObjects.map(
          (object) => {
            const modelId =
              getObjectModelId(
                object,
              );

            const runtimeId =
              getRuntimeId(
                object,
              );

            const key =
              `${modelId}:${runtimeId}`;

            return {
              ...object,

              dataTableValues:
                dataTableValueMap.get(
                  key,
                ) ||
                {},
            };
          },
        ),
      [
        visibleObjects,
        dataTableValueMap,
      ],
    );

  /*
   * Calculate the best width for one dynamic DataTable column.
   *
   * Width is based on:
   * - currently visible row values only
   * - current project unit formatting
   *
   * Header text does NOT determine width and may be ellipsized.
   */
  const getAutoFitColumnWidth =
    useCallback(
      (column) => {
        if (
          !column?.field
        ) {
          return AUTO_FIT_MIN_WIDTH;
        }

        /*
         * IMPORTANT:
         * Column width is based on CELL VALUES only.
         *
         * The header may be longer than the cell content and is
         * allowed to show ellipsis instead of widening the column.
         */
        let measuredWidth =
          0;

        hydratedVisibleObjects.forEach(
          (item) => {
            const value =
              getSequenceColumnValue(
                item,
                column,
                {
                  projectFormatting,
                },
              );

            measuredWidth =
              Math.max(
                measuredWidth,
                measureTextWidth(
                  value,
                  "12px Arial",
                ),
              );
          },
        );

        /*
         * If all visible values are empty, keep a compact minimum.
         */
        return clampColumnWidth(
          measuredWidth > 0
            ? measuredWidth +
                AUTO_FIT_HORIZONTAL_PADDING
            : column.minWidth ||
                AUTO_FIT_MIN_WIDTH,
          column.minWidth ||
            AUTO_FIT_MIN_WIDTH,
          AUTO_FIT_MAX_WIDTH,
        );
      },
      [
        hydratedVisibleObjects,
        projectFormatting,
      ],
    );

  /*
   * Initial/automatic fit:
   *
   * Dynamic property columns fit the actual visible content.
   * A manually resized column remains at the user's width.
   */
  useEffect(
    () => {
      if (
        !visibleProperties.length
      ) {
        return;
      }

      setColumnWidths(
        (previous) => {
          const next = {
            ...previous,
          };

          visibleProperties.forEach(
            (column) => {
              if (
                manuallyResizedColumnsRef.current.has(
                  column.field,
                )
              ) {
                return;
              }

              next[
                column.field
              ] =
                getAutoFitColumnWidth(
                  column,
                );
            },
          );

          return next;
        },
      );
    },
    [
      visibleProperties,
      getAutoFitColumnWidth,
    ],
  );

  /*
   * Double-click a separator to fit that column to content again.
   */
  const handleAutoFitColumn =
    useCallback(
      (columnKey) => {
        const column =
          visibleProperties.find(
            (item) =>
              item.field ===
              columnKey,
          );

        if (!column) {
          const defaultWidth =
            DEFAULT_COLUMN_WIDTHS[
              columnKey
            ];

          if (
            defaultWidth
          ) {
            manuallyResizedColumnsRef.current.delete(
              columnKey,
            );

            setColumnWidths(
              (previous) => ({
                ...previous,

                [columnKey]:
                  defaultWidth,
              }),
            );
          }

          return;
        }

        manuallyResizedColumnsRef.current.delete(
          columnKey,
        );

        setColumnWidths(
          (previous) => ({
            ...previous,

            [columnKey]:
              getAutoFitColumnWidth(
                column,
              ),
          }),
        );
      },
      [
        visibleProperties,
        getAutoFitColumnWidth,
      ],
    );

  const items = useMemo(() => {
    const result = [];

    sequenceObjects.forEach((group) => {
      const objects = group?.objects || [];

      objects.forEach((object) => {
        const modelId = getObjectModelId(object);

        const runtimeId = getRuntimeId(object);

        const externalId = getExternalId(object);

        if (
          modelId == null ||
          runtimeId == null ||
          externalId == null ||
          object?.objectAvailable === false ||
          !loadedModelIdSet.has(String(modelId))
        ) {
          return;
        }

        result.push({
          ...object,

          externalId,
          runtimeId,
          modelId,

          planId: object?.planId ?? group?.planId ?? (nodeMode ? null : group?.id),

          subPlanId: object?.subPlanId ?? group?.subPlanId ?? (nodeMode ? group?.nodeId : null),

          nodeId: object?.nodeId ?? group?.nodeId ?? null,
        });
      });
    });

    return result;
  }, [sequenceObjects, loadedModelIdSet]);

  const updateObjects = useCallback(
    (objects) => {
      const nextObjects = Array.isArray(objects) ? objects : [];

      /*
       * Optimistic UI update:
       * do not wait for Supabase before rendering
       * the new order or edited values.
       */
      setLocalObjects(nextObjects);

      if (!projectId) {
        console.error("Trimble project ID is missing.");
        return;
      }

      if (nodeMode && onPersistObjects) {
        Promise.resolve(
          onPersistObjects({
            nodeId: subPlan.id,
            objects: nextObjects,
          }),
        ).catch((error) => {
          console.error("Failed to persist node objects:", error);
        });
        return;
      }

      dispatch(
        SetObjectsRequest({
          projectId,
          planId: subPlan.planId,
          subPlanId: subPlan.id,
          objects: nextObjects,
        }),
      );
    },
    [dispatch, projectId, subPlan.id, subPlan.planId, nodeMode, onPersistObjects],
  );

  /*
   * Build Viewer selectors directly from hydrated runtime IDs.
   * No conversion is performed inside this component.
   */
  const resolveViewerModelObjects = useCallback(
    async (objects) => {
      if (!objects?.length) {
        return [];
      }

      const modelGroups = new Map();

      objects.forEach((object) => {
        const modelId = getObjectModelId(object);

        const runtimeId = getRuntimeId(object);

        if (
          modelId == null ||
          runtimeId == null ||
          object?.objectAvailable === false ||
          !loadedModelIdSet.has(String(modelId))
        ) {
          return;
        }

        const modelKey = String(modelId);

        if (!modelGroups.has(modelKey)) {
          modelGroups.set(modelKey, {
            modelId,
            runtimeIds: new Set(),
          });
        }

        modelGroups.get(modelKey).runtimeIds.add(runtimeId);
      });

      return [...modelGroups.values()]
        .map((group) => ({
          modelId: group.modelId,

          objectRuntimeIds: [...group.runtimeIds],
        }))
        .filter((group) => group.objectRuntimeIds.length > 0);
    },
    [loadedModelIdSet],
  );

  const selectObjectsInViewer = useCallback(
    async (objects) => {
      try {
        const tcapi =
          tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

        tcapiRef.current = tcapi;

        const modelObjectIds = await resolveViewerModelObjects(objects);

        if (!modelObjectIds.length) {
          await tcapi.viewer.setSelection(
            {
              modelObjectIds: [],
            },
            "set",
          );

          return;
        }

        await tcapi.viewer.setSelection(
          {
            modelObjectIds,
          },
          "set",
        );
      } catch (error) {
        console.error("Select objects error:", error);
      }
    },
    [resolveViewerModelObjects],
  );

  const changeIndex = useCallback(
    async (newIndex) => {
      if (!items.length) {
        return;
      }

      const safeIndex = Math.max(0, Math.min(newIndex, items.length - 1));

      const item = items[safeIndex];

      dispatch(
        SetActiveSimulationItem({
          planId: item.planId,

          subPlanId: item.subPlanId,

          nodeId: nodeMode ? (item.nodeId || subPlan.id) : undefined,

          modelId: getObjectModelId(item),

          runtimeId: getRuntimeId(item),

          id: getExternalId(item),

          objectId: getExternalId(item),
        }),
      );

      await selectObjectsInViewer([item]);
    },
    [items, dispatch, selectObjectsInViewer, nodeMode, subPlan.id],
  );

  const getCurrentIndex = useCallback(() => {
    if (activeSimulationItem) {
      return items.findIndex(
        (item) =>
          (nodeMode
            ? String(item.nodeId || item.subPlanId) === String(activeSimulationItem.nodeId || activeSimulationItem.subPlanId)
            : String(item.subPlanId) === String(activeSimulationItem.subPlanId)) &&
          String(getObjectModelId(item)) ===
            String(activeSimulationItem.modelId) &&
          String(getExternalId(item)) ===
            String(activeSimulationItem.objectId ?? activeSimulationItem.id),
      );
    }

    const currentItem = selectedIds[0] || visibleObjects[focusedIndex];

    if (!currentItem) {
      return -1;
    }

    return items.findIndex(
      (item) =>
        (nodeMode
          ? String(item.nodeId || item.subPlanId) === String(currentItem.nodeId || subPlan.id)
          : String(item.subPlanId) === String(currentItem.subPlanId || subPlan.id)) &&
        isSameObject(item, currentItem),
    );
  }, [
    items,
    activeSimulationItem,
    selectedIds,
    visibleObjects,
    focusedIndex,
    subPlan.id,
    nodeMode,
  ]);

  const next = useCallback(() => {
    const currentIndex = getCurrentIndex();

    if (currentIndex === -1) {
      changeIndex(0);
      return;
    }

    changeIndex(currentIndex + 1);
  }, [getCurrentIndex, changeIndex]);

  const prev = useCallback(() => {
    const currentIndex = getCurrentIndex();

    if (currentIndex === -1) {
      changeIndex(0);
      return;
    }

    changeIndex(currentIndex - 1);
  }, [getCurrentIndex, changeIndex]);

  const setActiveItem = useCallback(
    (item) => {
      const externalId = getExternalId(item);

      dispatch(
        SetActiveSimulationItem({
          planId: item.planId,

          subPlanId: item.subPlanId || (nodeMode ? undefined : subPlan.id),

          nodeId: nodeMode ? (item.nodeId || subPlan.id) : undefined,

          modelId: getObjectModelId(item),

          runtimeId: getRuntimeId(item),

          id: externalId,

          objectId: externalId,
        }),
      );
    },
    [dispatch, subPlan.id, nodeMode],
  );

  useEffect(() => {
    if (!activeSimulationItem || !visibleObjects.length) {
      return;
    }

    if (
      nodeMode
        ? String(activeSimulationItem.nodeId || activeSimulationItem.subPlanId) !== String(subPlan.id)
        : String(activeSimulationItem.subPlanId) !== String(subPlan.id)
    ) {
      return;
    }

    const index = visibleObjects.findIndex(
      (item) =>
        String(getObjectModelId(item)) ===
          String(activeSimulationItem.modelId) &&
        String(getExternalId(item)) ===
          String(activeSimulationItem.objectId ?? activeSimulationItem.id),
    );

    if (index === -1) {
      return;
    }

    const item = visibleObjects[index];

    setFocusedIndex(index);
    setSelectedIds([item]);
    setLastSelected(item);

    const timeoutId = setTimeout(() => {
      listRef.current?.focus();

      const element = listRef.current?.querySelector(
        `[data-object-key="${getObjectKey(item)}"]`,
      );

      element?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [activeSimulationItem, visibleObjects, subPlan.id, nodeMode]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.key === "ArrowDown") {
        next();
      } else {
        prev();
      }
    },
    [next, prev],
  );

  const onDragEndSubItem = useCallback(
    ({ active, over }) => {
      if (!isOwner) {
        return;
      }

      if (!over) {
        return;
      }

      const activeKey = String(active.id);

      const overKey = String(over.id);

      if (activeKey === overKey) {
        return;
      }

      const oldIndex = visibleObjects.findIndex(
        (item) => getObjectKey(item) === activeKey,
      );

      const newIndex = visibleObjects.findIndex(
        (item) => getObjectKey(item) === overKey,
      );

      if (oldIndex < 0 || newIndex < 0) {
        return;
      }

      const selectedKeySet = new Set(
        selectedIds.map((item) => getObjectKey(item)),
      );

      if (!selectedKeySet.has(activeKey)) {
        selectedKeySet.clear();
        selectedKeySet.add(activeKey);
      }

      const movingObjects = visibleObjects.filter((item) =>
        selectedKeySet.has(getObjectKey(item)),
      );

      if (movingObjects.length > 1 && selectedKeySet.has(overKey)) {
        return;
      }

      const remainingVisibleObjects = visibleObjects.filter(
        (item) => !selectedKeySet.has(getObjectKey(item)),
      );

      const overIndexInRemaining = remainingVisibleObjects.findIndex(
        (item) => getObjectKey(item) === overKey,
      );

      if (overIndexInRemaining < 0) {
        return;
      }

      const movingDown = oldIndex < newIndex;

      const insertIndex = movingDown
        ? overIndexInRemaining + 1
        : overIndexInRemaining;

      const safeInsertIndex = Math.max(
        0,
        Math.min(insertIndex, remainingVisibleObjects.length),
      );

      const previousItem =
        safeInsertIndex > 0
          ? remainingVisibleObjects[safeInsertIndex - 1]
          : null;

      const nextItem =
        safeInsertIndex < remainingVisibleObjects.length
          ? remainingVisibleObjects[safeInsertIndex]
          : null;

      let sortDates;
      let shouldRebalanceOrder = false;

      try {
        sortDates = createSortDatesBetween({
          previousItem,
          nextItem,
          count: movingObjects.length,
        });
      } catch (error) {
        console.warn(
          "The sort_datetime gap is exhausted. Rebalancing object order.",
          error,
        );

        shouldRebalanceOrder = true;
      }

      let updatedMovingObjects = movingObjects.map((object, index) => ({
        ...object,
        sortDatetime: shouldRebalanceOrder
          ? object.sortDatetime
          : sortDates[index],
      }));

      let reorderedVisible = [
        ...remainingVisibleObjects.slice(0, safeInsertIndex),
        ...updatedMovingObjects,
        ...remainingVisibleObjects.slice(safeInsertIndex),
      ];

      /*
       * Giữ nguyên các object thuộc model chưa loaded,
       * chỉ thay vị trí các object đang visible.
       */
      const reorderedVisibleQueue = [...reorderedVisible];

      let reorderedAll = currentObjects.map((object) => {
        const modelId = getObjectModelId(object);

        if (modelId == null || !loadedModelIdSet.has(String(modelId))) {
          return object;
        }

        return reorderedVisibleQueue.shift() || object;
      });

      if (shouldRebalanceOrder) {
        const rebalanceBaseTime = Date.now();
        const movingKeySet = new Set(
          movingObjects.map((object) => getObjectKey(object)),
        );

        /*
         * Rebalance every object, including objects from models that are not
         * currently visible. Otherwise their old timestamps could interleave
         * with the new visible order after the next database reload.
         */
        reorderedAll = reorderedAll.map((object, index) => ({
          ...object,
          sortDatetime: new Date(
            rebalanceBaseTime + index * 1000,
          ).toISOString(),
        }));

        updatedMovingObjects = reorderedAll.filter((object) =>
          movingKeySet.has(getObjectKey(object)),
        );
      }

      setLocalObjects(reorderedAll);

      if (nodeMode && onPersistObjects) {
        Promise.resolve(
          onPersistObjects({
            nodeId: subPlan.id,
            objects: reorderedAll,
          }),
        ).catch((error) => {
          console.error("Failed to persist dragged node objects:", error);
          setLocalObjects(currentObjects);
        });
      } else {
        const objectsToPersist = shouldRebalanceOrder
          ? reorderedAll
          : updatedMovingObjects;

        dispatch(
          UpdateSequenceObjectSortDatesRequest({
            subPlanId: subPlan.id,
            objects: objectsToPersist.map((object) => ({
              dbId: object.dbId,
              subPlanId: subPlan.id,
              externalId: getExternalId(object),
              sortDatetime: object.sortDatetime,
            })),
          }),
        );
      }

      setSelectedIds(updatedMovingObjects);

      const activeItem = updatedMovingObjects.find(
        (item) => getObjectKey(item) === activeKey,
      );

      if (activeItem) {
        setLastSelected(activeItem);
      }

      const nextActiveIndex = reorderedVisible.findIndex(
        (item) => getObjectKey(item) === activeKey,
      );

      setFocusedIndex(nextActiveIndex);
    },
    [
      currentObjects,
      visibleObjects,
      selectedIds,
      dispatch,
      isOwner,
      subPlan.id,
      loadedModelIdSet,
      nodeMode,
      onPersistObjects,
    ],
  );

  const handleAssignDate = useCallback(
    (date, endDate, dateStep, considerWeekend = false) => {
      if (!isOwner) {
        return;
      }

      const step = Number(dateStep) || 0;

      /*
       * Date empty + Step 0 => nothing to do.
       *
       * Negative Step is allowed for Modify Date.
       */
      if (!date && !endDate && step === 0) {
        return;
      }

      const selectedKeys = new Set(
        selectedIds.map((item) => getObjectKey(item)),
      );

      if (!selectedKeys.size) {
        return;
      }

      let dateCount = 0;

      const updated = currentObjects.map((object) => {
        const key = getObjectKey(object);

        if (!selectedKeys.has(key)) {
          return object;
        }

        let nextDate = null;
        let nextEndDate = null;
        const offset = dateCount;

        if (date) {
          /*
           * Assign using working days only.
           *
           * If the selected date falls on Saturday/Sunday,
           * shift the first assigned date to the next Monday.
           */
          nextDate = addSequenceDays(
            date,
            offset,
            considerWeekend,
          );
        } else {
          const currentAssignedDate = object.assignedDate;

          const currentDate = currentAssignedDate
            ? parseDate(currentAssignedDate)
            : null;

          /*
           * Modify Assigned Date using working days only.
           */
          nextDate = step !== 0 && currentDate
            ? addSequenceDays(currentDate, step, considerWeekend)
            : null;
        }

        if (endDate) {
          nextEndDate = addSequenceDays(
            endDate,
            offset,
            considerWeekend,
          );
        } else {
          const currentEndDate = getObjectEndDate(object);
          const parsedEndDate = currentEndDate
            ? parseDate(currentEndDate)
            : null;

          nextEndDate = step !== 0 && parsedEndDate
            ? addSequenceDays(parsedEndDate, step, considerWeekend)
            : null;
        }

        if (date || endDate) {
          dateCount += step;
        }

        const assignedDateValue = nextDate?.isValid()
          ? nextDate.format("YYYY-MM-DD")
          : null;
        const endDateValue = nextEndDate?.isValid()
          ? nextEndDate.format("YYYY-MM-DD")
          : null;

        return {
          ...object,
          assignedDate: assignedDateValue,
          date: assignedDateValue,
          endDate: endDateValue,
        };
      });

      updateObjects(updated);
    },
    [currentObjects, isOwner, selectedIds, updateObjects],
  );

  const handleOpenMoveModal = useCallback(
    (triggerItem) => {
      if (!isOwner || !triggerItem) {
        return;
      }

      setMoveTriggerItem(triggerItem);
      setMoveTargetSubPlanId(null);
      setMoveModalOpen(true);
    },
    [isOwner],
  );

  const handleCloseMoveModal = useCallback(() => {
    setMoveModalOpen(false);
    setMoveTriggerItem(null);
    setMoveTargetSubPlanId(null);
  }, []);

  const handleConfirmMoveToSubPlan = useCallback(async () => {
    if (!isOwner || !moveTriggerItem || !moveTargetSubPlanId) return;

    const targetId = String(moveTargetSubPlanId);
    const triggerKey = getObjectKey(moveTriggerItem);
    const selectedKeySet = new Set(selectedIds.map((item) => getObjectKey(item)));
    const keysToMove = selectedKeySet.has(triggerKey) ? selectedKeySet : new Set([triggerKey]);

    const movingObjects = currentObjects.filter((object) => keysToMove.has(getObjectKey(object)));
    if (!movingObjects.length) {
      handleCloseMoveModal();
      return;
    }

    if (nodeMode && onMoveObjects) {
      const targetGroup = sequenceObjects.find((group) => String(group?.nodeId) === targetId);
      const targetObjects = Array.isArray(targetGroup?.objects) ? targetGroup.objects : [];
      const targetKeys = new Set(targetObjects.map((object) => getObjectKey(object)));
      const movedObjects = movingObjects.filter((object) => !targetKeys.has(getObjectKey(object)));
      const remainingObjects = currentObjects.filter((object) => !keysToMove.has(getObjectKey(object)));

      try {
        await onMoveObjects({
          sourceNodeId: subPlan.id,
          targetNodeId: targetId,
          remainingObjects,
          movedObjects,
          targetObjects,
        });

        setLocalObjects(remainingObjects);
        setSelectedIds([]);
        setLastSelected(null);
        setFocusedIndex(remainingObjects.length ? Math.min(focusedIndex, remainingObjects.length - 1) : -1);
        handleCloseMoveModal();
      } catch (error) {
        console.error("Failed to move node objects:", error);
      }
      return;
    }

    const targetSubPlan = subPlans.find((item) => String(item?.id) === targetId);
    if (!targetSubPlan?.id) return;

    const remainingObjects = currentObjects.filter((object) => !keysToMove.has(getObjectKey(object)));
    const targetGroup = sequenceObjects.find((group) => String(group?.subPlanId) === String(targetSubPlan.id));
    const targetObjects = Array.isArray(targetGroup?.objects) ? targetGroup.objects : [];
    const targetKeys = new Set(targetObjects.map((object) => getObjectKey(object)));
    const movedObjects = movingObjects.filter((object) => !targetKeys.has(getObjectKey(object))).map((object) => ({ ...object, planId: targetSubPlan.planId, subPlanId: targetSubPlan.id }));

    setLocalObjects(remainingObjects);
    dispatch(SetObjectsRequest({ projectId, planId: subPlan.planId, subPlanId: subPlan.id, objects: remainingObjects }));
    dispatch(SetObjectsRequest({ projectId, planId: targetSubPlan.planId, subPlanId: targetSubPlan.id, objects: [...targetObjects, ...movedObjects] }));
    setSelectedIds([]);
    setLastSelected(null);
    setFocusedIndex(remainingObjects.length ? Math.min(focusedIndex, remainingObjects.length - 1) : -1);
    handleCloseMoveModal();
  }, [
    isOwner, moveTriggerItem, moveTargetSubPlanId, selectedIds, currentObjects,
    nodeMode, onMoveObjects, sequenceObjects, subPlan.id, subPlan.planId,
    subPlans, dispatch, projectId, focusedIndex, handleCloseMoveModal,
  ]);

  const handleDelete = useCallback(
    (item) => {
      if (!isOwner) {
        return;
      }

      const updated = currentObjects.filter((obj) => !isSameObject(obj, item));

      updateObjects(updated);

      setSelectedIds((previous) =>
        previous.filter((selected) => !isSameObject(selected, item)),
      );

      setLastSelected((previous) =>
        isSameObject(previous, item) ? null : previous,
      );

      setFocusedIndex((previous) => {
        if (!updated.length) {
          return -1;
        }

        return Math.max(0, Math.min(previous, updated.length - 1));
      });
    },
    [currentObjects, isOwner, updateObjects],
  );

  const handleDeleteMulti = useCallback(() => {
    if (!isOwner || !selectedIds.length) {
      return;
    }

    const selectedKeys = new Set(selectedIds.map((obj) => getObjectKey(obj)));

    const updated = currentObjects.filter(
      (obj) => !selectedKeys.has(getObjectKey(obj)),
    );

    updateObjects(updated);

    setSelectedIds([]);
    setLastSelected(null);

    setFocusedIndex((previous) => {
      if (!updated.length) {
        return -1;
      }

      return Math.max(0, Math.min(previous, updated.length - 1));
    });
  }, [currentObjects, isOwner, selectedIds, updateObjects]);

  const getCameraTargetObjects = useCallback(
    (triggerItem) => {
      const triggerKey = getObjectKey(triggerItem);

      const selectedKeySet = new Set(
        selectedIds.map((object) => getObjectKey(object)),
      );

      if (selectedKeySet.has(triggerKey)) {
        return visibleObjects.filter((object) =>
          selectedKeySet.has(getObjectKey(object)),
        );
      }

      return visibleObjects.filter(
        (object) => getObjectKey(object) === triggerKey,
      );
    },
    [visibleObjects, selectedIds],
  );

  const updateSelectedObjectCameras = useCallback(
    (triggerItem, camera) => {
      if (!isOwner) {
        return;
      }

      const targetObjects = getCameraTargetObjects(triggerItem);

      if (!targetObjects.length) {
        return;
      }

      const targetKeySet = new Set(
        targetObjects.map((object) => getObjectKey(object)),
      );

      const newObjects = currentObjects.map((object) =>
        targetKeySet.has(getObjectKey(object))
          ? {
              ...object,
              camera,
            }
          : object,
      );

      updateObjects(newObjects);

      setSelectedIds(
        newObjects.filter((object) => targetKeySet.has(getObjectKey(object))),
      );
    },
    [currentObjects, getCameraTargetObjects, isOwner, updateObjects],
  );
  const handleAddCamera = useCallback(
    async (item) => {
      if (!isOwner) {
        return;
      }

      try {
        const tcapi =
          tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

        tcapiRef.current = tcapi;

        const camera = await tcapi.viewer.getCamera();

        if (!camera) {
          return;
        }

        updateSelectedObjectCameras(item, camera);
      } catch (error) {
        console.error("Save camera failed:", error);
      }
    },
    [isOwner, updateSelectedObjectCameras],
  );

  const handleChangeCamera = useCallback(
    async (item) => {
      if (!isOwner) {
        return;
      }

      try {
        const tcapi =
          tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

        tcapiRef.current = tcapi;

        const camera = await tcapi.viewer.getCamera();

        if (!camera) {
          return;
        }

        updateSelectedObjectCameras(item, camera);
      } catch (error) {
        console.error("Change camera failed:", error);
      }
    },
    [isOwner, updateSelectedObjectCameras],
  );

  const handleDeleteCamera = useCallback(
    (item) => {
      if (!isOwner) {
        return;
      }

      try {
        updateSelectedObjectCameras(item, null);
      } catch (error) {
        console.error("Delete camera failed:", error);
      }
    },
    [isOwner, updateSelectedObjectCameras],
  );

  const handleZoomToSelected = useCallback(async () => {
    try {
      const tcapi =
        tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

      tcapiRef.current = tcapi;

      const selectedKeys = new Set(
        selectedIds.map((item) => getObjectKey(item)),
      );

      const selectedObjects = visibleObjects.filter((obj) =>
        selectedKeys.has(getObjectKey(obj)),
      );

      const modelObjectIds = await resolveViewerModelObjects(selectedObjects);

      if (!modelObjectIds.length) {
        return;
      }

      const selector = {
        modelObjectIds,
      };

      await tcapi.viewer.setSelection(selector, "set");

      await tcapi.viewer.setCamera(selector, {
        animationTime: 800,
      });
    } catch (error) {
      console.error("Zoom selected objects error:", error);
    }
  }, [visibleObjects, selectedIds, resolveViewerModelObjects]);

  useEffect(() => {
    const visibleKeySet = new Set(
      visibleObjects.map((object) => getObjectKey(object)),
    );

    setSelectedIds((previous) =>
      previous.filter((object) => visibleKeySet.has(getObjectKey(object))),
    );

    setLastSelected((previous) =>
      previous && visibleKeySet.has(getObjectKey(previous)) ? previous : null,
    );
  }, [visibleObjects]);

  useEffect(() => {
    if (!visibleObjects.length) {
      setFocusedIndex(-1);
      return;
    }

    if (focusedIndex > visibleObjects.length - 1) {
      setFocusedIndex(visibleObjects.length - 1);
    }
  }, [visibleObjects.length, focusedIndex]);

  if (!visibleObjects.length) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Objects" />
    );
  }

  return (
    <>
      <DndContext
      sensors={isOwner ? sensors : []}
      collisionDetection={closestCenter}
      onDragEnd={isOwner ? onDragEndSubItem : undefined}
    >
      <SortableContext
        items={hydratedVisibleObjects.map((item) => getObjectKey(item))}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={listRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          style={{
            outline: "none",
          }}
        >
          {!visibleProperties.length && (
            <div
              style={{
                marginLeft:
                  10,

                marginBottom:
                  6,

                padding:
                  "6px 8px",

                border:
                  "1px solid #ffe58f",

                borderRadius:
                  4,

                background:
                  "#fffbe6",

                color:
                  "#8c6d1f",

                fontSize:
                  12,
              }}
            >
              {selectedColumnSet
                ? "The selected DataTable preset does not contain any columns."
                : "No DataTable preset is selected. Select a preset from the App toolbar."}
            </div>
          )}

          <div
            style={{
              marginLeft: 10,
              maxHeight: 600,
              overflow: "auto",
              border: "1px solid #f0f0f0",
              borderRadius: 4,
              background: "#fff",
            }}
          >
            <table
              style={{
                width:
                  [
                    "drag",
                    "index",
                    ...visiblePropertyKeys,
                    "date",
                    "endDate",
                    "actions",
                  ].reduce(
                    (
                      total,
                      key,
                    ) =>
                      total +
                      Number(
                        columnWidths[
                          key
                        ] ||
                        visibleProperties.find(
                          (column) =>
                            column.field ===
                            key,
                        )?.minWidth ||
                        AUTO_FIT_MIN_WIDTH,
                      ),
                    0,
                  ),

                minWidth:
                  "100%",

                borderCollapse:
                  "collapse",

                tableLayout:
                  "fixed",

                fontSize:
                  12,
              }}
            >
              <colgroup>
                <col
                  style={{
                    width:
                      columnWidths.drag,
                  }}
                />

                <col
                  style={{
                    width:
                      columnWidths.index,
                  }}
                />

                {visibleProperties.map(
                  (property) => (
                    <col
                      key={
                        property.field
                      }
                      style={{
                        width:
                          columnWidths[
                            property.field
                          ] ||
                          AUTO_FIT_MIN_WIDTH,
                      }}
                    />
                  ),
                )}

                <col
                  style={{
                    width:
                      columnWidths.date,
                  }}
                />

                <col
                  style={{
                    width:
                      columnWidths.endDate,
                  }}
                />

                <col
                  style={{
                    width:
                      columnWidths.actions,
                  }}
                />
              </colgroup>

              <thead>
                <tr
                  style={{
                    position:
                      "sticky",

                    top:
                      0,

                    zIndex:
                      2,

                    background:
                      "#fafafa",
                  }}
                >
                  <ResizableHeaderCell
                    columnKey="drag"
                    width={
                      columnWidths.drag
                    }
                    minWidth={
                      MIN_COLUMN_WIDTHS.drag
                    }
                    align="center"
                    onResize={
                      handleColumnResize
                    }
                    onAutoFit={
                      handleAutoFitColumn
                    }
                  >
                    &nbsp;
                  </ResizableHeaderCell>

                  <ResizableHeaderCell
                    columnKey="index"
                    width={
                      columnWidths.index
                    }
                    minWidth={
                      MIN_COLUMN_WIDTHS.index
                    }
                    onResize={
                      handleColumnResize
                    }
                    onAutoFit={
                      handleAutoFitColumn
                    }
                  >
                    No.
                  </ResizableHeaderCell>

                  {visibleProperties.map(
                    (property) => (
                      <ResizableHeaderCell
                        key={
                          property.field
                        }
                        columnKey={
                          property.field
                        }
                        width={
                          columnWidths[
                            property.field
                          ]
                        }
                        minWidth={
                          property.minWidth ||
                          70
                        }
                        align={
                          property.align ||
                          "left"
                        }
                        onResize={
                          handleColumnResize
                        }
                        onAutoFit={
                          handleAutoFitColumn
                        }
                      >
                        {getColumnHeaderLabel(
                          property,
                          psetMetadataRevision,
                        )}
                      </ResizableHeaderCell>
                    ),
                  )}

                  <ResizableHeaderCell
                    columnKey="date"
                    width={
                      columnWidths.date
                    }
                    minWidth={
                      MIN_COLUMN_WIDTHS.date
                    }
                    align="center"
                    onResize={
                      handleColumnResize
                    }
                    onAutoFit={
                      handleAutoFitColumn
                    }
                  >
                    Start Date
                  </ResizableHeaderCell>

                  <ResizableHeaderCell
                    columnKey="endDate"
                    width={columnWidths.endDate}
                    minWidth={MIN_COLUMN_WIDTHS.endDate}
                    align="center"
                    onResize={handleColumnResize}
                    onAutoFit={handleAutoFitColumn}
                  >
                    End Date
                  </ResizableHeaderCell>

                  <ResizableHeaderCell
                    columnKey="actions"
                    width={
                      columnWidths.actions
                    }
                    minWidth={
                      MIN_COLUMN_WIDTHS.actions
                    }
                    align="center"
                    onResize={
                      handleColumnResize
                    }
                    onAutoFit={
                      handleAutoFitColumn
                    }
                  >
                  </ResizableHeaderCell>
                </tr>
              </thead>

              <tbody>
                {hydratedVisibleObjects.map((item) => (
                  <SortableSubItem
                    key={getObjectKey(item)}
                    item={item}
                    isOwner={isOwner}
                    displayIndex={displayIndexMap?.get(getObjectKey(item)) || 1}
                    selectedIds={selectedIds}
                    setSelectedIds={setSelectedIds}
                    lastSelected={lastSelected}
                    setLastSelected={setLastSelected}
                    setFocusedIndex={setFocusedIndex}
                    currentObjects={hydratedVisibleObjects}
                    icon={<FileOutlined />}
                    onAssignDate={handleAssignDate}
                    onDelete={handleDelete}
                    onDeleteMulti={handleDeleteMulti}
                    onAddCamera={handleAddCamera}
                    onChangeCamera={handleChangeCamera}
                    onDeleteCamera={handleDeleteCamera}
                    onZoomIn={handleZoomToSelected}
                    onOpenMoveModal={handleOpenMoveModal}
                    selectObjectsInViewer={selectObjectsInViewer}
                    setActiveItem={setActiveItem}
                    listRef={listRef}
                    visibleProperties={visibleProperties}
                    projectFormatting={projectFormatting}
                    nodeMode={nodeMode}
                  />
                ))}
              </tbody>
            </table>

            {(loading || loadingDataTableValues) && (
              <div
                style={{
                  padding: 8,
                  textAlign: "center",
                  color: "#8c8c8c",
                }}
              >
                {loadingDataTableValues
                  ? "Loading DataTable values..."
                  : "Loading..."}
              </div>
            )}
          </div>
        </div>
      </SortableContext>
      </DndContext>

      <Modal
        title="Move Sequence Objects"
        open={moveModalOpen}
        onCancel={handleCloseMoveModal}
        onOk={handleConfirmMoveToSubPlan}
        okText="Move"
        cancelText="Cancel"
        okButtonProps={{
          disabled: !moveTargetSubPlanId,
        }}
        destroyOnHidden
      >
        <div style={{ marginBottom: 12 }}>
          {moveTriggerItem &&
          selectedIds.some(
            (item) =>
              getObjectKey(item) === getObjectKey(moveTriggerItem),
          )
            ? `${selectedIds.length} selected object(s) will be moved.`
            : "1 object will be moved."}
        </div>

        <div
          style={{
            border:
              "1px solid #d9d9d9",

            borderRadius:
              6,

            maxHeight:
              320,

            overflowY:
              "auto",

            padding:
              "6px 4px",

            background:
              "#fff",
          }}
        >
          <Tree
            treeData={
              moveSubPlanTreeData
            }

            /*
             * Plans are collapsed when the Modal opens.
             * User expands only the Plan they want.
             */
            defaultExpandAll={
              false
            }

            /*
             * Clicking a Plan title does not select it.
             * Only SubPlans are selectable.
             */
            selectedKeys={
              moveTargetSubPlanId
                ? [
                    `${nodeMode ? "node" : "subplan"}-${moveTargetSubPlanId}`,
                  ]
                : []
            }

            onSelect={(
              selectedKeys,
              info,
            ) => {
              const node =
                info?.node;

              if (nodeMode) {
                if (!node?.isNode) return;
                setMoveTargetSubPlanId(String(node.nodeId));
                return;
              }

              if (!node?.isSubPlan) return;

              setMoveTargetSubPlanId(String(node.subPlanId));
            }}

            blockNode

            showLine={
              false
            }

            style={{
              background:
                "transparent",
            }}
          />
        </div>
      </Modal>
    </>
  );
};

export default SequenceObjectCollapse;
