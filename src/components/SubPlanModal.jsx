import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
  ColorPicker,
  DatePicker,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
} from "antd";

import { ReloadOutlined } from "@ant-design/icons";

import dayjs from "dayjs";

import { useDispatch, useSelector } from "react-redux";

import * as WorkspaceAPI from "trimble-connect-workspace-api";

import {
  CreateSubPlanRequest,
  UpdateSubPlanRequest,
} from "../store/sequence/action";

/* -------------------------------------------------------------------------- */
/* CONSTANTS                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_COLOR = {
  r: 248,
  g: 28,
  b: 234,
};

const CREATE_MODE = {
  MANUAL: "manual",
  SERIAL: "serial",
  DATES: "dates",
  PROPERTY: "property",
  LAYERS: "layers",
};

const CREATE_MODE_OPTIONS = [
  {
    value: CREATE_MODE.MANUAL,
    label: "Manual Names",
  },
  {
    value: CREATE_MODE.SERIAL,
    label: "Serial Numbers",
  },
  {
    value: CREATE_MODE.DATES,
    label: "Dates",
  },
  {
    value: CREATE_MODE.PROPERTY,
    label: "Property",
  },
  {
    value: CREATE_MODE.LAYERS,
    label: "Layers",
  },
];

const PROPERTY_BATCH_SIZE = 300;

const DEFAULT_COUNTRY_CODE = "AU";

/*
 * Nager.Date
 */
const NAGER_COUNTRIES_URL = "https://date.nager.at/api/v3/AvailableCountries";

const getNagerHolidayUrl = (countryCode, year) =>
  `https://date.nager.at/api/v4/Holidays/${countryCode}/${year}`;

/* -------------------------------------------------------------------------- */
/* COLOR                                                                      */
/* -------------------------------------------------------------------------- */

const clampColorValue = (value) =>
  Math.max(0, Math.min(255, Number(value) || 0));

const normalizeColor = (value, fallback = DEFAULT_COLOR) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const rgbMatch = trimmed.match(
      /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)$/i,
    );
    if (rgbMatch) {
      return {
        r: clampColorValue(rgbMatch[1]),
        g: clampColorValue(rgbMatch[2]),
        b: clampColorValue(rgbMatch[3]),
      };
    }

    const hex = trimmed.replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  }

  const source = value?.rgb ?? value ?? fallback;

  return {
    r: clampColorValue(source?.r ?? fallback.r),

    g: clampColorValue(source?.g ?? fallback.g),

    b: clampColorValue(source?.b ?? fallback.b),
  };
};

const hslToRgb = (hue, saturation = 72, lightness = 58) => {
  const h = ((Number(hue) % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, Number(saturation))) / 100;
  const l = Math.max(0, Math.min(100, Number(lightness))) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = h / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  let rgb = [0, 0, 0];
  if (section < 1) rgb = [chroma, x, 0];
  else if (section < 2) rgb = [x, chroma, 0];
  else if (section < 3) rgb = [0, chroma, x];
  else if (section < 4) rgb = [0, x, chroma];
  else if (section < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const match = l - chroma / 2;
  return {
    r: Math.round((rgb[0] + match) * 255),
    g: Math.round((rgb[1] + match) * 255),
    b: Math.round((rgb[2] + match) * 255),
  };
};

const buildDistinctColors = (count, selectedColor) => {
  const quantity = Math.max(0, Number(count) || 0);
  const normalizedSelectedColor = normalizeColor(selectedColor);
  return Array.from({ length: quantity }, (_, index) =>
    index === 0
      ? normalizedSelectedColor
      : hslToRgb((index * 137.508 + 18) % 360),
  );
};

/* -------------------------------------------------------------------------- */
/* SERIAL                                                                     */
/* -------------------------------------------------------------------------- */

const buildSerialNames = ({ prefix, start, quantity }) => {
  const cleanPrefix = String(prefix || "").trim();

  const startNumber = Number(start);

  const qty = Number(quantity);

  if (!cleanPrefix) {
    return [];
  }

  if (!Number.isInteger(startNumber) || !Number.isInteger(qty)) {
    return [];
  }

  if (qty <= 0) {
    return [];
  }

  const result = [];

  for (let index = 0; index < qty; index += 1) {
    result.push(`${cleanPrefix} ${startNumber + index}`);
  }

  return result;
};

/* -------------------------------------------------------------------------- */
/* COUNTRY                                                                    */
/* -------------------------------------------------------------------------- */

const normalizeCountryOptions = (countries) => {
  if (!Array.isArray(countries)) {
    return [];
  }

  return countries
    .map((country) => {
      /*
       * Nager v3:
       *
       * {
       *   countryCode: "AU",
       *   name: "Australia"
       * }
       */
      const code = String(country?.countryCode ?? country?.code ?? "")
        .trim()
        .toUpperCase();

      const name = String(country?.name ?? country?.commonName ?? code).trim();

      if (!code || !name) {
        return null;
      }

      return {
        value: code,
        label: name,
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, {
        sensitivity: "base",
      }),
    );
};

const fetchCountryOptions = async () => {
  const response = await fetch(NAGER_COUNTRIES_URL);

  if (!response.ok) {
    throw new Error(`Unable to load countries: ${response.status}`);
  }

  const data = await response.json();

  return normalizeCountryOptions(data);
};

/* -------------------------------------------------------------------------- */
/* PUBLIC HOLIDAYS                                                            */
/* -------------------------------------------------------------------------- */

const getYearsInRange = (startDate, endDate) => {
  if (!startDate || !endDate) {
    return [];
  }

  const start = dayjs(startDate);

  const end = dayjs(endDate);

  if (!start.isValid() || !end.isValid() || start.isAfter(end, "day")) {
    return [];
  }

  const years = [];

  for (let year = start.year(); year <= end.year(); year += 1) {
    years.push(year);
  }

  return years;
};

const fetchPublicHolidayDates = async ({ countryCode, startDate, endDate }) => {
  const code = String(countryCode || "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z]{2}$/.test(code)) {
    throw new Error("Invalid country code.");
  }

  const years = getYearsInRange(startDate, endDate);

  const result = new Set();

  for (const year of years) {
    const response = await fetch(getNagerHolidayUrl(code, year));

    if (!response.ok) {
      throw new Error(`Unable to load public holidays for ${code} ${year}.`);
    }

    const holidays = await response.json();

    for (const holiday of holidays || []) {
      if (!holiday?.date) {
        continue;
      }

      /*
       * Nager v4:
       *
       * holidayTypes:
       * [
       *   "Public"
       * ]
       */
      const types = Array.isArray(holiday?.holidayTypes)
        ? holiday.holidayTypes
        : [];

      const isPublic = types.length === 0 || types.includes("Public");

      /*
       * Chỉ national holiday.
       *
       * State / subdivision holidays
       * có thể thêm ở bước sau.
       */
      const isNational = holiday?.nationalHoliday !== false;

      if (isPublic && isNational) {
        result.add(String(holiday.date));
      }
    }
  }

  return result;
};

/* -------------------------------------------------------------------------- */
/* WORKING DATES                                                              */
/* -------------------------------------------------------------------------- */

const buildWorkingDateNames = ({
  startDate,
  endDate,
  publicHolidayDates = new Set(),
}) => {
  if (!startDate || !endDate) {
    return [];
  }

  const start = dayjs(startDate).startOf("day");

  const end = dayjs(endDate).startOf("day");

  if (!start.isValid() || !end.isValid() || start.isAfter(end, "day")) {
    return [];
  }

  const result = [];

  let current = start;

  while (current.isBefore(end, "day") || current.isSame(end, "day")) {
    const dayOfWeek = current.day();

    /*
     * Sunday = 0
     * Saturday = 6
     */
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const isoDate = current.format("YYYY-MM-DD");

    const isHoliday = publicHolidayDates.has(isoDate);

    if (!isWeekend && !isHoliday) {
      result.push(current.format("DD-MM-YYYY"));
    }

    current = current.add(1, "day");
  }

  return result;
};

/* -------------------------------------------------------------------------- */
/* PROPERTY HELPERS                                                           */
/* -------------------------------------------------------------------------- */

const getPropertySets = (objectProperty) => {
  if (Array.isArray(objectProperty?.properties)) {
    return objectProperty.properties;
  }

  if (Array.isArray(objectProperty?.propertySets)) {
    return objectProperty.propertySets;
  }

  return [];
};

const getPropertiesFromSet = (propertySet) => {
  if (Array.isArray(propertySet?.properties)) {
    return propertySet.properties;
  }

  if (Array.isArray(propertySet?.values)) {
    return propertySet.values;
  }

  return [];
};

const getDataTablePropertyValue = (objectProperty, columnField) => {
  const field = String(columnField || "").trim();
  if (!field) return null;
  if (field.toLowerCase() === "name") {
    return objectProperty?.name ?? objectProperty?.product?.name ?? null;
  }
  if (field.toLowerCase() === "entity_class") {
    return objectProperty?.class ?? null;
  }

  const separatorIndex = field.indexOf("+");
  const expectedGroup =
    separatorIndex >= 0 ? field.slice(0, separatorIndex).trim() : "";
  const expectedProperty =
    separatorIndex >= 0 ? field.slice(separatorIndex + 1).trim() : field;

  for (const propertySet of getPropertySets(objectProperty)) {
    const groupName = String(
      propertySet?.name ?? propertySet?.groupName ?? "",
    ).trim();
    if (
      expectedGroup &&
      groupName.localeCompare(expectedGroup, undefined, {
        sensitivity: "base",
      }) !== 0
    ) {
      continue;
    }

    for (const property of getPropertiesFromSet(propertySet)) {
      const propertyName = String(property?.name ?? "").trim();
      if (
        propertyName.localeCompare(expectedProperty, undefined, {
          sensitivity: "base",
        }) !== 0
      ) {
        continue;
      }
      return (
        property?.value ??
        property?.formattedValue ??
        property?.displayValue ??
        null
      );
    }
  }
  return null;
};

/* -------------------------------------------------------------------------- */
/* COMPONENT                                                                  */
/* -------------------------------------------------------------------------- */

const SubPlanModal = ({
  title,
  buttonName,
  plan,
  subPlan = null,
  open,
  onCancel,
  isEditing = false,
  // V2 generic-node mode. When supplied, the modal keeps all existing
  // creation modes but delegates persistence to the caller instead of V1 Saga.
  nodeMode = false,
  projectIdOverride = null,
  pendingOverride = null,
  onCreateOverride = null,
  onUpdateOverride = null,
  entityLabel = "Sub Plan",
}) => {
  const dispatch = useDispatch();

  const [form] = Form.useForm();

  const reduxProjectId = useSelector((state) => state.sequence.projectId || "");

  const projectId = projectIdOverride || reduxProjectId;

  const reduxPending = useSelector((state) => state.sequence.pending);

  const pending = pendingOverride ?? reduxPending;

  const [color, setColor] = useState({
    ...DEFAULT_COLOR,
  });

  const [useColor, setUseColor] = useState(false);

  const [createMode, setCreateMode] = useState(CREATE_MODE.MANUAL);

  /*
   * Countries.
   */
  const [countryOptions, setCountryOptions] = useState([]);

  const [loadingCountries, setLoadingCountries] = useState(false);

  /*
   * Holidays.
   */
  const [publicHolidayDates, setPublicHolidayDates] = useState(new Set());

  const [loadingPublicHolidays, setLoadingPublicHolidays] = useState(false);

  const [publicHolidayError, setPublicHolidayError] = useState("");

  const [propertyColumns, setPropertyColumns] = useState([]);

  const [propertyValues, setPropertyValues] = useState([]);

  const [loadingPropertyColumns, setLoadingPropertyColumns] = useState(false);

  const [loadingPropertyValues, setLoadingPropertyValues] = useState(false);

  const [layerOptions, setLayerOptions] = useState([]);

  const [loadingLayers, setLoadingLayers] = useState(false);

  const editingSubPlan = subPlan || (isEditing ? plan : null);

  const parentPlan = isEditing ? null : plan;

  const modalTitle =
    title || (isEditing ? `Edit ${entityLabel}` : `Create ${entityLabel}`);

  const submitButtonName = buttonName || (isEditing ? "Update" : "Create");

  /* ------------------------------------------------------------------------ */
  /* RESET                                                                    */
  /* ------------------------------------------------------------------------ */

  const resetModal = useCallback(() => {
    form.resetFields();

    setColor({
      ...DEFAULT_COLOR,
    });

    setUseColor(false);

    setCreateMode(CREATE_MODE.MANUAL);

    setPropertyColumns([]);

    setPropertyValues([]);

    setLoadingPropertyColumns(false);

    setLoadingPropertyValues(false);

    setLayerOptions([]);

    setLoadingLayers(false);

    setPublicHolidayDates(new Set());

    setLoadingPublicHolidays(false);

    setPublicHolidayError("");
  }, [form]);

  const handleCancel = useCallback(() => {
    resetModal();

    onCancel?.();
  }, [resetModal, onCancel]);

  /* ------------------------------------------------------------------------ */
  /* COUNTRIES                                                                */
  /* ------------------------------------------------------------------------ */

  const loadCountries = useCallback(async () => {
    if (countryOptions.length) {
      return;
    }

    try {
      setLoadingCountries(true);

      const options = await fetchCountryOptions();

      setCountryOptions(options);
    } catch (error) {
      console.error("Load countries failed:", error);

      message.error(error?.message || "Unable to load country list.");
    } finally {
      setLoadingCountries(false);
    }
  }, [countryOptions.length]);

  /* ------------------------------------------------------------------------ */
  /* PROPERTY                                                                 */
  /* ------------------------------------------------------------------------ */

  const loadPropertyColumns = useCallback(async () => {
    try {
      setLoadingPropertyColumns(true);

      const tcapi = await WorkspaceAPI.connect(window.parent);
      console.log("[CreateByProperty] Workspace API connected", {
        hasDataTable: Boolean(tcapi?.dataTable),
        hasGetAllColumns: typeof tcapi?.dataTable?.getAllColumns === "function",
      });

      if (typeof tcapi?.dataTable?.getAllColumns !== "function") {
        throw new Error(
          "Trimble Data Table is not loaded. Open the Data Table extension and click Reload.",
        );
      }

      let columns = [];
      let lastGetAllColumnsError = null;

      /*
       * getAllColumns() is populated only after the Trimble Data Table client
       * has been loaded. Ask Trimble to show it first, then allow its internal
       * client a short time to initialise before reading the columns.
       */
      try {
        const currentConfig = await tcapi.dataTable.getConfig();

        console.log("[CreateByProperty] DataTable config before loading", {
          currentConfig,
        });

        if (currentConfig?.show !== true) {
          await tcapi.dataTable.setConfig({
            ...currentConfig,
            show: true,
          });

          console.log(
            "[CreateByProperty] Requested Trimble Data Table to be shown",
          );

          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }
      } catch (error) {
        /*
         * Some Workspace contexts reject DataTable calls until the user opens
         * the extension manually. Continue to getAllColumns() so its exact
         * rejection is included in the diagnostic log below.
         */
        console.warn(
          "[CreateByProperty] Unable to initialise Trimble Data Table",
          error,
        );
      }

      /*
       * Trimble documents that DataTable API availability can change at
       * runtime while its internal client is loading. Retry briefly instead
       * of treating the first empty/rejected response as the final result.
       */
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          const response = await tcapi.dataTable.getAllColumns();

          console.log("[CreateByProperty] getAllColumns response", {
            attempt,
            isArray: Array.isArray(response),
            count: Array.isArray(response) ? response.length : 0,
            response,
          });

          if (Array.isArray(response) && response.length) {
            columns = response;
            break;
          }
        } catch (error) {
          lastGetAllColumnsError = error;
          console.warn("[CreateByProperty] getAllColumns failed", {
            attempt,
            error,
          });
        }

        if (attempt < 4) {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
      }

      /*
       * Fallback only supplies columns already present in the current config
       * or stored presets. getAllColumns remains the primary source.
       */
      if (!columns.length) {
        const [configResult, columnSetsResult] = await Promise.allSettled([
          tcapi.dataTable.getConfig(),
          tcapi.dataTable.getColumnSets(),
        ]);

        const currentColumns =
          configResult.status === "fulfilled" &&
          Array.isArray(configResult.value?.columnSet?.columns)
            ? configResult.value.columnSet.columns
            : [];
        const presetColumns =
          columnSetsResult.status === "fulfilled"
            ? (columnSetsResult.value || []).flatMap((columnSet) =>
                Array.isArray(columnSet?.columns) ? columnSet.columns : [],
              )
            : [];

        columns = [...currentColumns, ...presetColumns];

        console.warn("[CreateByProperty] getAllColumns returned no columns", {
          lastGetAllColumnsError,
          configResult,
          columnSetsResult,
          fallbackColumnCount: columns.length,
        });
      }

      const uniqueColumns = new Map();

      for (const column of columns || []) {
        const field = String(column?.field || "").trim();
        if (!field || uniqueColumns.has(field)) continue;
        uniqueColumns.set(field, {
          value: field,
          field,
          label: field
        });
      }

      const options = [...uniqueColumns.values()].sort((left, right) =>
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
      setPropertyColumns(options);
      if (!options.length) {
        message.warning(
          "DataTable columns are not available yet. Open the Trimble Data Table or check the current user's permission, then click Reload.",
        );
      }
    } catch (error) {
      console.error("Load DataTable properties failed:", error);
      setPropertyColumns([]);
      message.error(error?.message || "Unable to load DataTable properties.");
    } finally {
      setLoadingPropertyColumns(false);
    }
  }, []);

  const loadPropertyValues = useCallback(
    async (columnField) => {
      const field = String(columnField || "").trim();
      setPropertyValues([]);
      form.setFieldValue("propertyValues", []);
      if (!field) return;

      try {
        setLoadingPropertyValues(true);
        const tcapi = await WorkspaceAPI.connect(window.parent);
        const objectGroups = await tcapi.viewer.getObjects();
        const uniqueValues = new Set();

        const addValue = (rawValue) => {
          if (Array.isArray(rawValue)) {
            rawValue.forEach(addValue);
            return;
          }
          if (rawValue == null) return;
          const value = String(rawValue).trim();
          if (value) uniqueValues.add(value);
        };

        for (const modelGroup of objectGroups || []) {
          const modelId = modelGroup?.modelId;
          if (modelId == null) continue;
          const objects = Array.isArray(modelGroup?.objects)
            ? modelGroup.objects
            : [];
          const runtimeIds = objects
            .map((object) => object?.id ?? object?.runtimeId)
            .filter((id) => id != null);
          if (!runtimeIds.length) continue;
          const uniqueRuntimeIds = [...new Set(runtimeIds)];
          for (
            let startIndex = 0;
            startIndex < uniqueRuntimeIds.length;
            startIndex += PROPERTY_BATCH_SIZE
          ) {
            const batch = uniqueRuntimeIds.slice(
              startIndex,
              startIndex + PROPERTY_BATCH_SIZE,
            );

            const objectProperties = await tcapi.viewer.getObjectProperties(
              modelId,
              batch,
            );
            for (const objectProperty of objectProperties || []) {
              addValue(getDataTablePropertyValue(objectProperty, field));
            }
          }
        }

        const result = [...uniqueValues].sort((left, right) =>
          left.localeCompare(right, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );
        setPropertyValues(result);
        if (!result.length) {
          message.warning("No model values were found for this property.");
        }
      } catch (error) {
        console.error("Load property values failed:", error);
        setPropertyValues([]);
        message.error(error?.message || "Unable to load property values.");
      } finally {
        setLoadingPropertyValues(false);
      }
    },
    [form],
  );

  const loadLayers = useCallback(async () => {
    try {
      setLoadingLayers(true);
      setLayerOptions([]);

      const tcapi = await WorkspaceAPI.connect(window.parent);
      const [objectGroups, models] = await Promise.all([
        tcapi.viewer.getObjects(),
        tcapi.viewer.getModels().catch(() => []),
      ]);
      const modelIds = [
        ...new Set(
          (objectGroups || [])
            .map((group) => group?.modelId)
            .filter((modelId) => modelId != null),
        ),
      ];

      const results = await Promise.allSettled(
        modelIds.map(async (modelId) => ({
          modelId,
          layers: await tcapi.viewer.getLayers(modelId),
        })),
      );
      const options = [];
      const seenKeys = new Set();

      results.forEach((result) => {
        if (result.status !== "fulfilled") return;
        const { modelId, layers } = result.value;
        const model = (models || []).find((item) =>
          [item?.id, item?.modelId, item?.fileId, item?.versionId]
            .filter((value) => value != null)
            .some((value) => String(value) === String(modelId)),
        );
        const modelName =
          model?.name ||
          model?.fileName ||
          model?.displayName ||
          String(modelId);

        (layers || []).forEach((layer, index) => {
          const layerName = String(layer?.name || "").trim();
          if (!layerName) return;
          const key = `${String(modelId)}::${index}::${layerName}`;
          if (seenKeys.has(key)) return;
          seenKeys.add(key);
          options.push({
            value: key,
            label: `${layerName} (${modelName})`,
            layerName,
            subPlanName: `${layerName} (${modelName})`,
            modelName,
          });
        });
      });

      options.sort((left, right) =>
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
      setLayerOptions(options);

      if (!options.length) {
        message.warning("No layers were found in the loaded models.");
      }
    } catch (error) {
      console.error("Load Layers failed:", error);
      setLayerOptions([]);
      message.error(error?.message || "Unable to retrieve model layers.");
    } finally {
      setLoadingLayers(false);
    }
  }, []);

  /* ------------------------------------------------------------------------ */
  /* OPEN                                                                     */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!open) {
      return;
    }

    if (isEditing && editingSubPlan) {
      form.setFieldsValue({
        planName: editingSubPlan.name || "",
      });

      setColor(normalizeColor(editingSubPlan.color));

      setUseColor(Boolean(editingSubPlan.color));

      return;
    }

    form.resetFields();

    form.setFieldsValue({
      /*
       * Serial.
       */
      serialPrefix: "Lot",

      serialStart: 1,

      serialQuantity: 1,

      /*
       * Dates.
       */
      dateCountryCode: DEFAULT_COUNTRY_CODE,

      startDate: null,

      endDate: null,

      propertyField: null,

      propertyValues: [],

      layerKeys: [],
    });

    setColor({
      ...DEFAULT_COLOR,
    });

    setUseColor(false);

    setCreateMode(CREATE_MODE.MANUAL);

    setPropertyColumns([]);

    setPropertyValues([]);

    setLayerOptions([]);

    setPublicHolidayDates(new Set());

    setPublicHolidayError("");
  }, [open, isEditing, editingSubPlan, form]);

  /* ------------------------------------------------------------------------ */
  /* LOAD MODE DATA                                                           */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!open || isEditing) {
      return;
    }

    if (createMode === CREATE_MODE.PROPERTY) {
      loadPropertyColumns();
    }

    if (createMode === CREATE_MODE.DATES) {
      loadCountries();
    }

    if (createMode === CREATE_MODE.LAYERS) {
      loadLayers();
    }
  }, [
    open,
    isEditing,
    createMode,
    loadPropertyColumns,
    loadCountries,
    loadLayers,
  ]);

  /* ------------------------------------------------------------------------ */
  /* COLOR                                                                    */
  /* ------------------------------------------------------------------------ */

  const handleColorChange = useCallback((value) => {
    const rgb = value?.toRgb?.() ?? value?.metaColor?.toRgb?.() ?? value;

    setColor(normalizeColor(rgb));
  }, []);

  /* ------------------------------------------------------------------------ */
  /* MODE                                                                     */
  /* ------------------------------------------------------------------------ */

  const handleCreateModeChange = useCallback(
    (mode) => {
      setCreateMode(mode);

      if (mode !== CREATE_MODE.PROPERTY) {
        form.setFieldValue("propertyField", null);
        form.setFieldValue("propertyValues", []);
        setPropertyValues([]);
      }

      if (mode !== CREATE_MODE.LAYERS) {
        form.setFieldValue("layerKeys", []);
      }

      setPublicHolidayDates(new Set());

      setPublicHolidayError("");

      form.setFields([
        {
          name: "planName",
          errors: [],
        },

        {
          name: "serialPrefix",
          errors: [],
        },

        {
          name: "serialStart",
          errors: [],
        },

        {
          name: "serialQuantity",
          errors: [],
        },

        {
          name: "dateCountryCode",
          errors: [],
        },

        {
          name: "startDate",
          errors: [],
        },

        {
          name: "endDate",
          errors: [],
        },

        {
          name: "propertyField",
          errors: [],
        },

        {
          name: "propertyValues",
          errors: [],
        },

        {
          name: "layerKeys",
          errors: [],
        },
      ]);
    },
    [form],
  );

  /* ------------------------------------------------------------------------ */
  /* SERIAL WATCH                                                             */
  /* ------------------------------------------------------------------------ */

  const serialPrefix = Form.useWatch("serialPrefix", form);

  const serialStart = Form.useWatch("serialStart", form);

  const serialQuantity = Form.useWatch("serialQuantity", form);

  const selectedPropertyField = Form.useWatch("propertyField", form);

  useEffect(() => {
    if (
      !open ||
      isEditing ||
      createMode !== CREATE_MODE.PROPERTY ||
      !selectedPropertyField
    ) {
      setPropertyValues([]);
      return;
    }

    loadPropertyValues(selectedPropertyField);
  }, [open, isEditing, createMode, selectedPropertyField, loadPropertyValues]);

  const serialPreview = useMemo(() => {
    const names = buildSerialNames({
      prefix: serialPrefix,

      start: serialStart,

      quantity: serialQuantity,
    });

    if (!names.length) {
      return "";
    }

    if (names.length <= 5) {
      return names.join(", ");
    }

    return `${names.slice(0, 4).join(", ")}, ... ${names[names.length - 1]} (${
      names.length
    } Sub Plans)`;
  }, [serialPrefix, serialStart, serialQuantity]);

  /* ------------------------------------------------------------------------ */
  /* DATE WATCH                                                               */
  /* ------------------------------------------------------------------------ */

  const dateCountryCode = Form.useWatch("dateCountryCode", form);

  const selectedStartDate = Form.useWatch("startDate", form);

  const selectedEndDate = Form.useWatch("endDate", form);

  const selectedCountry = useMemo(
    () =>
      countryOptions.find((country) => country.value === dateCountryCode) ||
      null,
    [countryOptions, dateCountryCode],
  );

  /* ------------------------------------------------------------------------ */
  /* PUBLIC HOLIDAYS                                                          */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (
      !open ||
      isEditing ||
      createMode !== CREATE_MODE.DATES ||
      !dateCountryCode ||
      !selectedStartDate ||
      !selectedEndDate
    ) {
      setPublicHolidayDates(new Set());

      return;
    }

    if (dayjs(selectedStartDate).isAfter(dayjs(selectedEndDate), "day")) {
      return;
    }

    let cancelled = false;

    const loadHolidays = async () => {
      try {
        setLoadingPublicHolidays(true);

        setPublicHolidayError("");

        const holidays = await fetchPublicHolidayDates({
          countryCode: dateCountryCode,

          startDate: selectedStartDate,

          endDate: selectedEndDate,
        });

        if (!cancelled) {
          setPublicHolidayDates(holidays);
        }
      } catch (error) {
        console.error("Load public holidays failed:", error);

        if (!cancelled) {
          setPublicHolidayDates(new Set());

          setPublicHolidayError(
            error?.message || "Unable to load public holidays.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingPublicHolidays(false);
        }
      }
    };

    loadHolidays();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    isEditing,
    createMode,
    dateCountryCode,
    selectedStartDate,
    selectedEndDate,
  ]);

  const dateNames = useMemo(
    () =>
      buildWorkingDateNames({
        startDate: selectedStartDate,

        endDate: selectedEndDate,

        publicHolidayDates,
      }),
    [selectedStartDate, selectedEndDate, publicHolidayDates],
  );

  const datePreview = useMemo(() => {
    if (!dateNames.length) {
      return "";
    }

    if (dateNames.length <= 5) {
      return dateNames.join(", ");
    }

    return `${dateNames.slice(0, 4).join(", ")}, ... ${
      dateNames[dateNames.length - 1]
    } (${dateNames.length} working days)`;
  }, [dateNames]);

  /* ------------------------------------------------------------------------ */
  /* BUILD NAMES                                                              */
  /* ------------------------------------------------------------------------ */

  const getCreateNames = useCallback(
    (values) => {
      /*
       * Manual.
       */
      if (createMode === CREATE_MODE.MANUAL) {
        return String(values.planName || "")
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);
      }

      /*
       * Serial.
       */
      if (createMode === CREATE_MODE.SERIAL) {
        return buildSerialNames({
          prefix: values.serialPrefix,

          start: values.serialStart,

          quantity: values.serialQuantity,
        });
      }

      /*
       * Dates.
       */
      if (createMode === CREATE_MODE.DATES) {
        return buildWorkingDateNames({
          startDate: values.startDate,

          endDate: values.endDate,

          publicHolidayDates,
        });
      }

      if (createMode === CREATE_MODE.PROPERTY) {
        return Array.isArray(values.propertyValues)
          ? values.propertyValues
              .map((value) => String(value).trim())
              .filter(Boolean)
              .sort((a, b) =>
                a.localeCompare(b, undefined, {
                  numeric: true,
                  sensitivity: "base",
                }),
              )
          : [];
      }

      if (createMode === CREATE_MODE.LAYERS) {
        const selectedKeys = Array.isArray(values.layerKeys)
          ? new Set(values.layerKeys.map(String))
          : new Set();
        return layerOptions
          .filter((option) => selectedKeys.has(String(option.value)))
          .map((option) => option.subPlanName)
          .filter(Boolean)
          .sort((left, right) =>
            left.localeCompare(right, undefined, {
              numeric: true,
              sensitivity: "base",
            }),
          );
      }

      return [];
    },
    [createMode, publicHolidayDates, layerOptions],
  );

  /* ------------------------------------------------------------------------ */
  /* SUBMIT                                                                   */
  /* ------------------------------------------------------------------------ */

  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();

      const normalizedColor = useColor ? normalizeColor(color) : null;

      /*
       * Edit.
       */
      if (isEditing) {
        const subPlanName = String(values.planName || "").trim();

        if (!subPlanName) {
          return;
        }

        if (!editingSubPlan?.id) {
          message.error(`Unable to retrieve the ${entityLabel} ID.`);

          return;
        }

        const updatePayload = {
          id: editingSubPlan.id,
          name: subPlanName,
          color: normalizedColor,
        };

        if (nodeMode && onUpdateOverride) {
          await onUpdateOverride(updatePayload);
        } else {
          dispatch(UpdateSubPlanRequest(updatePayload));
        }

        handleCancel();

        return;
      }

      /*
       * Create.
       */
      if (!projectId) {
        message.error("Unable to retrieve the current Trimble project ID.");

        return;
      }

      if (!parentPlan?.id) {
        message.error(`Unable to retrieve the parent ${entityLabel} ID.`);

        return;
      }

      /*
       * Do not allow Date create
       * before holiday request finishes.
       */
      if (createMode === CREATE_MODE.DATES) {
        if (loadingCountries) {
          message.warning("Countries are still loading.");

          return;
        }

        if (loadingPublicHolidays) {
          message.warning("Public holidays are still loading.");

          return;
        }

        if (publicHolidayError) {
          message.error(publicHolidayError);

          return;
        }
      }

      let names = getCreateNames(values);

      names = [...new Set(names)];

      if (!names.length) {
        message.warning(`Please enter or select at least one ${entityLabel}.`);

        return;
      }

      if (names.length > 500) {
        message.error(
          `A maximum of 500 ${entityLabel}s can be created at once.`,
        );

        return;
      }

      /*
       * Existing Saga splits by comma.
       */
      const itemColors =
        useColor && names.length > 1
          ? buildDistinctColors(names.length, color)
          : [];

      const createPayload = {
        projectId,
        planId: parentPlan.id,
        name: names.join(","),
        color: normalizedColor,
        names,
        parentId: parentPlan.id,
        items: names.map((name, index) => ({
          name,
          color: !useColor
            ? null
            : names.length === 1
              ? normalizedColor
              : itemColors[index],
        })),
      };

      if (nodeMode && onCreateOverride) {
        await onCreateOverride(createPayload);
      } else {
        dispatch(CreateSubPlanRequest(createPayload));
      }

      handleCancel();
    } catch (error) {
      if (error?.errorFields) {
        return;
      }

      console.error("Failed to submit SubPlan:", error);

      message.error(error?.message || "Unable to save the SubPlan.");
    }
  }, [
    form,
    color,
    useColor,
    isEditing,
    editingSubPlan,
    projectId,
    parentPlan,
    dispatch,
    handleCancel,
    getCreateNames,
    createMode,
    loadingCountries,
    loadingPublicHolidays,
    publicHolidayError,
    nodeMode,
    onCreateOverride,
    onUpdateOverride,
    entityLabel,
  ]);

  /* ------------------------------------------------------------------------ */
  /* OPTIONS                                                                  */
  /* ------------------------------------------------------------------------ */

  const propertyValueOptions = useMemo(
    () =>
      propertyValues.map((value) => ({
        value,

        label: value,
      })),
    [propertyValues],
  );

  /* ------------------------------------------------------------------------ */
  /* UI                                                                       */
  /* ------------------------------------------------------------------------ */

  return (
    <Modal
      title={modalTitle}
      open={open}
      onCancel={handleCancel}
      footer={null}
      destroyOnHidden
      maskClosable={!pending}
      keyboard={!pending}
      closable={!pending}
      width={560}
    >
      <Form
        form={form}
        layout="vertical"
        autoComplete="off"
        onFinish={handleSubmit}
      >
        {/* CREATE BY */}

        {!isEditing && (
          <Form.Item label="Create By">
            <Select
              value={createMode}
              options={CREATE_MODE_OPTIONS}
              onChange={handleCreateModeChange}
              disabled={pending}
              style={{
                width: "100%",
              }}
            />
          </Form.Item>
        )}

        {/* MANUAL */}

        {(isEditing || createMode === CREATE_MODE.MANUAL) && (
          <div
            style={{
              display: "flex",

              gap: 8,

              alignItems: "flex-start",
            }}
          >
            <Form.Item
              name="planName"
              label="Sub Plan Name"
              style={{
                flex: 1,

                minWidth: 0,
              }}
              rules={[
                {
                  required: true,

                  whitespace: true,

                  message: `Please enter the ${entityLabel} name.`,
                },
              ]}
            >
              <Input placeholder="Grid 1-2, Grid 2-4" disabled={pending} />
            </Form.Item>
          </div>
        )}

        <Form.Item label="Color">
          <Space>
            <Switch
              checked={useColor}
              disabled={pending}
              checkedChildren="On"
              unCheckedChildren="Off"
              onChange={setUseColor}
            />
            <ColorPicker
              value={color}
              format="rgb"
              disabled={pending || !useColor}
              onChange={handleColorChange}
            />
            {!isEditing && useColor && (
              <span style={{ color: "rgba(0, 0, 0, 0.55)", fontSize: 12 }}>
                Multiple Sub Plans will receive different colors.
              </span>
            )}
          </Space>
        </Form.Item>

        {/* SERIAL */}

        {!isEditing && createMode === CREATE_MODE.SERIAL && (
          <>
            <Form.Item
              name="serialPrefix"
              label="Prefix"
              rules={[
                {
                  required: true,

                  whitespace: true,

                  message: "Please enter a prefix.",
                },
              ]}
            >
              <Input placeholder="Lot" disabled={pending} />
            </Form.Item>

            <div
              style={{
                display: "grid",

                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",

                gap: 12,
              }}
            >
              <Form.Item
                name="serialStart"
                label="Start Number"
                rules={[
                  {
                    required: true,

                    message: "Please enter the start number.",
                  },
                ]}
              >
                <InputNumber
                  precision={0}
                  style={{
                    width: "100%",
                  }}
                />
              </Form.Item>

              <Form.Item
                name="serialQuantity"
                label="Quantity"
                rules={[
                  {
                    required: true,
                  },

                  {
                    type: "number",

                    min: 1,
                  },
                ]}
              >
                <InputNumber
                  min={1}
                  max={500}
                  precision={0}
                  style={{
                    width: "100%",
                  }}
                />
              </Form.Item>
            </div>

            {serialPreview && (
              <div
                style={{
                  marginBottom: 16,

                  padding: "8px 12px",

                  background: "#fafafa",

                  border: "1px solid #f0f0f0",

                  borderRadius: 6,

                  fontSize: 12,
                }}
              >
                <strong>Preview:</strong> {serialPreview}
              </div>
            )}
          </>
        )}

        {/* DATES */}

        {!isEditing && createMode === CREATE_MODE.DATES && (
          <>
            {/* COUNTRY */}

            <Form.Item
              name="dateCountryCode"
              label="Country"
              rules={[
                {
                  required: true,

                  message: "Please select a country.",
                },
              ]}
            >
              <Select
                showSearch
                allowClear
                optionFilterProp="label"
                placeholder={
                  loadingCountries ? "Loading countries..." : "Select Country"
                }
                loading={loadingCountries}
                disabled={pending || loadingCountries}
                options={countryOptions}
                style={{
                  width: "100%",
                }}
              />
            </Form.Item>

            {/* DATE RANGE */}

            <div
              style={{
                display: "grid",

                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",

                gap: 12,
              }}
            >
              <Form.Item
                name="startDate"
                label="Start Date"
                rules={[
                  {
                    required: true,

                    message: "Please select Start Date.",
                  },
                ]}
              >
                <DatePicker
                  format="DD-MM-YYYY"
                  style={{
                    width: "100%",
                  }}
                  disabled={pending}
                />
              </Form.Item>

              <Form.Item
                name="endDate"
                label="End Date"
                dependencies={["startDate"]}
                rules={[
                  {
                    required: true,

                    message: "Please select End Date.",
                  },

                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const start = getFieldValue("startDate");

                      if (!start || !value) {
                        return Promise.resolve();
                      }

                      if (dayjs(value).isBefore(dayjs(start), "day")) {
                        return Promise.reject(
                          new Error("End Date must be on or after Start Date."),
                        );
                      }

                      return Promise.resolve();
                    },
                  }),
                ]}
              >
                <DatePicker
                  format="DD-MM-YYYY"
                  style={{
                    width: "100%",
                  }}
                  disabled={pending}
                />
              </Form.Item>
            </div>

            {/* DATE INFORMATION */}

            <div
              style={{
                marginBottom: 16,

                padding: "10px 12px",

                background: "#fafafa",

                border: "1px solid #f0f0f0",

                borderRadius: 6,

                fontSize: 12,
              }}
            >
              {loadingPublicHolidays ? (
                <Space>
                  <Spin size="small" />
                  Loading public holidays...
                </Space>
              ) : publicHolidayError ? (
                <span
                  style={{
                    color: "#ff4d4f",
                  }}
                >
                  {publicHolidayError}
                </span>
              ) : datePreview ? (
                <>
                  <div>
                    <strong>Preview:</strong> {datePreview}
                  </div>

                  <div
                    style={{
                      marginTop: 6,

                      color: "#888",
                    }}
                  >
                    {selectedCountry?.label
                      ? `Country: ${selectedCountry.label}. `
                      : ""}
                    Saturdays, Sundays and national public holidays are
                    excluded.
                  </div>
                </>
              ) : (
                <span
                  style={{
                    color: "#888",
                  }}
                >
                  Select Country, Start Date and End Date.
                </span>
              )}
            </div>
          </>
        )}

        {/* PROPERTY */}

        {!isEditing && createMode === CREATE_MODE.PROPERTY && (
          <>
            <Form.Item label="Property">
              <div
                style={{
                  display: "flex",

                  gap: 8,
                }}
              >
                <Form.Item
                  name="propertyField"
                  noStyle
                  rules={[
                    {
                      required: true,

                      message: "Please select a property.",
                    },
                  ]}
                >
                  <Select
                    showSearch
                    allowClear
                    optionFilterProp="label"
                    loading={loadingPropertyColumns}
                    disabled={pending || loadingPropertyColumns}
                    options={propertyColumns}
                    placeholder={
                      loadingPropertyColumns
                        ? "Loading DataTable properties..."
                        : "Select a DataTable property"
                    }
                    style={{
                      flex: 1,

                      minWidth: 0,
                    }}
                  />
                </Form.Item>

                <Button
                  icon={<ReloadOutlined />}
                  loading={loadingPropertyColumns}
                  disabled={pending || loadingPropertyColumns}
                  onClick={loadPropertyColumns}
                />
              </div>
            </Form.Item>

            <Form.Item
              name="propertyValues"
              label="Values"
              rules={[
                {
                  required: true,
                  type: "array",
                  min: 1,
                  message: "Please select at least one property value.",
                },
              ]}
            >
              <Select
                mode="multiple"
                showSearch
                allowClear
                optionFilterProp="label"
                maxTagCount="responsive"
                loading={loadingPropertyValues}
                disabled={
                  pending || loadingPropertyValues || !selectedPropertyField
                }
                options={propertyValueOptions}
                placeholder={
                  !selectedPropertyField
                    ? "Select a property first"
                    : loadingPropertyValues
                      ? "Loading values from the model..."
                      : "Select one or more values"
                }
              />
            </Form.Item>
          </>
        )}

        {/* LAYERS */}

        {!isEditing && createMode === CREATE_MODE.LAYERS && (
          <>
            <Form.Item label="Layers">
              <div style={{ display: "flex", gap: 8 }}>
                <Form.Item
                  name="layerKeys"
                  noStyle
                  rules={[
                    {
                      required: true,
                      type: "array",
                      min: 1,
                      message: "Please select at least one Layer.",
                    },
                  ]}
                >
                  <Select
                    mode="multiple"
                    showSearch
                    allowClear
                    optionFilterProp="label"
                    maxTagCount="responsive"
                    loading={loadingLayers}
                    disabled={pending || loadingLayers}
                    options={layerOptions}
                    placeholder={
                      loadingLayers ? "Loading Layers..." : "Select Layers"
                    }
                    style={{ flex: 1, minWidth: 0 }}
                  />
                </Form.Item>

                <Button
                  icon={<ReloadOutlined />}
                  loading={loadingLayers}
                  disabled={pending || loadingLayers}
                  onClick={loadLayers}
                />
              </div>
            </Form.Item>

            <div style={{ marginBottom: 16, fontSize: 12, color: "#888" }}>
              {layerOptions.length} layers found in the loaded models. Each
              selected layer will create one Sub Plan.
            </div>
          </>
        )}

        {/* FOOTER */}

        <Form.Item
          style={{
            marginBottom: 0,
          }}
        >
          <div
            style={{
              display: "flex",

              justifyContent: "flex-end",

              gap: 8,
            }}
          >
            <Button onClick={handleCancel} disabled={pending}>
              Cancel
            </Button>

            <Button
              type="primary"
              htmlType="submit"
              loading={pending}
              disabled={
                loadingCountries ||
                loadingPublicHolidays ||
                loadingPropertyColumns ||
                loadingPropertyValues ||
                loadingLayers
              }
            >
              {submitButtonName}
            </Button>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default React.memo(SubPlanModal);
