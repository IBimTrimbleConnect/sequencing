import React from "react";
import { Button, Form, Input, Modal } from "antd";

const CreatePlanModal = ({
  open,
  form,
  planName,
  onCreate,
  onCancel,
}) => (
  <Modal
    title="Create New Plan"
    open={open}
    onCancel={onCancel}
    footer={null}
    destroyOnHidden
    styles={{
      header: { padding: 0, marginBottom: 12 },
      body: { padding: 0 },
    }}
  >
    <Form
      form={form}
      autoComplete="off"
      layout="vertical"
      onFinish={onCreate}
    >
      <Form.Item
        name="planName"
        style={{ marginBottom: 12 }}
        rules={[
          {
            required: true,
            whitespace: true,
            message: "Please enter plan name.",
          },
        ]}
      >
        <Input placeholder="Plan Name" autoFocus />
      </Form.Item>

      <Form.Item style={{ marginBottom: 0 }}>
        <Button
          type="primary"
          htmlType="submit"
          disabled={!planName?.trim()}
        >
          Create
        </Button>
      </Form.Item>
    </Form>
  </Modal>
);

export default React.memo(CreatePlanModal);
