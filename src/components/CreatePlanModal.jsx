import React, {
  useMemo,
} from "react";

import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
} from "antd";

const CreatePlanModal = ({
  open,
  form,
  onCreate,
  onCancel,
  loading = false,
}) => {
  const planName = Form.useWatch(
    "planName",
    form,
  );

  const startIndex = Form.useWatch(
    "startIndex",
    form,
  );

  const quantity = Form.useWatch(
    "quantity",
    form,
  );

  const previewNames = useMemo(() => {
    const baseName =
      String(
        planName || "",
      ).trim();

    const normalizedStartIndex =
      Number(startIndex);

    const normalizedQuantity =
      Number(quantity);

    if (
      !baseName ||
      !Number.isInteger(
        normalizedStartIndex,
      ) ||
      !Number.isInteger(
        normalizedQuantity,
      ) ||
      normalizedQuantity <= 0
    ) {
      return [];
    }

    const previewCount =
      Math.min(
        normalizedQuantity,
        10,
      );

    return Array.from(
      {
        length:
          previewCount,
      },
      (_, index) =>
        `${baseName} ${
          normalizedStartIndex +
          index
        }`,
    );
  }, [
    planName,
    startIndex,
    quantity,
  ]);

  const canSubmit =
    Boolean(
      String(
        planName || "",
      ).trim(),
    ) &&
    Number.isInteger(
      Number(
        startIndex,
      ),
    ) &&
    Number(startIndex) >= 0 &&
    Number.isInteger(
      Number(
        quantity,
      ),
    ) &&
    Number(quantity) >= 1 &&
    Number(quantity) <= 100;

  return (
    <Modal
      title="Create Multiple Plans"
      open={open}
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
      maskClosable={!loading}
      keyboard={!loading}
      closable={!loading}
      styles={{
        header: {
          padding: 0,
          marginBottom: 12,
        },

        body: {
          padding: 0,
        },
      }}
    >
      <Form
        form={form}
        autoComplete="off"
        layout="vertical"
        initialValues={{
          planName: "Plan",
          startIndex: 1,
          quantity: 1,
        }}
        onFinish={onCreate}
      >
        <Form.Item
          label="Name"
          name="planName"
          style={{
            marginBottom: 12,
          }}
          rules={[
            {
              required: true,
              whitespace: true,
              message:
                "Please enter the name.",
            },
          ]}
        >
          <Input
            placeholder="Example: Zone"
            autoFocus
            disabled={loading}
          />
        </Form.Item>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "1fr 1fr",
            gap: 12,
          }}
        >
          <Form.Item
            label="Start Index"
            name="startIndex"
            style={{
              marginBottom: 12,
            }}
            rules={[
              {
                required: true,
                message:
                  "Please enter the start index.",
              },
              {
                validator: (
                  _,
                  value,
                ) => {
                  const numberValue =
                    Number(value);

                  if (
                    Number.isInteger(
                      numberValue,
                    ) &&
                    numberValue >= 0
                  ) {
                    return Promise.resolve();
                  }

                  return Promise.reject(
                    new Error(
                      "Start index must be a whole number greater than or equal to 0.",
                    ),
                  );
                },
              },
            ]}
          >
            <InputNumber
              min={0}
              precision={0}
              disabled={loading}
              style={{
                width: "100%",
              }}
            />
          </Form.Item>

          <Form.Item
            label="Quantity"
            name="quantity"
            style={{
              marginBottom: 12,
            }}
            rules={[
              {
                required: true,
                message:
                  "Please enter the quantity.",
              },
              {
                validator: (
                  _,
                  value,
                ) => {
                  const numberValue =
                    Number(value);

                  if (
                    Number.isInteger(
                      numberValue,
                    ) &&
                    numberValue >= 1 &&
                    numberValue <= 100
                  ) {
                    return Promise.resolve();
                  }

                  return Promise.reject(
                    new Error(
                      "Quantity must be between 1 and 100.",
                    ),
                  );
                },
              },
            ]}
          >
            <InputNumber
              min={1}
              max={100}
              precision={0}
              disabled={loading}
              style={{
                width: "100%",
              }}
            />
          </Form.Item>
        </div>

        {previewNames.length > 0 && (
          <div
            style={{
              marginBottom: 16,
              padding: 10,
              border:
                "1px solid #f0f0f0",
              borderRadius: 6,
              background:
                "#fafafa",
            }}
          >
            <div
              style={{
                marginBottom: 6,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Preview
            </div>

            <div
              style={{
                display: "flex",
                flexDirection:
                  "column",
                gap: 3,
                maxHeight: 160,
                overflowY: "auto",
                fontSize: 12,
              }}
            >
              {previewNames.map(
                (name) => (
                  <span key={name}>
                    {name}
                  </span>
                ),
              )}

              {Number(quantity) >
                previewNames.length && (
                <span
                  style={{
                    opacity: 0.6,
                  }}
                >
                  ...and{" "}
                  {Number(
                    quantity,
                  ) -
                    previewNames.length}{" "}
                  more
                </span>
              )}
            </div>
          </div>
        )}

        <Form.Item
          style={{
            marginBottom: 0,
          }}
        >
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loading}
            disabled={
              loading ||
              !canSubmit
            }
          >
            {Number(quantity) > 1
              ? `Create ${quantity} Plans`
              : "Create Plan"}
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default React.memo(
  CreatePlanModal,
);
