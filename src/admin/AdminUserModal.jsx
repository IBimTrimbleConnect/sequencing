import React, { useEffect } from "react";
import {
  Alert,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
} from "antd";
import dayjs from "dayjs";

const DATE_FORMAT = "YYYY-MM-DD";

export default function AdminUserModal({
  open,
  editingUser,
  loading = false,
  onCancel,
  onSubmit,
}) {
  const [form] = Form.useForm();

  const licenseType = Form.useWatch(
    "licenseType",
    form,
  );

  const startDate = Form.useWatch(
    "startDate",
    form,
  );

  const trialAlreadyUsed =
    Number(editingUser?.trialCount ?? 0) >= 1;

  const currentlyTrial =
    editingUser?.licenseType === "Trial";

  useEffect(() => {
    if (!open) {
      return;
    }

    if (editingUser) {
      form.setFieldsValue({
        email:
          editingUser.email,

        status:
          editingUser.status ||
          "Active",

        role:
          editingUser.role ||
          "Viewer",

        licenseType:
          editingUser.licenseType ||
          "Trial",

        startDate:
          editingUser.startDate
            ? dayjs(
                editingUser.startDate,
              )
            : dayjs(),

        endDate:
          editingUser.endDate
            ? dayjs(
                editingUser.endDate,
              )
            : null,
      });

      return;
    }

    form.resetFields();

    form.setFieldsValue({
      status: "Active",

      role: "Viewer",

      licenseType: "Trial",

      startDate:
        dayjs(),

      endDate:
        dayjs().add(
          14,
          "day",
        ),
    });
  }, [
    editingUser,
    form,
    open,
  ]);

  useEffect(() => {
    if (
      !open ||
      !startDate
    ) {
      return;
    }

    if (
      licenseType ===
      "Trial"
    ) {
      form.setFieldValue(
        "endDate",
        dayjs(
          startDate,
        ).add(
          14,
          "day",
        ),
      );

      return;
    }

    if (
      licenseType ===
      "Annual"
    ) {
      form.setFieldValue(
        "endDate",
        dayjs(
          startDate,
        ).add(
          365,
          "day",
        ),
      );
    }
  }, [
    licenseType,
    startDate,
    form,
    open,
  ]);

  const handleOk = async () => {
    const values =
      await form.validateFields();

    await onSubmit({
      email:
        String(
          values.email ||
          "",
        )
          .trim()
          .toLowerCase(),

      status:
        values.status,

      role:
        values.role,

      licenseType:
        values.licenseType,

      startDate:
        values.startDate
          ? values.startDate.format(
              DATE_FORMAT,
            )
          : null,

      endDate:
        values.endDate
          ? values.endDate.format(
              DATE_FORMAT,
            )
          : null,
    });
  };

  return (
    <Modal
      title={
        editingUser
          ? "Edit Trimble User"
          : "Add Trimble User"
      }
      open={open}
      confirmLoading={
        loading
      }
      okText={
        editingUser
          ? "Save"
          : "Create"
      }
      cancelText="Cancel"
      onOk={
        handleOk
      }
      onCancel={
        onCancel
      }
      destroyOnHidden
      maskClosable={
        !loading
      }
      keyboard={
        !loading
      }
      closable={
        !loading
      }
    >
      <Form
        form={form}
        layout="vertical"
        autoComplete="off"
      >
        <Form.Item
          label="Email"
          name="email"
          rules={[
            {
              required: true,
              whitespace: true,
              message:
                "Please enter the Trimble email.",
            },
            {
              type: "email",
              message:
                "Please enter a valid email.",
            },
          ]}
        >
          <Input
            placeholder="user@example.com"
            disabled={
              loading
            }
          />
        </Form.Item>

        <Form.Item
          label="Status"
          name="status"
          rules={[
            {
              required: true,
            },
          ]}
        >
          <Select
            disabled={
              loading
            }
            options={[
              {
                label:
                  "Active",
                value:
                  "Active",
              },
              {
                label:
                  "Inactive",
                value:
                  "Inactive",
              },
            ]}
          />
        </Form.Item>

        <Form.Item
          label="Role"
          name="role"
          rules={[
            {
              required: true,
            },
          ]}
        >
          <Select
            disabled={
              loading
            }
            options={[
              {
                label:
                  "Owner",
                value:
                  "Owner",
              },
              {
                label:
                  "Viewer",
                value:
                  "Viewer",
              },
            ]}
          />
        </Form.Item>

        <Form.Item
          label="License Type"
          name="licenseType"
          rules={[
            {
              required: true,
              message:
                "Please select a license type.",
            },
          ]}
        >
          <Select
            disabled={
              loading
            }
            options={[
              {
                label:
                  "Trial",
                value:
                  "Trial",

                disabled:
                  Boolean(
                    editingUser,
                  ) &&
                  trialAlreadyUsed &&
                  !currentlyTrial,
              },
              {
                label:
                  "Annual",
                value:
                  "Annual",
              },
            ]}
          />
        </Form.Item>

        {editingUser &&
          trialAlreadyUsed && (
            <Alert
              type="info"
              showIcon
              style={{
                marginBottom:
                  16,
              }}
              message="Trial already used"
              description={
                currentlyTrial
                  ? "This user is currently using Trial. If changed to Annual, Trial cannot be assigned again."
                  : "This user has already used Trial and cannot be assigned another Trial."
              }
            />
          )}

        <Form.Item
          label="Start Date"
          name="startDate"
          rules={[
            {
              required: true,
              message:
                "Please select Start Date.",
            },
          ]}
        >
          <DatePicker
            format="DD-MM-YYYY"
            allowClear={
              false
            }
            disabled={
              loading
            }
            style={{
              width:
                "100%",
            }}
          />
        </Form.Item>

        <Form.Item
          label="End Date"
          name="endDate"
          rules={[
            {
              required: true,
              message:
                "End Date is required.",
            },
          ]}
        >
          <DatePicker
            format="DD-MM-YYYY"
            allowClear={
              false
            }
            disabled
            style={{
              width:
                "100%",
            }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}