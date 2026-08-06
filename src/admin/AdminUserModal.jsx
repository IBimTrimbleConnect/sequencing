import React, { useEffect } from "react";
import { DatePicker, Form, Input, Modal, Select } from "antd";
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

  useEffect(() => {
    if (!open) return;

    if (editingUser) {
      form.setFieldsValue({
        email: editingUser.email,
        status: editingUser.status || "Active",
        role: editingUser.role || "Viewer",
        startDate: editingUser.startDate ? dayjs(editingUser.startDate) : null,
        endDate: editingUser.endDate ? dayjs(editingUser.endDate) : null,
      });
      return;
    }

    form.resetFields();
    form.setFieldsValue({
      status: "Active",
      role: "Viewer",
      startDate: dayjs(),
      endDate: null,
    });
  }, [editingUser, form, open]);

  const handleOk = async () => {
    const values = await form.validateFields();

    await onSubmit({
      email: String(values.email || "").trim().toLowerCase(),
      status: values.status,
      role: values.role,
      startDate: values.startDate ? values.startDate.format(DATE_FORMAT) : null,
      endDate: values.endDate ? values.endDate.format(DATE_FORMAT) : null,
    });
  };

  return (
    <Modal
      title={editingUser ? "Edit Trimble User" : "Add Trimble User"}
      open={open}
      confirmLoading={loading}
      okText={editingUser ? "Save" : "Create"}
      cancelText="Cancel"
      onOk={handleOk}
      onCancel={onCancel}
      destroyOnHidden
      maskClosable={!loading}
      keyboard={!loading}
      closable={!loading}
    >
      <Form form={form} layout="vertical" autoComplete="off">
        <Form.Item
          label="Email"
          name="email"
          rules={[
            { required: true, whitespace: true, message: "Please enter the Trimble email." },
            { type: "email", message: "Please enter a valid email." },
          ]}
        >
          <Input placeholder="user@example.com" disabled={loading} />
        </Form.Item>

        <Form.Item label="Status" name="status" rules={[{ required: true }]}>
          <Select
            disabled={loading}
            options={[
              { label: "Active", value: "Active" },
              { label: "Inactive", value: "Inactive" },
            ]}
          />
        </Form.Item>

        <Form.Item label="Role" name="role" rules={[{ required: true }]}>
          <Select
            disabled={loading}
            options={[
              { label: "Owner", value: "Owner" },
              { label: "Viewer", value: "Viewer" },
            ]}
          />
        </Form.Item>

        <Form.Item label="Start Date" name="startDate">
          <DatePicker format="DD-MM-YYYY" allowClear disabled={loading} style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item
          label="End Date"
          name="endDate"
          dependencies={["startDate"]}
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                const startDate = getFieldValue("startDate");

                if (!value || !startDate || !value.isBefore(startDate, "day")) {
                  return Promise.resolve();
                }

                return Promise.reject(
                  new Error("End Date cannot be earlier than Start Date."),
                );
              },
            }),
          ]}
        >
          <DatePicker format="DD-MM-YYYY" allowClear disabled={loading} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
