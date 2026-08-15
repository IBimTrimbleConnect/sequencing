import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
  ColorPicker,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Spin,
} from "antd";

import { ReloadOutlined } from "@ant-design/icons";

import { useDispatch, useSelector } from "react-redux";

import * as WorkspaceAPI from "trimble-connect-workspace-api";

import {
  CreateSubPlanRequest,
  UpdateSubPlanRequest,
} from "../store/sequence/action";

/* -------------------------------------------------------------------------- */
/*                                   CONSTANTS                                */
/* -------------------------------------------------------------------------- */

const DEFAULT_COLOR = {
  r: 248,
  g: 28,
  b: 234,
};

const CREATE_MODE = {
  MANUAL: "manual",
  SERIAL: "serial",
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
    value: CREATE_MODE.ASSEMBLY_NAME,
    label: "Assembly Names",
  },
];

const ASSEMBLY_PROPERTY_NAMES = new Set([
  "ASSEMBLY NAME",
  "ASSEMBLY_NAME",
  "ASSEMBLYNAME",
  "ASSEMBLY NAME.",
  "NAME",
]);

const PROPERTY_BATCH_SIZE = 300;

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                  */
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

/*
 * Extract Assembly Name from ObjectProperties.
 */
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
/*                              SUB PLAN MODAL                                */
/* -------------------------------------------------------------------------- */

const SubPlanModal = ({
  title,
  buttonName,
  plan,
  subPlan = null,
  open,
  onCancel,
  isEditing = false,
}) => {
  const dispatch = useDispatch();

  const [form] = Form.useForm();

  const projectId = useSelector((state) => state.sequence.projectId || "");

  const pending = useSelector((state) => state.sequence.pending);

  const [color, setColor] = useState({
    ...DEFAULT_COLOR,
  });

  const [createMode, setCreateMode] = useState(CREATE_MODE.MANUAL);

  const [assemblyNames, setAssemblyNames] = useState([]);

  const [loadingAssemblyNames, setLoadingAssemblyNames] = useState(false);

  const editingSubPlan = subPlan || (isEditing ? plan : null);

  const parentPlan = isEditing ? null : plan;

  const modalTitle = title || (isEditing ? "Edit Sub Plan" : "Create Sub Plan");

  const submitButtonName = buttonName || (isEditing ? "Update" : "Create");

  /* ------------------------------------------------------------------------ */
  /*                                  RESET                                   */
  /* ------------------------------------------------------------------------ */

  const resetModal = useCallback(() => {
    form.resetFields();

    setColor({
      ...DEFAULT_COLOR,
    });

    setCreateMode(CREATE_MODE.MANUAL);

    setAssemblyNames([]);

    setLoadingAssemblyNames(false);
  }, [form]);

  const handleCancel = useCallback(() => {
    resetModal();

    onCancel?.();
  }, [resetModal, onCancel]);

  /* ------------------------------------------------------------------------ */
  /*                         LOAD ASSEMBLY NAMES                              */
  /* ------------------------------------------------------------------------ */

  const loadAssemblyNames = useCallback(async () => {
    try {
      setLoadingAssemblyNames(true);

      setAssemblyNames([]);

      const tcapi = await WorkspaceAPI.connect(window.parent);

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

      /*
       * =====================================================
       * EACH MODEL
       * =====================================================
       */
      for (const modelGroup of assemblyGroups) {
        const modelId = modelGroup?.modelId;

        if (modelId == null) {
          continue;
        }

        const objects = Array.isArray(modelGroup?.objects)
          ? modelGroup.objects
          : [];

        /*
         * ModelObjects object IDs returned by viewer are
         * runtime entity IDs.
         */
        const runtimeIds = objects
          .map((object) => object?.id ?? object?.runtimeId)
          .filter((id) => id != null);

        if (!runtimeIds.length) {
          continue;
        }

        /*
         * Remove duplicated runtime IDs.
         */
        const uniqueRuntimeIds = [...new Set(runtimeIds)];

        /*
         * ===================================================
         * GET PROPERTIES IN BATCHES
         * ===================================================
         */
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

          console.log("Object Properties:", objectProperties);
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

      console.log("Unique Assembly Names:", result);

      if (!result.length) {
        message.warning(
          "Assembly objects were found, but no Assembly Name properties were available.",
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
  /*                                OPEN MODAL                                */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!open) {
      return;
    }

    /*
     * EDIT
     */
    if (isEditing && editingSubPlan) {
      form.setFieldsValue({
        planName: editingSubPlan.name || "",
      });

      setColor(normalizeColor(editingSubPlan.color));

      return;
    }

    /*
     * CREATE
     */
    form.resetFields();

    form.setFieldsValue({
      serialPrefix: "SEQ",

      serialStart: 1,

      serialQuantity: 1,

      assemblyNames: [],
    });

    setColor({
      ...DEFAULT_COLOR,
    });

    setCreateMode(CREATE_MODE.MANUAL);

    setAssemblyNames([]);
  }, [open, isEditing, editingSubPlan, form]);

  /* ------------------------------------------------------------------------ */
  /*                    LOAD WHEN ASSEMBLY MODE SELECTED                      */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!open || isEditing || createMode !== CREATE_MODE.ASSEMBLY_NAME) {
      return;
    }

    loadAssemblyNames();
  }, [open, isEditing, createMode, loadAssemblyNames]);

  /* ------------------------------------------------------------------------ */
  /*                                  COLOR                                   */
  /* ------------------------------------------------------------------------ */

  const handleColorChange = useCallback((value) => {
    const rgb = value?.toRgb?.() ?? value?.metaColor?.toRgb?.() ?? value;

    setColor(normalizeColor(rgb));
  }, []);

  /* ------------------------------------------------------------------------ */
  /*                               CREATE MODE                                */
  /* ------------------------------------------------------------------------ */

  const handleCreateModeChange = useCallback(
    (mode) => {
      setCreateMode(mode);

      /*
       * Clear selected values belonging to another mode.
       */
      if (mode !== CREATE_MODE.ASSEMBLY_NAME) {
        form.setFieldValue("assemblyNames", []);
      }

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
          name: "assemblyNames",
          errors: [],
        },
      ]);
    },
    [form],
  );

  /* ------------------------------------------------------------------------ */
  /*                             SERIAL PREVIEW                               */
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

    return `${names.slice(0, 4).join(", ")}, ... ${
      names[names.length - 1]
    } (${names.length} Sub Plans)`;
  }, [serialPrefix, serialStart, serialQuantity]);

  /* ------------------------------------------------------------------------ */
  /*                              BUILD NAMES                                 */
  /* ------------------------------------------------------------------------ */

  const getCreateNames = useCallback(
    (values) => {
      /*
       * MANUAL
       */
      if (createMode === CREATE_MODE.MANUAL) {
        return String(values.planName || "")
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);
      }

      /*
       * SERIAL
       */
      if (createMode === CREATE_MODE.SERIAL) {
        return buildSerialNames({
          prefix: values.serialPrefix,

          start: values.serialStart,

          quantity: values.serialQuantity,
        });
      }

      /*
       * ASSEMBLY NAME
       */
      if (createMode === CREATE_MODE.ASSEMBLY_NAME) {
        return Array.isArray(values.assemblyNames)
          ? values.assemblyNames
              .map((name) => String(name).trim())
              .filter(Boolean)
          : [];
      }

      return [];
    },
    [createMode],
  );

  /* ------------------------------------------------------------------------ */
  /*                                  SUBMIT                                  */
  /* ------------------------------------------------------------------------ */

  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();

      const normalizedColor = normalizeColor(color);

      /*
       * =====================================================
       * EDIT
       * =====================================================
       */
      if (isEditing) {
        const subPlanName = String(values.planName || "").trim();

        if (!subPlanName) {
          return;
        }

        if (!editingSubPlan?.id) {
          message.error("Unable to retrieve the SubPlan ID.");

          return;
        }

        dispatch(
          UpdateSubPlanRequest({
            id: editingSubPlan.id,

            name: subPlanName,

            color: normalizedColor,
          }),
        );

        handleCancel();

        return;
      }

      /*
       * =====================================================
       * CREATE
       * =====================================================
       */

      if (!projectId) {
        message.error("Unable to retrieve the current Trimble project ID.");

        return;
      }

      if (!parentPlan?.id) {
        message.error("Unable to retrieve the parent Plan ID.");

        return;
      }

      let names = getCreateNames(values);

      /*
       * Unique.
       */
      names = [...new Set(names)];

      if (!names.length) {
        message.warning("Please enter or select at least one Sub Plan.");

        return;
      }

      if (names.length > 500) {
        message.error("A maximum of 500 Sub Plans can be created at once.");

        return;
      }

      /*
       * Existing Saga splits names by comma.
       */
      dispatch(
        CreateSubPlanRequest({
          projectId,

          planId: parentPlan.id,

          name: names.join(","),

          color: normalizedColor,
        }),
      );

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
    isEditing,
    editingSubPlan,
    projectId,
    parentPlan,
    dispatch,
    handleCancel,
    getCreateNames,
  ]);

  /* ------------------------------------------------------------------------ */
  /*                            ASSEMBLY OPTIONS                              */
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
  /*                                    UI                                    */
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
      styles={{
        header: {
          marginBottom: 12,
        },

        body: {
          padding: 0,
        },
      }}
    >
      <Form
        form={form}
        layout="vertical"
        autoComplete="off"
        onFinish={handleSubmit}
      >
        {/* ================================================= */}
        {/* CREATE BY                                        */}
        {/* ================================================= */}

        {!isEditing && (
          <Form.Item
            label="Create By"
            style={{
              marginBottom: 16,
            }}
          >
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

        {/* ================================================= */}
        {/* MANUAL / EDIT                                    */}
        {/* ================================================= */}

        {(isEditing || createMode === CREATE_MODE.MANUAL) && (
          <div
            style={{
              display: "flex",

              alignItems: "flex-start",

              gap: 8,
            }}
          >
            <Form.Item
              name="planName"
              label="Sub Plan Name"
              style={{
                flex: 1,

                marginBottom: 16,

                minWidth: 0,
              }}
              normalize={(value) => value?.replace(/^\s+/, "")}
              rules={[
                {
                  required: true,

                  whitespace: true,

                  message: "Please enter the SubPlan name.",
                },

                {
                  max: 255,

                  message: "The SubPlan name cannot exceed 255 characters.",
                },
              ]}
            >
              <Input
                placeholder="Grid 1-2, Grid 2-4"
                maxLength={255}
                allowClear
                autoFocus
                disabled={pending}
              />
            </Form.Item>

            <Form.Item
              label="Color"
              style={{
                marginBottom: 16,
              }}
            >
              <ColorPicker
                value={color}
                disabled={pending}
                format="rgb"
                onChange={handleColorChange}
              />
            </Form.Item>
          </div>
        )}

        {/* ================================================= */}
        {/* SERIAL                                           */}
        {/* ================================================= */}

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
              style={{
                marginBottom: 12,
              }}
            >
              <Input placeholder="Lot" allowClear disabled={pending} />
            </Form.Item>

            <div
              style={{
                display: "grid",

                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",

                gap: 12,

                width: "100%",
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
                style={{
                  marginBottom: 12,

                  minWidth: 0,
                }}
              >
                <InputNumber
                  precision={0}
                  style={{
                    width: "100%",
                  }}
                  disabled={pending}
                />
              </Form.Item>

              <Form.Item
                name="serialQuantity"
                label="Quantity"
                rules={[
                  {
                    required: true,

                    message: "Please enter the quantity.",
                  },

                  {
                    type: "number",

                    min: 1,

                    message: "Quantity must be at least 1.",
                  },
                ]}
                style={{
                  marginBottom: 12,

                  minWidth: 0,
                }}
              >
                <InputNumber
                  min={1}
                  max={500}
                  precision={0}
                  style={{
                    width: "100%",
                  }}
                  disabled={pending}
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

                  color: "#666",

                  overflowWrap: "anywhere",
                }}
              >
                <strong>Preview:</strong> {serialPreview}
              </div>
            )}

            <Form.Item>
              <Space align="center" wrap>
                <span
                  style={{
                    fontSize: 12,

                    color: "#888",
                  }}
                >
                  Multiple Sub Plans will use different colors automatically.
                </span>
              </Space>
            </Form.Item>
          </>
        )}

        {/* ================================================= */}
        {/* ASSEMBLY NAME                                    */}
        {/* ================================================= */}

        {!isEditing && createMode === CREATE_MODE.ASSEMBLY_NAME && (
          <>
            <Form.Item
              label="Assembly Names"
              style={{
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: "flex",

                  alignItems: "flex-start",

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
                    allowClear
                    showSearch
                    maxTagCount="responsive"
                    optionFilterProp="label"
                    placeholder={
                      loadingAssemblyNames
                        ? "Loading Assembly Names..."
                        : "Select Assembly Names"
                    }
                    loading={loadingAssemblyNames}
                    disabled={pending || loadingAssemblyNames}
                    options={assemblyNameOptions}
                    style={{
                      flex: 1,

                      minWidth: 0,
                    }}
                    notFoundContent={
                      loadingAssemblyNames ? (
                        <div
                          style={{
                            textAlign: "center",

                            padding: 12,
                          }}
                        >
                          <Spin size="small" />
                        </div>
                      ) : (
                        "No Assembly Names found"
                      )
                    }
                  />
                </Form.Item>

                <Button
                  icon={<ReloadOutlined />}
                  disabled={pending || loadingAssemblyNames}
                  loading={loadingAssemblyNames}
                  onClick={loadAssemblyNames}
                />
              </div>
            </Form.Item>

            <div
              style={{
                marginBottom: 16,

                color: "#888",

                fontSize: 12,
              }}
            >
              {assemblyNames.length > 0
                ? `${assemblyNames.length} unique Assembly Names found`
                : "Assembly Names are read from assembly-level objects in the loaded models."}
            </div>

            <Form.Item>
              <Space align="center" wrap>
                <span
                  style={{
                    fontSize: 12,

                    color: "#888",
                  }}
                >
                  Selected Assembly Names will become Sub Plans with different
                  colors.
                </span>
              </Space>
            </Form.Item>
          </>
        )}

        {/* ================================================= */}
        {/* FOOTER                                           */}
        {/* ================================================= */}

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

            <Button type="primary" htmlType="submit" loading={pending}>
              {submitButtonName}
            </Button>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default React.memo(SubPlanModal);
