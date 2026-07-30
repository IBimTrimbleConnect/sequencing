import React, { useEffect, useState } from "react";
import { Modal, Form, Input, Button } from "antd";
import { Colorpicker } from "antd-colorpicker";
import { useDispatch, useSelector } from "react-redux";
import {
  CreateSubPlanRequest,
  UpdateSubPlanRequest,
} from "../store/sequence/action";

const SubPlanModal = ({
  title,
  buttonName,
  plan,
  open,
  onCancel,
  isEditing,
}) => {
  const dispatch = useDispatch();
  const [form] = Form.useForm();

  const subPlans = useSelector((state) => state.sequence.subPlans);
  const sequenceObjects = useSelector(
    (state) => state.sequence.sequenceObjects,
  );
  const phaseCommentId = useSelector((state) => state.sequence.phaseCommentId);

  const [colorDialog, setColorDialog] = useState(false);
  const [color, setColor] = useState({
    rgb: {
      r: 248,
      g: 28,
      b: 234,
    },
  });

  useEffect(() => {
    if (open) {
      if (isEditing && plan) {
        form.setFieldsValue({
          planName: plan.name,
        });

        setColor({
          rgb: plan.color || {
            r: 248,
            g: 28,
            b: 234,
          },
        });
      } else {
        form.resetFields();
        setColor({
          rgb: {
            r: 248,
            g: 28,
            b: 234,
          },
        });
      }
    }
  }, [open, isEditing, plan, form]);

  const handleSubmit = async () => {
    const values = await form.validateFields();

    if (isEditing) {
      const newSubPlans = subPlans.map((x) =>
        x.id !== plan.id
          ? x
          : {
              ...x,
              name: values.planName,
              color: color.rgb,
            },
      );

      dispatch(
        UpdateSubPlanRequest({
          subPlans: newSubPlans,
        }),
      );
    } else {
      dispatch(
        CreateSubPlanRequest({
          name: values.planName,
          color: color.rgb,
          check: false,
          phaseFolderId: plan.id,
          phaseCommentId,
          subPlans: subPlans,
          sequenceObjects,
        }),
      );
    }

    form.resetFields();
    onCancel?.();
  };

  return (
    <>
      <Modal
        title="Color"
        open={colorDialog}
        footer={null}
        width="fit-content"
        onCancel={() => setColorDialog(false)}
      >
        <Colorpicker value={color} onChange={setColor} />
      </Modal>

      <Modal
        title={title}
        open={open}
        onCancel={() => {
          form.resetFields();
          onCancel?.();
        }}
        footer={null}
        styles={{
          header: {
            padding: 0,
            marginBottom: 0,
          },
          body: {
            padding: 0,
          },
        }}
      >
        <Form form={form} autoComplete="off" layout="vertical">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              columnGap: 6,
            }}
          >
            <Form.Item
              name="planName"
              style={{ marginBottom: 2, flex: 1 }}
              rules={[
                {
                  required: true,
                  message: "Please enter sub plan name",
                },
              ]}
            >
              <Input placeholder="Sub Plan Name" />
            </Form.Item>

            <div
              onClick={() => setColorDialog(true)}
              style={{
                width: 32,
                height: 32,
                cursor: "pointer",
                border: "1px solid #d9d9d9",
                borderRadius: 4,
                background: `rgb(${color.rgb.r ?? 0}, ${color.rgb.g ?? 0}, ${
                  color.rgb.b ?? 0
                })`,
              }}
            />
          </div>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" onClick={handleSubmit}>
              {buttonName}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default SubPlanModal;
