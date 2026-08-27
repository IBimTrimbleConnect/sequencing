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
  ASSEMBLY_NAME: "assemblyName",
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
    value: CREATE_MODE.ASSEMBLY_NAME,
    label: "Assembly Names",
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
  const source = value?.rgb ?? value ?? fallback;

  return {
    r: clampColorValue(source?.r ?? fallback.r),

    g: clampColorValue(source?.g ?? fallback.g),

    b: clampColorValue(source?.b ?? fallback.b),
  };
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
/* ASSEMBLY HELPERS                                                           */
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

const getAssemblyNameFromProperties = (objectProperty) => {
  const propertySets = getPropertySets(objectProperty);

  for (const propertySet of propertySets) {
    const groupName = String(propertySet?.name ?? propertySet?.groupName ?? "")
      .trim()
      .toUpperCase();

    const properties = getPropertiesFromSet(propertySet);

    for (const property of properties) {
      const propertyName = String(property?.name ?? "")
        .trim()
        .toUpperCase();

      const isAssemblyName =
        propertyName === "ASSEMBLY NAME" ||
        propertyName === "ASSEMBLY_NAME" ||
        propertyName === "ASSEMBLYNAME" ||
        (groupName === "ASSEMBLY" && propertyName === "NAME");

      if (!isAssemblyName) {
        continue;
      }

      const rawValue =
        property?.value ??
        property?.formattedValue ??
        property?.displayValue ??
        null;

      if (rawValue == null) {
        continue;
      }

      const value = String(rawValue).trim();

      if (value) {
        return value;
      }
    }
  }

  const productName = String(objectProperty?.product?.name ?? "").trim();

  if (productName) {
    return productName;
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

  const [useColor, setUseColor] = useState(true);

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

  /*
   * Assemblies.
   */
  const [assemblyNames, setAssemblyNames] = useState([]);

  const [loadingAssemblyNames, setLoadingAssemblyNames] = useState(false);

  const editingSubPlan = subPlan || (isEditing ? plan : null);

  const parentPlan = isEditing ? null : plan;

  const modalTitle = title || (isEditing ? `Edit ${entityLabel}` : `Create ${entityLabel}`);

  const submitButtonName = buttonName || (isEditing ? "Update" : "Create");

  /* ------------------------------------------------------------------------ */
  /* RESET                                                                    */
  /* ------------------------------------------------------------------------ */

  const resetModal = useCallback(() => {
    form.resetFields();

    setColor({
      ...DEFAULT_COLOR,
    });

    setUseColor(true);

    setCreateMode(CREATE_MODE.MANUAL);

    setAssemblyNames([]);

    setLoadingAssemblyNames(false);

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
  /* ASSEMBLY                                                                 */
  /* ------------------------------------------------------------------------ */

  const loadAssemblyNames = useCallback(async () => {
    try {
      setLoadingAssemblyNames(true);

      setAssemblyNames([]);

      const tcapi = await WorkspaceAPI.connect(window.parent);

      /*
       * Assembly level.
       */
      const assemblyGroups = await tcapi.viewer.getObjects({
        parameter: {
          class: "IFCELEMENTASSEMBLY",
        },
      });

      if (!Array.isArray(assemblyGroups) || !assemblyGroups.length) {
        message.warning(
          "No assembly-level objects were found in the loaded models.",
        );

        return;
      }

      const uniqueNames = new Set();

      for (const modelGroup of assemblyGroups) {
        const modelId = modelGroup?.modelId;

        if (modelId == null) {
          continue;
        }

        const objects = Array.isArray(modelGroup?.objects)
          ? modelGroup.objects
          : [];

        const runtimeIds = objects
          .map((object) => object?.id ?? object?.runtimeId)
          .filter((id) => id != null);

        if (!runtimeIds.length) {
          continue;
        }

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
            const assemblyName = getAssemblyNameFromProperties(objectProperty);

            if (assemblyName) {
              uniqueNames.add(assemblyName);
            }
          }
        }
      }

      const result = Array.from(uniqueNames).sort((left, right) =>
        left.localeCompare(right, undefined, {
          numeric: true,

          sensitivity: "base",
        }),
      );

      setAssemblyNames(result);

      if (!result.length) {
        message.warning(
          "Assembly objects were found, but no Assembly Names were available.",
        );
      }
    } catch (error) {
      console.error("Load Assembly Names failed:", error);

      setAssemblyNames([]);

      message.error(
        error?.message ||
          "Unable to retrieve Assembly Names from the loaded models.",
      );
    } finally {
      setLoadingAssemblyNames(false);
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

      const hasColor = editingSubPlan.color != null;

      setUseColor(hasColor);
      setColor(normalizeColor(editingSubPlan.color));

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

      /*
       * Assembly.
       */
      assemblyNames: [],
    });

    setColor({
      ...DEFAULT_COLOR,
    });

    setUseColor(true);

    setCreateMode(CREATE_MODE.MANUAL);

    setAssemblyNames([]);

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

    if (createMode === CREATE_MODE.ASSEMBLY_NAME) {
      loadAssemblyNames();
    }

    if (createMode === CREATE_MODE.DATES) {
      loadCountries();
    }
  }, [open, isEditing, createMode, loadAssemblyNames, loadCountries]);

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

      if (mode !== CREATE_MODE.ASSEMBLY_NAME) {
        form.setFieldValue("assemblyNames", []);
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
          name: "assemblyNames",
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

      /*
       * Assembly.
       */
      if (createMode === CREATE_MODE.ASSEMBLY_NAME) {
        return Array.isArray(values.assemblyNames)
          ? values.assemblyNames
              .map((name) => String(name).trim())
              .filter(Boolean)
              .sort((a, b) =>
                a.localeCompare(b, undefined, {
                  numeric: true,
                  sensitivity: "base",
                }),
              )
          : [];
      }

      return [];
    },
    [createMode, publicHolidayDates],
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
          dispatch(
            UpdateSubPlanRequest(updatePayload),
          );
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
        message.error(`A maximum of 500 ${entityLabel}s can be created at once.`);

        return;
      }

      /*
       * Existing Saga splits by comma.
       */
      const createPayload = {
        projectId,
        planId: parentPlan.id,
        name: names.join(","),
        color: normalizedColor,
        names,
        parentId: parentPlan.id,
      };

      if (nodeMode && onCreateOverride) {
        await onCreateOverride(createPayload);
      } else {
        dispatch(
          CreateSubPlanRequest(createPayload),
        );
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

  const assemblyNameOptions = useMemo(
    () =>
      assemblyNames.map((name) => ({
        value: name,

        label: name,
      })),
    [assemblyNames],
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
              label={nodeMode ? "Name" : "Sub Plan Name"}
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

            <Form.Item label="Color">
              <Space size={6}>
                <Switch
                  size="small"
                  checked={useColor}
                  disabled={pending}
                  onChange={setUseColor}
                />

                <ColorPicker
                  value={color}
                  format="rgb"
                  disabled={pending || !useColor}
                  onChange={handleColorChange}
                />
              </Space>
            </Form.Item>
          </div>
        )}

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

        {/* ASSEMBLY */}

        {!isEditing && createMode === CREATE_MODE.ASSEMBLY_NAME && (
          <>
            <Form.Item label="Assembly Names">
              <div
                style={{
                  display: "flex",

                  gap: 8,
                }}
              >
                <Form.Item
                  name="assemblyNames"
                  noStyle
                  rules={[
                    {
                      required: true,

                      type: "array",

                      min: 1,

                      message: "Please select at least one Assembly Name.",
                    },
                  ]}
                >
                  <Select
                    mode="multiple"
                    showSearch
                    allowClear
                    optionFilterProp="label"
                    maxTagCount="responsive"
                    loading={loadingAssemblyNames}
                    disabled={pending || loadingAssemblyNames}
                    options={assemblyNameOptions}
                    placeholder={
                      loadingAssemblyNames
                        ? "Loading Assembly Names..."
                        : "Select Assembly Names"
                    }
                    style={{
                      flex: 1,

                      minWidth: 0,
                    }}
                  />
                </Form.Item>

                <Button
                  icon={<ReloadOutlined />}
                  loading={loadingAssemblyNames}
                  disabled={pending || loadingAssemblyNames}
                  onClick={loadAssemblyNames}
                />
              </div>
            </Form.Item>

            <div
              style={{
                marginBottom: 16,

                fontSize: 12,

                color: "#888",
              }}
            >
              {assemblyNames.length} unique Assembly Names found.
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
              disabled={loadingCountries || loadingPublicHolidays}
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
