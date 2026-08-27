import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import * as WorkspaceAPI
  from "trimble-connect-workspace-api";

import {
  convertMassFromKg,
  getDisplayLengthUnit,
  getDisplayMassUnit,
} from "../utils/projectFormatting";

const SequenceColumnConfigContext =
  createContext(null);

const PRESET_STORAGE_PREFIX =
  "sequencePlanner.dataTablePreset";

const chooseDefaultPresetName = (
  columnSets,
) => {
  if (
    !Array.isArray(
      columnSets,
    ) ||
    columnSets.length === 0
  ) {
    return "";
  }

  const presetWithColumns =
    columnSets.find(
      (columnSet) =>
        Array.isArray(
          columnSet?.columns,
        ) &&
        columnSet.columns.length > 0,
    );

  return String(
    presetWithColumns?.name ||
      columnSets[0]?.name ||
      "",
  );
};

const DEFAULT_COLUMN_WIDTH = 130;
const DEFAULT_MIN_WIDTH = 70;

const normalizeColumn = (
  column,
) => {
  if (
    !column?.field
  ) {
    return null;
  }

  const field =
    String(
      column.field,
    );

  return {
    field,

    key:
      field,

    label:
      column.label ||
      field,

    grouped:
      column.grouped ===
      true,

    aggregated:
      column.aggregated ===
      true,

    sortDirection:
      column.sortDirection ||
      null,

    width:
      DEFAULT_COLUMN_WIDTH,

    minWidth:
      DEFAULT_MIN_WIDTH,

    align:
      "left",
  };
};

const normalizeColumnSet = (
  columnSet,
) => {
  if (
    !columnSet ||
    !columnSet.name
  ) {
    return null;
  }

  return {
    ...columnSet,

    name:
      String(
        columnSet.name,
      ),

    columns:
      (
        Array.isArray(
          columnSet.columns,
        )
          ? columnSet.columns
          : []
      )
        .map(
          normalizeColumn,
        )
        .filter(Boolean),
  };
};

const normalizeUnit = (
  value,
) =>
  String(value || "")
    .trim()
    .toLowerCase();

const roundByDecimals = (
  value,
  decimals = 2,
) => {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue,
    )
  ) {
    return value;
  }

  const safeDecimals =
    Math.max(
      0,
      Number(
        decimals,
      ) || 0,
    );

  const factor =
    10 ** safeDecimals;

  return (
    Math.round(
      numericValue *
        factor,
    ) /
    factor
  );
};

const convertLengthFromMm = (
  value,
  projectFormatting,
) => {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue,
    )
  ) {
    return value;
  }

  const unit =
    normalizeUnit(
      getDisplayLengthUnit(
        projectFormatting,
      ) ||
        projectFormatting
          ?.lengthUnit ||
        "mm",
    );

  let result =
    numericValue;

  switch (unit) {
    case "mm":
      result =
        numericValue;
      break;

    case "cm":
      result =
        numericValue /
        10;
      break;

    case "m":
      result =
        numericValue /
        1000;
      break;

    case "km":
      result =
        numericValue /
        1_000_000;
      break;

    case "in":
      result =
        numericValue /
        25.4;
      break;

    case "ft":
      result =
        numericValue /
        304.8;
      break;

    case "yd":
      result =
        numericValue /
        914.4;
      break;

    case "mi":
      result =
        numericValue /
        1_609_344;
      break;

    default:
      result =
        numericValue;
      break;
  }

  return roundByDecimals(
    result,
    projectFormatting
      ?.lengthDecimals ??
      2,
  );
};

const convertAreaFromMm2 = (
  value,
  projectFormatting,
) => {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue,
    )
  ) {
    return value;
  }

  const unit =
    normalizeUnit(
      getDisplayLengthUnit(
        projectFormatting,
      ) ||
        projectFormatting
          ?.lengthUnit ||
        "mm",
    );

  const lengthFactor = {
    mm: 1,
    cm: 10,
    m: 1000,
    km: 1_000_000,
    in: 25.4,
    ft: 304.8,
    yd: 914.4,
    mi: 1_609_344,
  }[unit] || 1;

  const result =
    numericValue /
    (
      lengthFactor *
      lengthFactor
    );

  return roundByDecimals(
    result,
    projectFormatting
      ?.areaDecimals ??
      projectFormatting
        ?.lengthDecimals ??
      2,
  );
};

const convertVolumeFromMm3 = (
  value,
  projectFormatting,
) => {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue,
    )
  ) {
    return value;
  }

  const unit =
    normalizeUnit(
      getDisplayLengthUnit(
        projectFormatting,
      ) ||
        projectFormatting
          ?.lengthUnit ||
        "mm",
    );

  const lengthFactor = {
    mm: 1,
    cm: 10,
    m: 1000,
    km: 1_000_000,
    in: 25.4,
    ft: 304.8,
    yd: 914.4,
    mi: 1_609_344,
  }[unit] || 1;

  const result =
    numericValue /
    (
      lengthFactor *
      lengthFactor *
      lengthFactor
    );

  return roundByDecimals(
    result,
    projectFormatting
      ?.volumeDecimals ??
      projectFormatting
        ?.lengthDecimals ??
      2,
  );
};

const getAreaUnit = (
  projectFormatting,
) =>
  `${
    getDisplayLengthUnit(
      projectFormatting,
    ) || "mm"
  }²`;

const getVolumeUnit = (
  projectFormatting,
) =>
  `${
    getDisplayLengthUnit(
      projectFormatting,
    ) || "mm"
  }³`;

export const getSequenceColumnValue = (
  item,
  column,
  {
    projectFormatting,
  } = {},
) => {
  if (
    !item ||
    !column?.field
  ) {
    return "";
  }

  const field =
    String(
      column.field,
    );

  const rawValue =
    item?.dataTableValues?.[
      field
    ];

  if (
    rawValue == null ||
    rawValue === ""
  ) {
    return "";
  }

  /*
   * Non-numeric values are returned as-is.
   */
  if (
    !Number.isFinite(
      Number(rawValue),
    )
  ) {
    return rawValue;
  }

  const numericValue =
    Number(rawValue);

  const normalizedField =
    field
      .trim()
      .toUpperCase();

  /*
   * Weight / Mass
   */
  if (
    normalizedField.includes(
      "WEIGHT",
    ) ||
    normalizedField.includes(
      "MASS",
    )
  ) {
    const converted =
      convertMassFromKg(
        numericValue,
        projectFormatting,
      );

    if (
      converted == null
    ) {
      return rawValue;
    }

    const unit =
      getDisplayMassUnit(
        projectFormatting,
      );

    return `${converted} ${unit}`;
  }

  /*
   * Area
   *
   * Raw model quantity is assumed to be mm².
   */
  if (
    normalizedField.includes(
      "AREA",
    )
  ) {
    const converted =
      convertAreaFromMm2(
        numericValue,
        projectFormatting,
      );

    return `${converted} ${getAreaUnit(
      projectFormatting,
    )}`;
  }

  /*
   * Volume
   *
   * Raw model quantity is assumed to be mm³.
   */
  if (
    normalizedField.includes(
      "VOLUME",
    )
  ) {
    const converted =
      convertVolumeFromMm3(
        numericValue,
        projectFormatting,
      );

    return `${converted} ${getVolumeUnit(
      projectFormatting,
    )}`;
  }

  /*
   * Length-like quantities.
   *
   * Raw model quantity is assumed to be mm.
   */
  if (
    normalizedField.includes(
      "LENGTH",
    ) ||
    normalizedField.includes(
      "HEIGHT",
    ) ||
    normalizedField.includes(
      "WIDTH",
    ) ||
    normalizedField.includes(
      "DEPTH",
    ) ||
    normalizedField.includes(
      "PERIMETER",
    )
  ) {
    const converted =
      convertLengthFromMm(
        numericValue,
        projectFormatting,
      );

    const unit =
      getDisplayLengthUnit(
        projectFormatting,
      );

    return `${converted} ${unit}`;
  }

  /*
   * Other numeric DataTable values remain unchanged.
   */
  return rawValue;
};

/*
 * Resolve the Property Set API region from Trimble project.location.
 *
 * Project regions:
 * - North America -> us-east-1
 * - Europe        -> eu-west-1
 * - Asia          -> ap-southeast-1
 * - Australia     -> ap-southeast-2
 *
 * UK projects use the Europe Property Set region.
 */
export const getOrgApiUrl = (
  locationValue,
) => {
  const location =
    String(
      locationValue || "",
    )
      .trim()
      .toUpperCase();

  if (
    location.includes(
      "AUSTRALIA",
    )
  ) {
    return "https://org-api.ap-southeast-2.connect.trimble.com/v1";
  }

  if (
    location.includes(
      "ASIA",
    )
  ) {
    return "https://org-api.ap-southeast-1.connect.trimble.com/v1";
  }

  if (
    location.includes(
      "EUROPE",
    ) ||
    location === "EU" ||
    location.includes(
      "EUROPEAN",
    ) ||
    location.includes(
      "UNITED KINGDOM",
    ) ||
    location === "UK"
  ) {
    return "https://org-api.eu-west-1.connect.trimble.com/v1";
  }

  return "https://org-api.us-east-1.connect.trimble.com/v1";
};

export const getPsetApiUrl = (
  locationValue,
) => {
  const location =
    String(
      locationValue ||
        "",
    )
      .trim()
      .toUpperCase();

  if (
    location.includes(
      "AUSTRALIA",
    )
  ) {
    return "https://pset-api.ap-southeast-2.connect.trimble.com/v1";
  }

  if (
    location.includes(
      "ASIA",
    )
  ) {
    return "https://pset-api.ap-southeast-1.connect.trimble.com/v1";
  }

  if (
    location.includes(
      "EUROPE",
    ) ||
    location === "EU" ||
    location.includes(
      "EUROPEAN",
    ) ||
    location.includes(
      "UNITED KINGDOM",
    ) ||
    location === "UK"
  ) {
    return "https://pset-api.eu-west-1.connect.trimble.com/v1";
  }

  /*
   * Default to North America.
   */
  return "https://pset-api.us-east-1.connect.trimble.com/v1";
};

export const SequenceColumnConfigProvider = ({
  projectId = "",
  projectLocation = "",
  children,
}) => {
  const [
    allColumns,
    setAllColumns,
  ] = useState([]);

  const [
    columnSets,
    setColumnSets,
  ] = useState([]);

  const [
    selectedPresetName,
    setSelectedPresetNameState,
  ] = useState("");

  const [
    loadingColumns,
    setLoadingColumns,
  ] = useState(false);

  const [
    columnsError,
    setColumnsError,
  ] = useState("");

  const presetStorageKey =
    useMemo(
      () =>
        `${PRESET_STORAGE_PREFIX}.${
          projectId || "global"
        }`,
      [
        projectId,
      ],
    );


  const psetApiUrl =
    useMemo(
      () =>
        getPsetApiUrl(
          projectLocation,
        ),
      [
        projectLocation,
      ],
    );

  const orgApiUrl =
    useMemo(
      () =>
        getOrgApiUrl(
          projectLocation,
        ),
      [
        projectLocation,
      ],
    );

  const persistPreset =
    useCallback(
      (presetName) => {
        try {
          if (presetName) {
            window.localStorage.setItem(
              presetStorageKey,
              presetName,
            );
          } else {
            window.localStorage.removeItem(
              presetStorageKey,
            );
          }
        } catch (
          error
        ) {
          console.warn(
            "Unable to save DataTable preset:",
            error,
          );
        }
      },
      [
        presetStorageKey,
      ],
    );

  const loadColumns =
    useCallback(
      async () => {
        setLoadingColumns(
          true,
        );

        setColumnsError(
          "",
        );

        try {
          const tcapi =
            await WorkspaceAPI.connect(
              window.parent,
            );

          /*
           * getAllColumns:
           *   all columns/properties available to Trimble DataTable.
           *
           * getColumnSets:
           *   all saved DataTable presets ("Save as config").
           */
          const [
            allColumnResponse,
            columnSetResponse,
          ] =
            await Promise.all([
              tcapi.dataTable
                .getAllColumns(),

              tcapi.dataTable
                .getColumnSets(),
            ]);

          const normalizedColumns =
            (
              Array.isArray(
                allColumnResponse,
              )
                ? allColumnResponse
                : []
            )
              .map(
                normalizeColumn,
              )
              .filter(Boolean);

          const normalizedColumnSets =
            (
              Array.isArray(
                columnSetResponse,
              )
                ? columnSetResponse
                : []
            )
              .map(
                normalizeColumnSet,
              )
              .filter(Boolean);

          setAllColumns(
            normalizedColumns,
          );

          setColumnSets(
            normalizedColumnSets,
          );

          let storedPresetName =
            "";

          try {
            storedPresetName =
              String(
                window.localStorage.getItem(
                  presetStorageKey,
                ) ||
                  "",
              );
          } catch (
            storageError
          ) {
            console.warn(
              "Unable to read DataTable preset:",
              storageError,
            );
          }

          const storedPresetExists =
            storedPresetName &&
            normalizedColumnSets.some(
              (columnSet) =>
                columnSet.name ===
                storedPresetName,
            );

          const nextPresetName =
            storedPresetExists
              ? storedPresetName
              : chooseDefaultPresetName(
                  normalizedColumnSets,
                );

          setSelectedPresetNameState(
            nextPresetName,
          );

          persistPreset(
            nextPresetName,
          );
        } catch (
          error
        ) {
          console.error(
            "Load Trimble DataTable presets failed:",
            error,
          );

          setColumnsError(
            error?.message ||
              "Unable to load Trimble DataTable presets.",
          );

          setAllColumns(
            [],
          );

          setColumnSets(
            [],
          );

          setSelectedPresetNameState(
            "",
          );
        } finally {
          setLoadingColumns(
            false,
          );
        }
      },
      [
        persistPreset,
        presetStorageKey,
      ],
    );

  useEffect(
    () => {
      loadColumns();
    },
    [
      loadColumns,
    ],
  );

  const selectedColumnSet =
    useMemo(
      () => {
        if (
          !selectedPresetName
        ) {
          return null;
        }

        return (
          columnSets.find(
            (columnSet) =>
              columnSet.name ===
              selectedPresetName,
          ) ||
          null
        );
      },
      [
        columnSets,
        selectedPresetName,
      ],
    );

  const HIDDEN_COLUMN_FIELDS =
    useMemo(
      () =>
        new Set([
          "name",
          "entity_class",
        ]),
      [],
    );

  const selectedColumns =
    useMemo(
      () =>
        (
          selectedColumnSet?.columns ||
          []
        ).filter(
          (column) => {
            const field =
              String(
                column?.field ||
                  "",
              )
                .trim()
                .toLowerCase();

            return (
              !HIDDEN_COLUMN_FIELDS.has(
                field,
              )
            );
          },
        ),
      [
        selectedColumnSet,
        HIDDEN_COLUMN_FIELDS,
      ],
    );

  const selectedFields =
    useMemo(
      () =>
        selectedColumns
          .map(
            (column) =>
              column?.field,
          )
          .filter(Boolean),
      [
        selectedColumns,
      ],
    );

  const setSelectedPresetName =
    useCallback(
      (presetName) => {
        const normalizedName =
          String(
            presetName ||
              "",
          );

        /*
         * Only accept presets returned from Trimble Connect.
         */
        if (
          normalizedName &&
          !columnSets.some(
            (columnSet) =>
              columnSet.name ===
              normalizedName,
          )
        ) {
          return;
        }

        setSelectedPresetNameState(
          normalizedName,
        );

        persistPreset(
          normalizedName,
        );
      },
      [
        columnSets,
        persistPreset,
      ],
    );

  const [psetReloadRevision, setPsetReloadRevision] = useState(0);

  const reloadPsetValues = useCallback(() => {
    setPsetReloadRevision((value) => value + 1);
  }, []);

  const value =
    useMemo(
      () => ({
        allColumns,

        columnSets,

        projectId,

        projectLocation,

        psetApiUrl,

        orgApiUrl,

        psetReloadRevision,
        reloadPsetValues,

        selectedPresetName,

        selectedColumnSet,

        selectedColumns,

        selectedFields,

        loadingColumns,

        columnsError,

        setSelectedPresetName,

        refreshColumns:
          loadColumns,
      }),
      [
        allColumns,
        columnSets,
        projectId,
        projectLocation,
        psetApiUrl,
        orgApiUrl,
        psetReloadRevision,
        reloadPsetValues,
        selectedPresetName,
        selectedColumnSet,
        selectedColumns,
        selectedFields,
        loadingColumns,
        columnsError,
        setSelectedPresetName,
        loadColumns,
      ],
    );

  return (
    <SequenceColumnConfigContext.Provider
      value={
        value
      }
    >
      {children}
    </SequenceColumnConfigContext.Provider>
  );
};

export const useSequenceColumnConfig =
  () => {
    const context =
      useContext(
        SequenceColumnConfigContext,
      );

    if (!context) {
      throw new Error(
        "useSequenceColumnConfig must be used inside SequenceColumnConfigProvider.",
      );
    }

    return context;
  };
