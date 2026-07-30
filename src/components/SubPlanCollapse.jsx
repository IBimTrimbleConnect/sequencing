import React, { useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Collapse, Empty, Spin, App } from "antd";
import dayjs from "dayjs";
import * as WorkspaceAPI from "trimble-connect-workspace-api";

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

import SortableHeader from "./SortableHeader";

import {
  DeleteSubPlanRequest,
  UpdateSubPlanRequest,
  SetObjectsRequest,
} from "../store/sequence/action";

import SubPlanModal from "./SubPlanModal";
import SequenceObjectCollapse from "./SequenceObjectCollapse";

const math = require("mathjs");

const getRgbColor = (color) => {
  if (!color) return undefined;
  return `rgb(${color.r ?? 0}, ${color.g ?? 0}, ${color.b ?? 0})`;
};

const SubPlanCollapse = ({ plan, activeSimulationItem }) => {
  const dispatch = useDispatch();
  const { message } = App.useApp();

  const subPlans = useSelector((state) => state.sequence.subPlans);
  const sequenceObjects = useSelector(
    (state) => state.sequence.sequenceObjects,
  );
  const loading = useSelector((state) => state.sequence.pending);

  const [isEditFormOpen, setIsEditFormOpen] = React.useState(false);
  const [selectedSubPlan, setSelectedSubPlan] = React.useState(null);
  const [activeKeys, setActiveKeys] = React.useState([]);

  const messageListenerRef = useRef(null);
  const keyListenerRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const currentSubPlans = useMemo(() => {
    return subPlans.filter((x) => String(x.planId) === String(plan.id));
  }, [subPlans, plan.id]);

  useEffect(() => {
    if (!activeSimulationItem?.subPlanId) return;

    const subPlanKey = String(activeSimulationItem.subPlanId);

    const isSubPlanInThisPlan = currentSubPlans.some(
      (x) => String(x.id) === subPlanKey,
    );

    if (!isSubPlanInThisPlan) return;

    const timer = setTimeout(() => {
      setActiveKeys([subPlanKey]);
    }, 100);

    return () => clearTimeout(timer);
  }, [activeSimulationItem, currentSubPlans]);

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;

    const oldIndex = currentSubPlans.findIndex(
      (x) => String(x.id) === String(active.id),
    );

    const newIndex = currentSubPlans.findIndex(
      (x) => String(x.id) === String(over.id),
    );

    if (oldIndex === -1 || newIndex === -1) return;

    const sortedCurrentSubPlans = arrayMove(
      currentSubPlans,
      oldIndex,
      newIndex,
    );

    dispatch(
      UpdateSubPlanRequest({
        subPlans: sortedCurrentSubPlans,
      }),
    );
  };

  const handleEdit = (subPlan) => {
    setSelectedSubPlan(subPlan);
    setIsEditFormOpen(true);
  };

  const handleAssignObject = async (subPlan) => {
    try {
      const tcapi = await WorkspaceAPI.connect(window.parent);

      // const settings = await tcapi.project.getSettings();
      // const formatting = settings?.formatting || {};

      const selections = await tcapi.viewer.getSelection();

      if (!selections?.length) return;

      tcapi.viewer.activateTool("pointMarkup");

      const onMessage = async (event) => {
        if (event.data.event !== "viewer.onMarkupChanged") return;

        window.removeEventListener("message", onMessage);

        try {
          const start = event.data?.data?.data?.markup?.start;

          if (!start) {
            return;
          }

          const refPoint = [
            Number(start.positionX),
            Number(start.positionY),
            Number(start.positionZ),
          ];

          const newAddedSequenceObjects = [];

          const createObjectKey = (modelId, objectId) =>
            `${String(modelId)}::${String(objectId)}`;

          const existingObjectKeys = new Set();

          sequenceObjects.forEach((group) => {
            (group?.objects || []).forEach((obj) => {
              if (obj?.modelId == null || obj?.id == null) {
                return;
              }

              existingObjectKeys.add(createObjectKey(obj.modelId, obj.id));
            });
          });

          const newObjectKeys = new Set();

          await tcapi.viewer.activateTool("selection");

          let duplicateCount = 0;

          for (const selection of selections) {
            const objBoxes = await tcapi.viewer.getObjectBoundingBoxes(
              selection.modelId,
              selection.objectRuntimeIds,
            );

            const items = await tcapi.viewer.getObjectProperties(
              selection.modelId,
              selection.objectRuntimeIds,
            );

            for (let i = 0; i < objBoxes.length; i++) {
              const box = objBoxes[i];
              const objectId = box?.id ?? selection.objectRuntimeIds?.[i];

              if (objectId == null) {
                continue;
              }

              const objectKey = createObjectKey(selection.modelId, objectId);

              if (
                existingObjectKeys.has(objectKey) ||
                newObjectKeys.has(objectKey)
              ) {
                duplicateCount++;
                continue;
              }

              newObjectKeys.add(objectKey);

              const center = math.divide(
                math.add(
                  [
                    Number(1000 * box.boundingBox.min.x).toFixed(0),
                    Number(1000 * box.boundingBox.min.y).toFixed(0),
                    Number(1000 * box.boundingBox.min.z).toFixed(0),
                  ],
                  [
                    Number(1000 * box.boundingBox.max.x).toFixed(0),
                    Number(1000 * box.boundingBox.max.y).toFixed(0),
                    Number(1000 * box.boundingBox.max.z).toFixed(0),
                  ],
                ),
                2,
              );

              const properties = items[i]?.properties || [];

              let asmName = items[i]?.product?.name || "";
              let asmPos = "";
              let positionCode = "";
              let weight = 0;
              let asmLength = 0;

              let cogX = null;
              let cogY = null;
              let cogZ = null;

              const isCompleted = () =>
                asmPos !== "" &&
                positionCode !== "" &&
                weight !== 0 &&
                asmName !== "" &&
                asmLength !== 0 &&
                cogX !== null &&
                cogY !== null &&
                cogZ !== null;

              for (const property of properties) {
                const propertyName = String(property.name || "")
                  .toUpperCase()
                  .trim();

                for (const asmProperty of property.properties || []) {
                  if (isCompleted()) {
                    break;
                  }

                  const name = String(asmProperty.name || "").trim();
                  const upperName = name.toUpperCase();
                  const value = asmProperty.value;

                  if (
                    !asmPos &&
                    (name === "Assembly/Cast unit Mark" ||
                      upperName === "ASSEMBLY_POS")
                  ) {
                    asmPos = String(value || "")
                      .replace("(?)", "")
                      .trim();

                    continue;
                  }

                  if (
                    !positionCode &&
                    (name === "Assembly/Cast unit position code" ||
                      upperName === "ASSEMBLY_POSITION_CODE")
                  ) {
                    positionCode = String(value || "").trim();
                    continue;
                  }

                  if (
                    !weight &&
                    upperName.includes("WEIGHT") &&
                    value != null
                  ) {
                    weight = Number(value);
                    continue;
                  }

                  if (!asmName && upperName.includes("NAME") && value != null) {
                    asmName = String(value).trim();
                    continue;
                  }

                  if (
                    !asmLength &&
                    upperName.includes("LENGTH") &&
                    value != null
                  ) {
                    asmLength = Number(value).toFixed(0);
                  }

                  if (
                    cogX === null &&
                    (upperName.includes("GRAVITY X") ||
                      upperName.includes("GRAVITYX") || upperName.includes("OX"))
                  ) {
                    cogX = Number(value).toFixed(0);
                    continue;
                  }

                  if (
                    cogY === null &&
                    (upperName.includes("GRAVITY Y") ||
                      upperName.includes("GRAVITYY") || upperName.includes("OY"))
                  ) {
                    cogY = Number(value).toFixed(0);
                    continue;
                  }

                  if (
                    cogZ === null &&
                    (upperName.includes("GRAVITY Z") ||
                      upperName.includes("GRAVITYZ") || upperName.includes("OZ"))
                  ) {
                    cogZ = Number(value).toFixed(0);
                  }
                }

                if (isCompleted()) {
                  break;
                }
              }

              const distance = math.distance(refPoint, center);

              newAddedSequenceObjects.push({
                modelId: selection.modelId,
                subPlanId: subPlan.id,
                planId: plan.id,
                id: objectId,
                cog: [cogX, cogY, cogZ],

                distance: math.round(distance),
                center,

                asmPos,
                date: dayjs().format("DD-MM-YYYY"),

                weight,

                length: asmLength,

                name: asmName,
                positionCode,
              });
            }
          }

          await tcapi.markup.removeMarkups(undefined);

          if (duplicateCount > 0) {
            message.warning(
              `${duplicateCount} object(s) have already been existing in the plan.`,
            );
          }

          if (!newAddedSequenceObjects.length) {
            return;
          }

          newAddedSequenceObjects.sort(
            (a, b) => Number(a.distance) - Number(b.distance),
          );

          const existingObjects =
            sequenceObjects.find(
              (group) =>
                group && String(group.subPlanId) === String(subPlan.id),
            )?.objects ?? [];

          const newObjects = [...existingObjects, ...newAddedSequenceObjects];

          const newAssignedObjects = newObjects.map((object) => ({
            asmPos: object.asmPos,
            date: object.date,
            id: object.id,
            modelId: object.modelId,
            planId: object.planId,
            subPlanId: object.subPlanId,
            positionCode: object.positionCode,
            cog: object.cog,

            weight: object.weight,

            length: object.length,

            name: object.name,

            distance: object.distance,
            center: object.center,
            camera: object.camera,
          }));

          dispatch(
            SetObjectsRequest({
              subPlanId: subPlan.id,
              objects: newAssignedObjects,
            }),
          );
        } catch (error) {
          console.error("Assign object failed:", error);
          message.error("Assign object failed.");
        }
      };

      window.addEventListener("message", onMessage);
    } catch (error) {
      console.error("Start assign object failed:", error);
      message.error("Cannot start assigning objects.");
    }
  };

  const stopAutoAssign = () => {
    if (messageListenerRef.current) {
      window.removeEventListener("message", messageListenerRef.current);
      messageListenerRef.current = null;
    }

    if (keyListenerRef.current) {
      window.removeEventListener("keydown", keyListenerRef.current);
      keyListenerRef.current = null;
    }

    console.log("Auto assign stopped");
  };

  const handleAutoAssign = async (subPlan) => {
    try {
      const tcapi = await WorkspaceAPI.connect(window.parent);

      // const settings = await tcapi.project.getSettings();
      // const formatting = settings?.formatting || {};

      const selections = await tcapi.viewer.getSelection();

      if (!selections?.length) return;

      const createObjectKey = (modelId, objectId) =>
        `${String(modelId)}::${String(objectId)}`;

      const parseNumericValue = (value) => {
        if (typeof value === "number") {
          return Number.isFinite(value) ? value : null;
        }

        if (value == null) {
          return null;
        }

        const parsed = Number.parseFloat(
          String(value).replace(/,/g, "").trim(),
        );

        return Number.isFinite(parsed) ? parsed : null;
      };

      const existingObjectKeys = new Set();

      sequenceObjects.forEach((group) => {
        (group?.objects || []).forEach((obj) => {
          if (obj?.modelId == null || obj?.id == null) return;

          existingObjectKeys.add(createObjectKey(obj.modelId, obj.id));
        });
      });

      const newObjectKeys = new Set();

      const newAddedSequenceObjects = [];
      let duplicateCount = 0;

      for (const selection of selections) {
        const items = await tcapi.viewer.getObjectProperties(
          selection.modelId,
          selection.objectRuntimeIds,
        );

        for (let i = 0; i < items.length; i++) {
          const objectId = selection.objectRuntimeIds?.[i];

          if (objectId == null) {
            continue;
          }

          const objectKey = createObjectKey(selection.modelId, objectId);

          if (
            existingObjectKeys.has(objectKey) ||
            newObjectKeys.has(objectKey)
          ) {
            console.warn("Object has already been assigned.", {
              modelId: selection.modelId,
              objectId,
            });

            duplicateCount++;
            continue;
          }

          newObjectKeys.add(objectKey);

          const properties = items[i]?.properties || [];

          let asmName = items[i]?.product?.name || "";
          let asmPos = "";
          let positionCode = "";
          let weight = 0;
          let asmLength = 0;

          let cogX = null;
          let cogY = null;
          let cogZ = null;

          const isCompleted = () =>
            asmPos !== "" &&
            positionCode !== "" &&
            weight !== 0 &&
            asmName !== "" &&
            asmLength !== 0 &&
            cogX !== null &&
            cogY !== null &&
            cogZ !== null;

          for (const property of properties) {
            const propertyName = String(property.name || "")
              .toUpperCase()
              .trim();

            for (const asmProperty of property.properties || []) {
              if (isCompleted()) {
                break;
              }

              const name = String(asmProperty.name || "").trim();
              const upperName = name.toUpperCase();
              const value = asmProperty.value;
              console.log(upperName, value);
              if (
                !asmPos &&
                (name === "Assembly/Cast unit Mark" ||
                  upperName === "ASSEMBLY_POS")
              ) {
                asmPos = String(value || "")
                  .replace("(?)", "")
                  .trim();

                continue;
              }

              if (
                !positionCode &&
                (name === "Assembly/Cast unit position code" ||
                  upperName === "ASSEMBLY_POSITION_CODE")
              ) {
                positionCode = String(value || "").trim();
                continue;
              }

              if (!weight && upperName.includes("WEIGHT") && value != null) {
                weight = Number(value);
                continue;
              }

              if (!asmName && upperName.includes("NAME") && value != null) {
                asmName = String(value).trim();
                continue;
              }

              if (!asmLength && upperName.includes("LENGTH") && value != null) {
                asmLength = Number(value).toFixed(0);

                continue;
              }

              if (
                cogX === null &&
                (upperName.includes("GRAVITY X") ||
                  upperName.includes("GRAVITYX") || upperName.includes("OX"))
              ) {
                cogX = Number(value).toFixed(0);
                continue;
              }

              if (
                cogY === null &&
                (upperName.includes("GRAVITY Y") ||
                  upperName.includes("GRAVITYY") || upperName.includes("OY"))
              ) {
                cogY = Number(value).toFixed(0);
                continue;
              }

              if (
                cogZ === null &&
                (upperName.includes("GRAVITY Z") ||
                  upperName.includes("GRAVITYZ") || upperName.includes("OZ"))
              ) {
                cogZ = Number(value).toFixed(0);
              }
            }

            if (isCompleted()) {
              break;
            }
          }

          const cog =
            cogX !== null && cogY !== null && cogZ !== null
              ? [cogX, cogY, cogZ]
              : null;

          newAddedSequenceObjects.push({
            modelId: selection.modelId,
            subPlanId: subPlan.id,
            planId: plan.id,
            id: objectId,

            distance: 0,
            center: [0, 0, 0],

            asmPos,
            date: dayjs().format("DD-MM-YYYY"),

            cog,

            weight,

            length: asmLength,

            name: asmName,
            positionCode,
          });
        }
      }

      if (duplicateCount > 0) {
        message.warning(
          `${duplicateCount} object(s) have already been existing in the plan.`,
        );
      }

      if (!newAddedSequenceObjects.length) {
        return;
      }

      const existingObjects =
        sequenceObjects.find(
          (group) => group && String(group.subPlanId) === String(subPlan.id),
        )?.objects ?? [];

      const newObjects = [...existingObjects, ...newAddedSequenceObjects];

      const newAssignedObjects = newObjects.map((object) => ({
        asmPos: object.asmPos,
        date: object.date,
        id: object.id,
        modelId: object.modelId,
        planId: object.planId,
        subPlanId: object.subPlanId,
        positionCode: object.positionCode,

        cog:
          Array.isArray(object.cog) && object.cog.length === 3
            ? object.cog
            : null,


        weight: object.weight,

        length: object.length,

        name: object.name,

        distance: object.distance ?? 0,
        center: object.center ?? [0, 0, 0],
        camera: object.camera,
      }));

      dispatch(
        SetObjectsRequest({
          subPlanId: subPlan.id,
          objects: newAssignedObjects,
        }),
      );
    } catch (error) {
      console.error("Auto assign failed:", error);
      message.error("Auto assign failed.");
    }
  };

  const DATE_FORMATS = ["DD-MM-YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "YYYY/MM/DD"];

  const parseDate = (value) => {
    if (!value) {
      return null;
    }

    if (dayjs.isDayjs(value)) {
      return value.isValid() ? value : null;
    }

    const strictDate = dayjs(value, DATE_FORMATS, true);

    if (strictDate.isValid()) {
      return strictDate;
    }

    const normalDate = dayjs(value);

    return normalDate.isValid() ? normalDate : null;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const handleSimulation = async (subPlan) => {
    if (!subPlan?.id) {
      return;
    }

    const tcapi = await WorkspaceAPI.connect(window.parent);

    const subPlanId = String(subPlan.id);

    // 1) get all objects based on asigned date
    const items = [];

    sequenceObjects.forEach((group) => {
      if (!group) {
        return;
      }

      const groupSubPlanId = String(group.subPlanId ?? "");

      const objects = group.objects || [];

      objects.forEach((obj) => {
        const objSubPlanId = String(obj.subPlanId ?? groupSubPlanId ?? "");

        if (objSubPlanId !== subPlanId) {
          return;
        }

        const runtimeId = obj.id ?? obj.runtimeId ?? obj.objectRuntimeId;
        const modelId = obj.modelId || group.modelId;

        if (runtimeId == null || modelId == null) {
          return;
        }

        const parsedDate = parseDate(obj.assignedDate || obj.date);

        if (!parsedDate) {
          return;
        }

        items.push({
          modelId,
          runtimeId,
          simulationTime: parsedDate.valueOf(),
          camera: obj.camera,
        });
      });
    });

    if (!items.length) {
      return;
    }

    items.sort((a, b) => a.simulationTime - b.simulationTime);

    // 2) get color
    const color = subPlan.color;

    // 3) Isolate objects
    const DELAY_MS = 200;

    const modelMap = new Map();

    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const modelKey = String(item.modelId);

        if (!modelMap.has(modelKey)) {
          modelMap.set(modelKey, {
            modelId: item.modelId,
            entityIds: [],
          });
        }

        modelMap.get(modelKey).entityIds.push(item.runtimeId);

        const accumulatedObjects = Array.from(modelMap.values()).map(
          (group) => ({
            ...group,
            entityIds: [...new Set(group.entityIds)],
          }),
        );

        // Isolate objects
        await tcapi.viewer.isolateEntities(
          accumulatedObjects.map((group) => ({
            modelId: group.modelId,
            entityIds: group.entityIds,
          })),
        );

        //Color objects
        if (color) {
          await tcapi.viewer.setObjectState(
            {
              modelObjectIds: [
                {
                  modelId: item.modelId,
                  objectRuntimeIds: [item.runtimeId],
                },
              ],
            },
            {
              color: {
                r: color.r,
                g: color.g,
                b: color.b,
              },
              visible: true,
            },
          );
        }

        if (item.camera) {
          await tcapi.viewer.setCamera(item.camera, {
            animationTime: 1000,
          });
        }

        if (index < items.length - 1) {
          await sleep(DELAY_MS);
        }
      }
    } catch (error) {
      console.error("handleSimulation error:", error);
    }
  };

  const handleSortByDate = (subPlan) => {
    const currentGroup = sequenceObjects.find(
      (group) => group && String(group.subPlanId) === String(subPlan.id),
    );

    const objects = currentGroup?.objects || [];

    const sortedObjects = [...objects].sort((a, b) => {
      const dateA = dayjs(
        a.date || a.assignedDate || "",
        ["DD-MM-YYYY", "DD/MM/YYYY", "YYYY-MM-DD"],
        true,
      );

      const dateB = dayjs(
        b.date || b.assignedDate || "",
        ["DD-MM-YYYY", "DD/MM/YYYY", "YYYY-MM-DD"],
        true,
      );

      if (!dateA.isValid() && !dateB.isValid()) return 0;
      if (!dateA.isValid()) return 1;
      if (!dateB.isValid()) return -1;

      return dateA.valueOf() - dateB.valueOf();
    });

    dispatch(
      SetObjectsRequest({
        subPlanId: subPlan.id,
        objects: sortedObjects,
      }),
    );
  };

  const handleHighlightObject = async (subPlan) => {
    try {
      const tcapi = await WorkspaceAPI.connect(window.parent);

      const currentGroup = sequenceObjects.find(
        (group) => group && String(group.subPlanId) === String(subPlan.id),
      );

      const objects = currentGroup?.objects || [];

      if (!objects.length) {
        await tcapi.viewer.setSelection(
          {
            modelObjectIds: [],
          },
          "set",
        );

        return;
      }

      // Group objects by modelId and prevent duplicate objectRuntimeIds.
      const modelGroups = new Map();

      for (const obj of objects) {
        if (obj?.modelId == null || obj?.id == null) {
          continue;
        }

        const modelId = String(obj.modelId);
        const objectId = Number(obj.id);

        if (!Number.isFinite(objectId)) {
          continue;
        }

        if (!modelGroups.has(modelId)) {
          modelGroups.set(modelId, {
            modelId: obj.modelId,
            objectRuntimeIds: new Set(),
          });
        }

        modelGroups.get(modelId).objectRuntimeIds.add(objectId);
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

        return;
      }

      await tcapi.viewer.setSelection(
        {
          modelObjectIds,
        },
        "set",
      );
    } catch (error) {
      console.error("Failed to highlight objects:", error);
    }
  };

  const getObjectKey = (obj) => {
    const runtimeId = obj.id || obj.runtimeId || obj.objectRuntimeId;

    return `${obj.modelId}-${runtimeId}`;
  };

  const getObjectDate = (obj) => {
    return obj.date || obj.assignedDate || "";
  };

  const displayIndexMap = useMemo(() => {
    const dateCounters = new Map();
    const objectIndexes = new Map();

    sequenceObjects.forEach((group) => {
      (group.objects || []).forEach((item, index) => {
        const dateKey = getObjectDate(item) || "NO_DATE";

        const dateIndex = (dateCounters.get(dateKey) || 0) + 1;

        dateCounters.set(dateKey, dateIndex);

        objectIndexes.set(getObjectKey(item), `${index + 1}-${dateIndex}`);
      });
    });

    return objectIndexes;
  }, [sequenceObjects, plan.id, subPlans]);

  useEffect(() => {
    return () => {
      stopAutoAssign();
    };
  }, []);

  const items = currentSubPlans.map((subPlan) => ({
    key: String(subPlan.id),
    label: (
      <SortableHeader
        plan={subPlan}
        onEdit={() => handleEdit(subPlan)}
        onDelete={(item) => {
          dispatch(
            DeleteSubPlanRequest({
              planId: plan.id,
              subPlanId: item.id,
              subPlans,
              sequenceObjects,
            }),
          );
        }}
        onAssignObject={() => handleAssignObject(subPlan)}
        onAutoAssign={() => handleAutoAssign(subPlan)}
        onSimulation={() => handleSimulation(subPlan)}
        onSortByDate={() => handleSortByDate(subPlan)}
        onHighlightObject={() => handleHighlightObject(subPlan)}
      />
    ),
    children: (
      <SequenceObjectCollapse
        subPlan={subPlan}
        activeSimulationItem={activeSimulationItem}
        displayIndexMap={displayIndexMap}
      />
    ),
    style: {
      background: getRgbColor(subPlan.color),
      borderRadius: 0,
      marginBottom: 4,
    },
  }));

  if (!currentSubPlans.length) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Sub Plan" />
    );
  }

  return (
    <>
      <SubPlanModal
        plan={selectedSubPlan}
        title="Edit Sub Plan"
        open={isEditFormOpen}
        onCancel={() => setIsEditFormOpen(false)}
        buttonName="Modify"
        isEditing={true}
      />

      <Spin spinning={loading}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={currentSubPlans.map((x) => String(x.id))}
            strategy={verticalListSortingStrategy}
          >
            <Collapse
              activeKey={activeKeys}
              onChange={(keys) => {
                const nextKeys = Array.isArray(keys)
                  ? keys.map(String)
                  : [String(keys)];

                setActiveKeys(nextKeys);
              }}
              size="small"
              items={items}
              style={{
                borderRadius: 0,
                marginRight: -10,
                marginTop: -10,
                marginBottom: -10,
                background: "transparent",
              }}
              styles={{
                header: {
                  marginLeft: 10,
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

export default SubPlanCollapse;
