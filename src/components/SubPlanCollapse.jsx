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
import { getMovedItemSortDatetime } from "../utils/sortDate";

const math = require("mathjs");

const getRgbColor = (color) => {
  if (!color) return undefined;
  return `rgb(${color.r ?? 0}, ${color.g ?? 0}, ${color.b ?? 0})`;
};

const SubPlanCollapse = ({ plan, activeSimulationItem }) => {
  const dispatch = useDispatch();
  const { message } = App.useApp();

  const projectId = useSelector((state) => state.sequence.projectId || "");
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
    return subPlans
      .filter((subPlan) => String(subPlan.planId) === String(plan.id))
      .sort((a, b) => {
        const timeA = new Date(a.sortDatetime || 0).getTime();

        const timeB = new Date(b.sortDatetime || 0).getTime();

        return timeA - timeB;
      });
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
    if (!over || String(active.id) === String(over.id)) {
      return;
    }

    const oldIndex = currentSubPlans.findIndex(
      (subPlan) => String(subPlan.id) === String(active.id),
    );

    const newIndex = currentSubPlans.findIndex(
      (subPlan) => String(subPlan.id) === String(over.id),
    );

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const reorderedSubPlans = arrayMove(currentSubPlans, oldIndex, newIndex);

    const movedSubPlan = reorderedSubPlans[newIndex];

    const previousSubPlan =
      newIndex > 0 ? reorderedSubPlans[newIndex - 1] : null;

    const nextSubPlan =
      newIndex < reorderedSubPlans.length - 1
        ? reorderedSubPlans[newIndex + 1]
        : null;

    try {
      const sortDatetime = getMovedItemSortDatetime({
        previousItem: previousSubPlan,
        nextItem: nextSubPlan,
      });

      dispatch(
        UpdateSubPlanRequest({
          id: movedSubPlan.id,
          sortDatetime,
        }),
      );
    } catch (error) {
      console.error("Failed to calculate SubPlan order:", error);

      message.error(error?.message || "Unable to reorder the SubPlan.");
    }
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
              const existingModelId =
                obj?.modelExternalId ?? obj?.model_external_id ?? obj?.modelId;

              const existingObjectId =
                obj?.externalId ?? obj?.external_id ?? obj?.id;

              if (existingModelId == null || existingObjectId == null) {
                return;
              }

              existingObjectKeys.add(
                createObjectKey(existingModelId, existingObjectId),
              );
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
              let runtimeId = box?.id ?? selection.objectRuntimeIds?.[i];

              if (runtimeId == null) {
                continue;
              }

              const objectIds = await tcapi.viewer.convertToObjectIds(
                selection.modelId,
                [runtimeId],
              );

              const objectId = objectIds?.[0];

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
                      upperName.includes("GRAVITYX") ||
                      upperName.includes("OX"))
                  ) {
                    cogX = Number(value).toFixed(0);
                    continue;
                  }

                  if (
                    cogY === null &&
                    (upperName.includes("GRAVITY Y") ||
                      upperName.includes("GRAVITYY") ||
                      upperName.includes("OY"))
                  ) {
                    cogY = Number(value).toFixed(0);
                    continue;
                  }

                  if (
                    cogZ === null &&
                    (upperName.includes("GRAVITY Z") ||
                      upperName.includes("GRAVITYZ") ||
                      upperName.includes("OZ"))
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
                modelExternalId: selection.modelId,
                externalId: objectId,
                runtimeId,
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
            assignedDate: object.assignedDate ?? object.date,
            id: object.id,
            externalId: object.externalId ?? object.id,
            modelId: object.modelId,
            modelExternalId: object.modelExternalId ?? object.modelId,
            runtimeId: object.runtimeId,
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
              projectId,
              planId: plan.id,
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

      const existingObjectKeys = new Set();

      sequenceObjects.forEach((group) => {
        (group?.objects || []).forEach((obj) => {
          const existingModelId =
            obj?.modelExternalId ?? obj?.model_external_id ?? obj?.modelId;

          const existingObjectId =
            obj?.externalId ?? obj?.external_id ?? obj?.id;

          if (existingModelId == null || existingObjectId == null) {
            return;
          }

          existingObjectKeys.add(
            createObjectKey(existingModelId, existingObjectId),
          );
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
          const runtimeId = selection.objectRuntimeIds?.[i];

          if (runtimeId == null) {
            continue;
          }

          const objectIds = await tcapi.viewer.convertToObjectIds(
            selection.modelId,
            [runtimeId],
          );

          const objectId = objectIds?.[0];

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
                  upperName.includes("GRAVITYX") ||
                  upperName.includes("OX"))
              ) {
                cogX = Number(value).toFixed(0);
                continue;
              }

              if (
                cogY === null &&
                (upperName.includes("GRAVITY Y") ||
                  upperName.includes("GRAVITYY") ||
                  upperName.includes("OY"))
              ) {
                cogY = Number(value).toFixed(0);
                continue;
              }

              if (
                cogZ === null &&
                (upperName.includes("GRAVITY Z") ||
                  upperName.includes("GRAVITYZ") ||
                  upperName.includes("OZ"))
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
            modelExternalId: selection.modelId,
            externalId: objectId,
            runtimeId,
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
        assignedDate: object.assignedDate ?? object.date,
        id: object.id,
        externalId: object.externalId ?? object.id,
        modelId: object.modelId,
        modelExternalId: object.modelExternalId ?? object.modelId,
        runtimeId: object.runtimeId,
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
          projectId,
          planId: plan.id,
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

    try {
      const tcapi = await WorkspaceAPI.connect(window.parent);
      const subPlanId = String(subPlan.id);

      /*
       * Gom Internal Object ID theo modelId.
       * obj.id hiện đang lưu Internal Object ID sau khi gọi convertToObjectIds().
       */
      const modelGroups = new Map();

      for (const group of sequenceObjects) {
        if (!group) {
          continue;
        }

        const groupSubPlanId = String(group.subPlanId ?? "");

        for (const obj of group.objects || []) {
          const objSubPlanId = String(obj.subPlanId ?? groupSubPlanId);

          if (objSubPlanId !== subPlanId) {
            continue;
          }

          const objectId = obj.id;
          const modelId = obj.modelId ?? group.modelId;
          const parsedDate = parseDate(obj.assignedDate || obj.date);

          if (objectId == null || modelId == null || !parsedDate) {
            continue;
          }

          const modelKey = String(modelId);

          if (!modelGroups.has(modelKey)) {
            modelGroups.set(modelKey, {
              modelId,
              objects: [],
            });
          }

          modelGroups.get(modelKey).objects.push({
            objectId,
            simulationTime: parsedDate.valueOf(),
            camera: obj.camera,
          });
        }
      }

      if (!modelGroups.size) {
        message.warning("No valid objects found for simulation.");
        return;
      }

      /*
       * Convert Internal Object IDs -> Runtime IDs theo từng model.
       * Convert một lần cho cả model thay vì gọi API cho từng object.
       */
      const items = [];

      for (const group of modelGroups.values()) {
        const uniqueObjectMap = new Map();

        for (const object of group.objects) {
          const objectKey = String(object.objectId);

          if (!uniqueObjectMap.has(objectKey)) {
            uniqueObjectMap.set(objectKey, object);
          }
        }

        const uniqueObjects = [...uniqueObjectMap.values()];
        const objectIds = uniqueObjects.map((object) => object.objectId);

        let runtimeIds = [];

        try {
          runtimeIds = await tcapi.viewer.convertToObjectRuntimeIds(
            group.modelId,
            objectIds,
          );
        } catch (error) {
          console.error("Failed to convert object IDs to runtime IDs:", {
            modelId: group.modelId,
            objectIds,
            error,
          });

          continue;
        }

        uniqueObjects.forEach((object, index) => {
          const runtimeId = runtimeIds?.[index];

          if (runtimeId == null) {
            console.warn("Runtime ID was not found:", {
              modelId: group.modelId,
              objectId: object.objectId,
            });

            return;
          }

          items.push({
            modelId: group.modelId,
            objectId: object.objectId,
            runtimeId,
            simulationTime: object.simulationTime,
            camera: object.camera,
          });
        });
      }

      if (!items.length) {
        message.warning("Cannot convert the selected objects to runtime IDs.");
        return;
      }

      /*
       * Sắp xếp theo ngày thi công.
       * Khi cùng ngày, giữ thứ tự hiện tại.
       */
      items.sort((a, b) => a.simulationTime - b.simulationTime);

      const color = subPlan.color;
      const DELAY_MS = 200;

      /*
       * Lưu các Runtime ID đã xuất hiện theo từng model
       * để isolate theo kiểu tích lũy.
       */
      const accumulatedModelMap = new Map();

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const modelKey = String(item.modelId);

        if (!accumulatedModelMap.has(modelKey)) {
          accumulatedModelMap.set(modelKey, {
            modelId: item.modelId,
            entityIds: new Set(),
          });
        }

        accumulatedModelMap.get(modelKey).entityIds.add(item.runtimeId);

        const accumulatedObjects = [...accumulatedModelMap.values()].map(
          (group) => ({
            modelId: group.modelId,
            entityIds: [...group.entityIds],
          }),
        );

        /*
         * Isolate toàn bộ object đã chạy đến bước hiện tại.
         */
        await tcapi.viewer.isolateEntities(accumulatedObjects);

        /*
         * Tô màu object hiện tại.
         */
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
                r: color.r ?? 0,
                g: color.g ?? 0,
                b: color.b ?? 0,
              },
              visible: true,
            },
          );
        }

        /*
         * Highlight object hiện tại.
         */
        await tcapi.viewer.setSelection(
          {
            modelObjectIds: [
              {
                modelId: item.modelId,
                objectRuntimeIds: [item.runtimeId],
              },
            ],
          },
          "set",
        );

        /*
         * Di chuyển camera nếu object đã lưu camera.
         */
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
      message.error("Simulation failed.");
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
        projectId,
        planId: plan.id,
        subPlanId: subPlan.id,
        objects: sortedObjects,
      }),
    );
  };

  const handleHighlightObject = async (subPlan) => {
    try {
      if (!subPlan?.id) {
        return;
      }

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

      /*
       * Runtime IDs that are already available
       * can be sent directly to setSelection.
       */
      const runtimeGroups = new Map();

      /*
       * Objects without runtimeId must be resolved
       * from stable external object IDs.
       */
      const unresolvedGroups = new Map();

      for (const object of objects) {
        const modelId = object?.modelId;

        const runtimeId = object?.runtimeId;

        const externalId =
          object?.externalId ??
          object?.external_id ??
          object?.objectId ??
          object?.id;

        if (modelId == null) {
          continue;
        }

        const modelKey = String(modelId);

        /*
         * Prefer the runtime ID resolved during hydration.
         */
        if (runtimeId != null && Number.isFinite(Number(runtimeId))) {
          if (!runtimeGroups.has(modelKey)) {
            runtimeGroups.set(modelKey, {
              modelId,
              runtimeIds: new Set(),
            });
          }

          runtimeGroups.get(modelKey).runtimeIds.add(Number(runtimeId));

          continue;
        }

        /*
         * Do not convert external IDs to Number.
         * Trimble external object IDs can be strings.
         */
        if (externalId == null || externalId === "") {
          continue;
        }

        if (!unresolvedGroups.has(modelKey)) {
          unresolvedGroups.set(modelKey, {
            modelId,
            externalIds: [],
          });
        }

        unresolvedGroups.get(modelKey).externalIds.push(externalId);
      }

      /*
       * Resolve objects that do not currently
       * have a runtimeId.
       */
      for (const group of unresolvedGroups.values()) {
        const uniqueExternalIds = [
          ...new Map(
            group.externalIds.map((externalId) => [
              String(externalId),
              externalId,
            ]),
          ).values(),
        ];

        if (!uniqueExternalIds.length) {
          continue;
        }

        try {
          const runtimeIds = await tcapi.viewer.convertToObjectRuntimeIds(
            group.modelId,
            uniqueExternalIds,
          );

          const validRuntimeIds = (runtimeIds || [])
            .map(Number)
            .filter(Number.isFinite);

          if (!validRuntimeIds.length) {
            console.warn("No runtime IDs were resolved:", {
              modelId: group.modelId,
              externalIds: uniqueExternalIds,
            });

            continue;
          }

          const modelKey = String(group.modelId);

          if (!runtimeGroups.has(modelKey)) {
            runtimeGroups.set(modelKey, {
              modelId: group.modelId,
              runtimeIds: new Set(),
            });
          }

          const targetGroup = runtimeGroups.get(modelKey);

          validRuntimeIds.forEach((runtimeId) => {
            targetGroup.runtimeIds.add(runtimeId);
          });
        } catch (error) {
          console.error("Failed to resolve runtime IDs:", {
            modelId: group.modelId,
            externalIds: uniqueExternalIds,
            error,
          });
        }
      }

      const modelObjectIds = [...runtimeGroups.values()]
        .map((group) => ({
          modelId: group.modelId,

          objectRuntimeIds: [...group.runtimeIds],
        }))
        .filter((group) => group.objectRuntimeIds.length > 0);

      console.log("Highlight modelObjectIds:", modelObjectIds);

      if (!modelObjectIds.length) {
        await tcapi.viewer.setSelection(
          {
            modelObjectIds: [],
          },
          "set",
        );

        console.warn("No valid objects were found for highlighting.");

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
    const modelId = obj.modelId ?? obj.modelExternalId ?? obj.model_external_id;

    const objectId =
      obj.externalId ??
      obj.external_id ??
      obj.id ??
      obj.runtimeId ??
      obj.objectRuntimeId;

    return `${String(modelId)}-${String(objectId)}`;
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
  }, [sequenceObjects]);

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
