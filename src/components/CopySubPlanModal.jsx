import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Modal, Select, Button, Space } from "antd";
import { CopySequenceRequest } from "../store/sequence/action";

const CopySubPlanModal = ({ selectedPlan, open, onCancel }) => {
  console.log("selectedPlan", selectedPlan);
  const dispatch = useDispatch();

  const plans = useSelector((state) => state.sequence.plans);
  const subPlans = useSelector((state) => state.sequence.subPlans);
  const phaseCommentId = useSelector((state) => state.sequence.phaseCommentId);
  const loading = useSelector((state) => state.sequence.pending);

  console.log("plans", plans);
  const [sourcePlanId, setSourcePlanId] = useState(null);

  const handleCopy = () => {
    if (!selectedPlan || !sourcePlanId) return;
    //Get all sub plans of the source plan
    const sourceSubPlans = subPlans.filter((sp) => sp.planId === sourcePlanId);
    const newSubPlans = sourceSubPlans.map((sp) => ({
      name: sp.name,
      color: sp.color,
    }));
    const payload = {
      newSubPlans: newSubPlans,
      planId: selectedPlan.id,
      subPlans: subPlans,
    };
    console.log(phaseCommentId, "phaseCommentId");
    dispatch(CopySequenceRequest(payload));
    setSourcePlanId(null);
    onCancel?.();
  };

  return (
    <Modal
      title="Copy Sub Plan"
      open={open}
      onCancel={() => {
        setSourcePlanId(null);
        onCancel?.();
      }}
      footer={null}
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
      <Space direction="vertical" style={{ width: "100%" }}>
        <Select
          style={{ width: "100%" }}
          placeholder="Select Plan"
          value={sourcePlanId}
          loading={loading}
          onChange={(value) => {
            setSourcePlanId(value);
          }}
          options={plans
            .filter((x) => x.id && x.id !== selectedPlan?.id)
            .map((x) => ({
              label: x.name,
              value: x.id,
            }))}
        />

        <Button
          type="primary"
          block
          disabled={!sourcePlanId}
          loading={loading}
          onClick={handleCopy}
        >
          Copy
        </Button>
      </Space>
    </Modal>
  );
};

export default CopySubPlanModal;
