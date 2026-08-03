import React, {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  Button,
  ColorPicker,
  Form,
  Input,
  message,
  Modal,
} from "antd";

import {
  useDispatch,
  useSelector,
} from "react-redux";

import {
  CreateSubPlanRequest,
  UpdateSubPlanRequest,
} from "../store/sequence/action";

const DEFAULT_COLOR = {
  r: 248,
  g: 28,
  b: 234,
};

const clampColorValue = (value) =>
  Math.max(
    0,
    Math.min(255, Number(value) || 0),
  );

const normalizeColor = (
  value,
  fallback = DEFAULT_COLOR,
) => {
  const source =
    value?.rgb ??
    value ??
    fallback;

  return {
    r: clampColorValue(
      source?.r ?? fallback.r,
    ),
    g: clampColorValue(
      source?.g ?? fallback.g,
    ),
    b: clampColorValue(
      source?.b ?? fallback.b,
    ),
  };
};

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

  const projectId = useSelector(
    (state) =>
      state.sequence.projectId || "",
  );

  const pending = useSelector(
    (state) =>
      state.sequence.pending,
  );

  const [color, setColor] = useState({
    ...DEFAULT_COLOR,
  });

  const editingSubPlan =
    subPlan ||
    (isEditing ? plan : null);

  const parentPlan =
    isEditing ? null : plan;

  const modalTitle =
    title ||
    (isEditing
      ? "Edit Sub Plan"
      : "Create Sub Plan");

  const submitButtonName =
    buttonName ||
    (isEditing
      ? "Update"
      : "Create");

  const resetModal = useCallback(() => {
    form.resetFields();

    setColor({
      ...DEFAULT_COLOR,
    });
  }, [form]);

  const handleCancel = useCallback(() => {
    resetModal();
    onCancel?.();
  }, [resetModal, onCancel]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (
      isEditing &&
      editingSubPlan
    ) {
      form.setFieldsValue({
        planName:
          editingSubPlan.name || "",
      });

      setColor(
        normalizeColor(
          editingSubPlan.color,
        ),
      );

      return;
    }

    form.resetFields();

    setColor({
      ...DEFAULT_COLOR,
    });
  }, [
    open,
    isEditing,
    editingSubPlan,
    form,
  ]);

  const handleColorChange =
    useCallback((value) => {
      const rgb =
        value?.toRgb?.() ??
        value?.metaColor?.toRgb?.() ??
        value;

      setColor(
        normalizeColor(rgb),
      );
    }, []);

  const handleSubmit =
    useCallback(async () => {
      try {
        const values =
          await form.validateFields();

        const subPlanName =
          values.planName?.trim();

        if (!subPlanName) {
          return;
        }

        const normalizedColor =
          normalizeColor(color);

        if (isEditing) {
          if (!editingSubPlan?.id) {
            message.error(
              "Unable to retrieve the SubPlan ID.",
            );
            return;
          }

          dispatch(
            UpdateSubPlanRequest({
              id: editingSubPlan.id,
              name: subPlanName,
              color: normalizedColor,
            }),
          );
        } else {
          if (!projectId) {
            message.error(
              "Unable to retrieve the current Trimble project ID.",
            );
            return;
          }

          if (!parentPlan?.id) {
            message.error(
              "Unable to retrieve the parent Plan ID.",
            );
            return;
          }

          dispatch(
            CreateSubPlanRequest({
              projectId,
              planId: parentPlan.id,
              name: subPlanName,
              color: normalizedColor,
            }),
          );
        }

        handleCancel();
      } catch (error) {
        if (error?.errorFields) {
          return;
        }

        console.error(
          "Failed to submit SubPlan:",
          error,
        );

        message.error(
          error?.message ||
            "Unable to save the SubPlan.",
        );
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
    ]);

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
            }}
            normalize={(value) =>
              value?.replace(
                /^\s+/,
                "",
              )
            }
            rules={[
              {
                required: true,
                whitespace: true,
                message:
                  "Please enter the SubPlan name.",
              },
              {
                max: 255,
                message:
                  "The SubPlan name cannot exceed 255 characters.",
              },
            ]}
          >
            <Input
              placeholder="Sub Plan Name"
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
              showText={(selectedColor) => {
                const rgb =
                  selectedColor.toRgb();

                return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
              }}
              format="rgb"
              onChange={
                handleColorChange
              }
            />
          </Form.Item>
        </div>

        <Form.Item
          style={{
            marginBottom: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "flex-end",
              gap: 8,
            }}
          >
            <Button
              onClick={handleCancel}
              disabled={pending}
            >
              Cancel
            </Button>

            <Button
              type="primary"
              htmlType="submit"
              loading={pending}
            >
              {submitButtonName}
            </Button>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default React.memo(
  SubPlanModal,
);