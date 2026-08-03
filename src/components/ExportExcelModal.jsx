import React from "react";
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
} from "antd";

const ExportExcelModal = ({
  open,
  exporting,
  form,
  plans,
  onCancel,
  onConfirm,
}) => (
  <Modal
    title="Export Excel"
    open={open}
    onCancel={onCancel}
    onOk={onConfirm}
    okText="Export"
    cancelText="Cancel"
    confirmLoading={exporting}
    destroyOnHidden
    maskClosable={!exporting}
    closable={!exporting}
  >
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        fileName: "Sequencing Report",
        startDate: null,
        endDate: null,
        planIds: [],
      }}
    >
      <Form.Item
        label="File Name"
        name="fileName"
        rules={[
          {
            required: true,
            whitespace: true,
            message: "Please enter file name.",
          },
        ]}
      >
        <Input placeholder="Enter file name" maxLength={100} />
      </Form.Item>

      <Space style={{ width: "100%" }} size={16} align="start">
        <Form.Item
          label="Start Date"
          name="startDate"
          style={{ flex: 1 }}
        >
          <DatePicker
            style={{ width: "100%" }}
            format="DD-MM-YYYY"
            allowClear
          />
        </Form.Item>

        <Form.Item
          label="End Date"
          name="endDate"
          style={{ flex: 1 }}
          dependencies={["startDate"]}
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                const start = getFieldValue("startDate");

                if (!start || !value || !value.isBefore(start, "day")) {
                  return Promise.resolve();
                }

                return Promise.reject(
                  new Error(
                    "End Date must be greater than or equal to Start Date.",
                  ),
                );
              },
            }),
          ]}
        >
          <DatePicker
            style={{ width: "100%" }}
            format="DD-MM-YYYY"
            allowClear
          />
        </Form.Item>
      </Space>

      <Form.Item
        label="Plans"
        name="planIds"
        rules={[
          {
            required: true,
            type: "array",
            min: 1,
            message: "Please select at least one plan.",
          },
        ]}
      >
        <Select
          mode="multiple"
          allowClear
          showSearch
          maxTagCount="responsive"
          placeholder="Select plans"
          optionFilterProp="label"
          options={plans.map((plan) => ({
            value: String(plan.id),
            label: plan.name || "Unnamed Plan",
          }))}
        />
      </Form.Item>

      <Space style={{ marginTop: -12, marginBottom: 8 }}>
        <Button
          type="link"
          size="small"
          onClick={() => {
            form.setFieldValue(
              "planIds",
              plans.map((plan) => String(plan.id)),
            );
            form.validateFields(["planIds"]);
          }}
        >
          Select all
        </Button>

        <Button
          type="link"
          size="small"
          onClick={() => form.setFieldValue("planIds", [])}
        >
          Clear all
        </Button>
      </Space>
    </Form>
  </Modal>
);

export default React.memo(ExportExcelModal);
