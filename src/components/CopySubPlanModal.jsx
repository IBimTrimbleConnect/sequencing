import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Modal, Select, Space, message } from "antd";

import { useDispatch, useSelector } from "react-redux";

import { CopySequenceRequest } from "../store/sequence/action";

const CopySubPlanModal = ({ selectedPlan, open, onCancel }) => {
  const dispatch = useDispatch();

  const plans = useSelector((state) => state.sequence.plans || []);

  const subPlans = useSelector((state) => state.sequence.subPlans || []);

  const projectId = useSelector((state) => state.sequence.projectId || "");

  const loading = useSelector((state) => state.sequence.pending);

  const [sourcePlanId, setSourcePlanId] = useState(null);

  /*
   * Only show plans other than
   * the current target plan.
   */
  const sourcePlanOptions = useMemo(
    () =>
      plans
        .filter(
          (plan) =>
            plan?.id != null && String(plan.id) !== String(selectedPlan?.id),
        )
        .map((plan) => ({
          label: plan.name || "Unnamed Plan",

          value: String(plan.id),
        })),
    [plans, selectedPlan?.id],
  );

  /*
   * Get all SubPlans belonging
   * to the selected source Plan.
   */
  const sourceSubPlans = useMemo(() => {
    if (!sourcePlanId) {
      return [];
    }

    return subPlans.filter(
      (subPlan) => String(subPlan?.planId) === String(sourcePlanId),
    );
  }, [sourcePlanId, subPlans]);

  const closeModal = useCallback(() => {
    setSourcePlanId(null);
    onCancel?.();
  }, [onCancel]);

  useEffect(() => {
    if (!open) {
      setSourcePlanId(null);
    }
  }, [open]);

  const handleCopy = useCallback(() => {
    if (!projectId) {
      message.error("Unable to retrieve the current Trimble project ID.");

      return;
    }

    if (!selectedPlan?.id) {
      message.error("Unable to retrieve the target Plan.");

      return;
    }

    if (!sourcePlanId) {
      message.warning("Please select a source Plan.");

      return;
    }

    if (!sourceSubPlans.length) {
      message.warning(
        "The selected source Plan does not contain any SubPlans.",
      );

      return;
    }

    /*
     * Keep sourceSubPlanId.
     * It is required to copy Sequence Objects
     * from the source SubPlan to the new SubPlan.
     */
    const subPlansToCopy = sourceSubPlans.map((subPlan) => ({
      sourceSubPlanId: subPlan.id,

      name: subPlan.name,

      color: subPlan.color || null,

      sortDatetime: subPlan.sortDatetime || subPlan.sort_datetime || null,
    }));

    dispatch(
      CopySequenceRequest({
        projectId,
        targetPlanId: selectedPlan.id,

        subPlansToCopy: sourceSubPlans.map((sp) => ({
          sourceSubPlanId: sp.id,
          name: sp.name,
          color: sp.color,
        })),
      }),
    );

    closeModal();
  }, [
    closeModal,
    dispatch,
    projectId,
    selectedPlan?.id,
    sourcePlanId,
    sourceSubPlans,
  ]);

  return (
    <Modal
      title="Copy Sub Plans"
      open={open}
      onCancel={closeModal}
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
      <Space
        direction="vertical"
        size={12}
        style={{
          width: "100%",
        }}
      >
        <Select
          style={{
            width: "100%",
          }}
          placeholder="Select source Plan"
          value={sourcePlanId}
          loading={loading}
          disabled={loading || !selectedPlan?.id}
          allowClear
          showSearch
          optionFilterProp="label"
          options={sourcePlanOptions}
          onChange={(value) => {
            setSourcePlanId(value || null);
          }}
        />

        {sourcePlanId && (
          <div
            style={{
              fontSize: 12,
              opacity: 0.65,
            }}
          >
            {sourceSubPlans.length} SubPlan
            {sourceSubPlans.length === 1 ? "" : "s"} will be copied.
          </div>
        )}

        <Button
          type="primary"
          block
          disabled={!sourcePlanId || !sourceSubPlans.length}
          loading={loading}
          onClick={handleCopy}
        >
          Copy
        </Button>
      </Space>
    </Modal>
  );
};

export default React.memo(CopySubPlanModal);
