import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { Collapse, Button, Modal, Form, Input, Spin, message } from "antd";

import * as WorkspaceAPI from "trimble-connect-workspace-api";

import { DeletePlanRequest, UpdatePlanRequest } from "../store/sequence/action";

import SubPlanModal from "./SubPlanModal";
import SubPlanCollapse from "./SubPlanCollapse";
import SortableHeader from "./SortableHeader";
import CopySubPlanModal from "./CopySubPlanModal";
import { createUtcSortDate, getMovedItemSortDatetime } from "../utils/sortDate";

const Main = ({ isOwner = false }) => {
  const dispatch = useDispatch();
  const [form] = Form.useForm();

  const plans = useSelector((state) => state.sequence.plans || []);

  const sequenceObjects = useSelector(
    (state) => state.sequence.sequenceObjects || [],
  );

  const loading = useSelector((state) => state.sequence.pending);

  const activeSimulationItem = useSelector(
    (state) => state.sequence.activeSimulationItem,
  );

  const [isEditFormOpen, setIsEditFormOpen] = useState(false);

  const [isCreateSubPlanOpen, setIsCreateSubPlanOpen] = useState(false);

  const [isCopySubPlanOpen, setIsCopySubPlanOpen] = useState(false);

  const [planName, setPlanName] = useState("");

  const [selectedPlan, setSelectedPlan] = useState(null);

  const [activePlanKeys, setActivePlanKeys] = useState([]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  /*
   * Automatically expand the active plan
   * during simulation.
   */
  useEffect(() => {
    if (!plans.length) {
      return;
    }

    if (!activeSimulationItem?.planId) {
      return;
    }

    const planKey = String(activeSimulationItem.planId);

    const exists = plans.some((plan) => String(plan.id) === planKey);

    if (!exists) {
      return;
    }

    setActivePlanKeys((previousKeys) => {
      const keys = previousKeys.map(String);

      if (keys.includes(planKey)) {
        return keys;
      }

      return [...keys, planKey];
    });
  }, [plans, activeSimulationItem?.planId]);

  /*
   * Reorder plans.
   *
   * The saga updates sort_datetime
   * for every plan in Supabase.
   */
  const handleDragEnd = useCallback(
    ({ active, over }) => {
      if (!isOwner) {
        return;
      }

      if (!over || String(active.id) === String(over.id)) {
        return;
      }

      const oldIndex = plans.findIndex(
        (plan) => String(plan.id) === String(active.id),
      );

      const newIndex = plans.findIndex(
        (plan) => String(plan.id) === String(over.id),
      );

      if (oldIndex === -1 || newIndex === -1) {
        return;
      }

      /*
       * This array is only used to determine
       * the new adjacent Plans.
       */
      const reorderedPlans = arrayMove(plans, oldIndex, newIndex);

      const movedPlan = reorderedPlans[newIndex];

      const previousPlan = newIndex > 0 ? reorderedPlans[newIndex - 1] : null;

      const nextPlan =
        newIndex < reorderedPlans.length - 1
          ? reorderedPlans[newIndex + 1]
          : null;

      try {
        const sortDatetime = getMovedItemSortDatetime({
          previousItem: previousPlan,
          nextItem: nextPlan,
        });

        dispatch(
          UpdatePlanRequest({
            id: movedPlan.id,
            sortDatetime,
          }),
        );
      } catch (error) {
        console.error("Failed to calculate Plan order:", error);

        message.error(error?.message || "Unable to reorder the Plan.");
      }
    },
    [dispatch, isOwner, plans],
  );

  const handleEdit = useCallback(
    (plan) => {
      if (!isOwner) {
        return;
      }

      setSelectedPlan(plan);
      setPlanName(plan?.name || "");

      form.setFieldsValue({
        planName: plan?.name || "",
      });

      setIsEditFormOpen(true);
    },
    [form, isOwner],
  );

  const handleAddSubPlan = useCallback(
    (plan) => {
      if (!isOwner) {
        return;
      }

      setSelectedPlan(plan);
      setIsCreateSubPlanOpen(true);
    },
    [isOwner],
  );

  const handleCopySubPlan = useCallback(
    (plan) => {
      if (!isOwner) {
        return;
      }

      setSelectedPlan(plan);
      setIsCopySubPlanOpen(true);
    },
    [isOwner],
  );

  /*
   * Supabase only requires the plan ID.
   *
   * Foreign keys with ON DELETE CASCADE
   * remove related subplans and objects.
   */
  const handleDelete = useCallback(
    (plan) => {
      if (!isOwner || !plan?.id) {
        return;
      }

      dispatch(
        DeletePlanRequest({
          planId: plan.id,
        }),
      );
    },
    [dispatch, isOwner],
  );

  /*
   * Update only the selected plan.
   */
  const handleModifyName = useCallback(async () => {
    try {
      if (!isOwner || !selectedPlan?.id) {
        return;
      }

      const values = await form.validateFields();

      const trimmedPlanName = values.planName.trim();

      dispatch(
        UpdatePlanRequest({
          id: selectedPlan.id,
          name: trimmedPlanName,
        }),
      );

      setIsEditFormOpen(false);
      setSelectedPlan(null);
      setPlanName("");
      form.resetFields();
    } catch (error) {
      if (!error?.errorFields) {
        console.error("Failed to update plan:", error);

        message.error(error?.message || "Unable to update the plan.");
      }
    }
  }, [dispatch, form, isOwner, selectedPlan]);

  const handleCloseEditModal = useCallback(() => {
    setIsEditFormOpen(false);
    setSelectedPlan(null);
    setPlanName("");
    form.resetFields();
  }, [form]);

  const handlePlanCollapseChange = useCallback((activeKeys) => {
    const keys = Array.isArray(activeKeys)
      ? activeKeys.map(String)
      : activeKeys
        ? [String(activeKeys)]
        : [];

    setActivePlanKeys(keys);
  }, []);

  const handleHighlightObject = useCallback(
    async (plan) => {
      try {
        if (!plan?.id) {
          return;
        }

        const tcapi = await WorkspaceAPI.connect(window.parent);

        const objects = sequenceObjects
          .filter((group) => group && String(group.planId) === String(plan.id))
          .flatMap((group) =>
            Array.isArray(group.objects) ? group.objects : [],
          );

        if (!objects.length) {
          await tcapi.viewer.setSelection(
            {
              modelObjectIds: [],
            },
            "set",
          );

          message.warning("No objects were found in this plan.");

          return;
        }

        const modelGroups = new Map();

        for (const object of objects) {
          const modelId = object?.modelId;

          const runtimeId = Number(object?.runtimeId ?? object?.id);

          if (modelId == null || !Number.isFinite(runtimeId)) {
            continue;
          }

          const modelKey = String(modelId);

          if (!modelGroups.has(modelKey)) {
            modelGroups.set(modelKey, {
              modelId,
              objectRuntimeIds: new Set(),
            });
          }

          modelGroups.get(modelKey).objectRuntimeIds.add(runtimeId);
        }

        const modelObjectIds = [...modelGroups.values()]
          .map((group) => ({
            modelId: group.modelId,
            objectRuntimeIds: [...group.objectRuntimeIds],
          }))
          .filter((group) => group.objectRuntimeIds.length > 0);

        if (!modelObjectIds.length) {
          await tcapi.viewer.setSelection(
            {
              modelObjectIds: [],
            },
            "set",
          );

          message.warning(
            "The objects could not be resolved in the current model version.",
          );

          return;
        }

        await tcapi.viewer.setSelection(
          {
            modelObjectIds,
          },
          "set",
        );
      } catch (error) {
        console.error("Failed to highlight plan objects:", error);

        message.error("Unable to highlight the plan objects.");
      }
    },
    [sequenceObjects],
  );

  const collapseItems = useMemo(
    () =>
      plans.map((plan) => ({
        key: String(plan.id),

        label: (
          <SortableHeader
            plan={plan}
            isOwner={isOwner}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onAddSubPlan={handleAddSubPlan}
            onCopySubPlan={handleCopySubPlan}
            onHighlightObject={handleHighlightObject}
          />
        ),

        children: (
          <SubPlanCollapse
            plan={plan}
            activeSimulationItem={activeSimulationItem}
            isOwner={isOwner}
            readOnly={!isOwner}
          />
        ),
      })),
    [
      plans,
      activeSimulationItem,
      isOwner,
      handleEdit,
      handleDelete,
      handleAddSubPlan,
      handleCopySubPlan,
      handleHighlightObject,
    ],
  );

  return (
    <>
      {isOwner && (
        <>
          <CopySubPlanModal
            selectedPlan={selectedPlan}
            open={isCopySubPlanOpen}
            onCancel={() => {
              setIsCopySubPlanOpen(false);
              setSelectedPlan(null);
            }}
          />

          <SubPlanModal
            title="Create Sub Plan"
            buttonName="Create"
            plan={selectedPlan}
            open={isCreateSubPlanOpen}
            onCancel={() => {
              setIsCreateSubPlanOpen(false);
              setSelectedPlan(null);
            }}
          />
        </>
      )}

      <Modal
        title="Edit Plan Name"
        open={isOwner && isEditFormOpen}
        footer={null}
        onCancel={handleCloseEditModal}
        destroyOnHidden
      >
        <Form form={form} autoComplete="off" onFinish={handleModifyName}>
          <Form.Item
            name="planName"
            rules={[
              {
                required: true,
                whitespace: true,
                message: "Please enter the plan name.",
              },
            ]}
          >
            <Input
              placeholder="Plan Name"
              value={planName}
              onChange={(event) => setPlanName(event.target.value)}
            />
          </Form.Item>

          <Form.Item
            style={{
              marginBottom: 0,
            }}
          >
            <Button
              type="primary"
              htmlType="submit"
              disabled={!planName.trim()}
            >
              Modify
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      <Spin spinning={loading}>
        <DndContext
          sensors={isOwner ? sensors : []}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={plans.map((plan) => String(plan.id))}
            strategy={verticalListSortingStrategy}
          >
            <Collapse
              activeKey={activePlanKeys}
              size="small"
              items={collapseItems}
              onChange={handlePlanCollapseChange}
              style={{
                borderRadius: 0,
              }}
              styles={{
                header: {
                  padding: "4px 8px",
                  alignItems: "center",
                },
                body: {
                  padding: 8,
                },
              }}
            />
          </SortableContext>
        </DndContext>
      </Spin>
    </>
  );
};

export default React.memo(Main);
