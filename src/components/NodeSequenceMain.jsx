import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Checkbox, Collapse, DatePicker, Empty, Input, Modal, Spin, Tree, message } from "antd";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import dayjs from "dayjs";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import { useSelector } from "react-redux";

import SortableHeader from "./SortableHeader";
import SequenceObjectCollapse from "./SequenceObjectCollapse";
import SubPlanModal from "./SubPlanModal";
import { hydrateSequenceObjects } from "../services/trimbleRuntimeService";
import {
  createNode,
  deleteNode,
  getNodesByProject,
  updateNode,
  updateNodesOrder,
} from "../services/nodeService";
import {
  getSequenceObjectsByProject,
  replaceSequenceObjectsForNode,
  updateSequenceObjectSortDatesForNode,
  moveSequenceObjectsToNode,
} from "../services/sequenceObjectService";

const DATE_FORMATS = ["YYYY-MM-DD", "DD-MM-YYYY", "DD/MM/YYYY", "YYYY/MM/DD"];
const LAYER_PROPERTY_BATCH_SIZE = 250;
const LAYER_PROPERTY_LOG_SAMPLE_SIZE = 5;
const LAYER_LOG_PREFIX = "[AssignByLayer]";
const PICKED_LOG_PREFIX = "[AssignPicked]";

const logLayer = (event, details = {}) => {
  console.info(`${LAYER_LOG_PREFIX} ${event}`, details);
};

const warnLayer = (event, details = {}) => {
  console.warn(`${LAYER_LOG_PREFIX} ${event}`, details);
};

const logPicked = (event, details = {}) => {
  console.info(`${PICKED_LOG_PREFIX} ${event}`, details);
};

const warnPicked = (event, details = {}) => {
  console.warn(`${PICKED_LOG_PREFIX} ${event}`, details);
};

const parseDate = (value) => {
  if (!value) return null;
  if (dayjs.isDayjs(value)) return value.isValid() ? value : null;
  for (const format of DATE_FORMATS) {
    const parsed = dayjs(value, format, true);
    if (parsed.isValid()) return parsed;
  }
  const fallback = dayjs(value);
  return fallback.isValid() ? fallback : null;
};

const shiftWeekendForward = (value) => {
  const parsed = parseDate(value);
  if (!parsed) return null;
  let result = parsed.startOf("day");
  if (result.day() === 6) result = result.add(2, "day");
  if (result.day() === 0) result = result.add(1, "day");
  return result;
};

const addWorkingDays = (value, amount) => {
  let result = shiftWeekendForward(value);
  if (!result) return null;
  const days = Number(amount) || 0;
  if (days === 0) return result;
  const direction = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    result = result.add(direction, "day");
    if (result.day() !== 0 && result.day() !== 6) remaining -= 1;
  }
  return shiftWeekendForward(result);
};

const addSequenceDays = (value, amount, considerWeekend = false) => {
  const parsed = parseDate(value);
  if (!parsed) return null;
  return considerWeekend
    ? parsed.startOf("day").add(Number(amount) || 0, "day")
    : addWorkingDays(value, amount);
};

const getExternalId = (object) =>
  object?.externalId ?? object?.external_id ?? object?.objectId ?? null;

const getObjectKey = (object) =>
  String(object?.dbId ?? object?.id ?? getExternalId(object) ?? "");

const getNodeParentId = (node) => node?.parentId ?? node?.parent_id ?? null;

const getNodeSort = (node) => Number(node?.sortOrder ?? node?.sort_order ?? 0);

const normalizeColor = (color) => {
  if (!color) return null;
  if (typeof color === "object") {
    const source = color?.rgb ?? color;
    const r = Number(source?.r);
    const g = Number(source?.g);
    const b = Number(source?.b);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return {
        r: Math.max(0, Math.min(255, r)),
        g: Math.max(0, Math.min(255, g)),
        b: Math.max(0, Math.min(255, b)),
      };
    }
  }
  if (typeof color === "string") {
    const trimmed = color.trim();
    const rgbMatch = trimmed.match(
      /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)$/i,
    );
    if (rgbMatch) {
      return {
        r: Math.max(0, Math.min(255, Number(rgbMatch[1]))),
        g: Math.max(0, Math.min(255, Number(rgbMatch[2]))),
        b: Math.max(0, Math.min(255, Number(rgbMatch[3]))),
      };
    }

    const hex = trimmed.replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  }
  return null;
};

const buildTreeMaps = (nodes) => {
  const childrenByParent = new Map();
  const nodeMap = new Map();

  (nodes || []).forEach((node) => nodeMap.set(String(node.id), node));

  (nodes || []).forEach((node) => {
    const parentId = getNodeParentId(node);
    const key = String(parentId ?? "__ROOT__");
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(node);
  });

  childrenByParent.forEach((children) => {
    children.sort((a, b) => {
      const sort = getNodeSort(a) - getNodeSort(b);
      if (sort !== 0) return sort;
      return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  });

  return { nodeMap, childrenByParent };
};

const getDescendantIds = (nodeId, childrenByParent) => {
  const result = [];
  const stack = [String(nodeId)];
  while (stack.length) {
    const current = stack.pop();
    result.push(current);
    const children = childrenByParent.get(current) || [];
    children.forEach((child) => stack.push(String(child.id)));
  }
  return result;
};

const normalizeLayerName = (value) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase();

const createWildcardMatcher = (value) => {
  const search = String(value || "").trim();
  if (!search) return null;

  let expression = "";
  for (const character of search) {
    if (character === "*") {
      expression += ".*";
    } else if (character === "?") {
      expression += ".";
    } else {
      expression += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }

  const hasWildcard = search.includes("*") || search.includes("?");
  return new RegExp(hasWildcard ? `^${expression}$` : expression, "i");
};

/*
 * getObjects(undefined, { visible: true }) already applies the Viewer filter.
 * Only collect the direct returned entities. Walking `children` recursively
 * is incorrect here because a visible hierarchy container can still contain
 * hidden descendants from the entire model.
 */
const getRuntimeIdsFromModelGroup = (modelGroup) => {
  const runtimeIds = [];
  const seenIds = new Set();

  (modelGroup?.objects || []).forEach((value) => {
    if (value == null) return;
    const runtimeId = typeof value === "object"
      ? value?.id ?? value?.runtimeId
      : value;
    if (runtimeId != null) {
      const key = String(runtimeId);
      if (!seenIds.has(key)) {
        seenIds.add(key);
        runtimeIds.push(runtimeId);
      }
    }
  });
  return runtimeIds;
};

const convertRuntimeIdsSafely = async (tcapi, modelId, runtimeIds) => {
  if (!runtimeIds.length) return [];

  try {
    const objectIds = await tcapi.viewer.convertToObjectIds(
      modelId,
      runtimeIds,
    );

    return runtimeIds
      .map((runtimeId, index) => ({
        runtimeId,
        externalId: objectIds?.[index],
      }))
      .filter((item) => item.externalId != null);
  } catch (error) {
    if (runtimeIds.length === 1) return [];

    const middle = Math.ceil(runtimeIds.length / 2);
    const [left, right] = await Promise.all([
      convertRuntimeIdsSafely(tcapi, modelId, runtimeIds.slice(0, middle)),
      convertRuntimeIdsSafely(tcapi, modelId, runtimeIds.slice(middle)),
    ]);
    return [...left, ...right];
  }
};

const resolvePersistentRuntimeIds = async (
  tcapi,
  modelId,
  runtimeIds,
  logger = logLayer,
  warningLogger = warnLayer,
) => {
  const uniqueRuntimeIds = [...new Map(
    (runtimeIds || [])
      .filter((id) => id != null)
      .map((id) => [String(id), id]),
  ).values()];
  if (!uniqueRuntimeIds.length) return [];

  const directlyConverted = await convertRuntimeIdsSafely(
    tcapi,
    modelId,
    uniqueRuntimeIds,
  );
  const directKeys = new Set(
    directlyConverted.map((item) => String(item.runtimeId)),
  );
  const containerIds = uniqueRuntimeIds.filter(
    (id) => !directKeys.has(String(id)),
  );

  /*
   * Presentation layers may reference hierarchy/container entities. Those
   * entities are visible in getObjects(), but they have no persistent object
   * ID and cannot be assigned directly. Expand them to their descendant
   * model objects and validate the descendants instead.
   */
  const descendantIds = [];
  for (
    let start = 0;
    start < containerIds.length;
    start += LAYER_PROPERTY_BATCH_SIZE
  ) {
    const batch = containerIds.slice(start, start + LAYER_PROPERTY_BATCH_SIZE);
    try {
      const descendants = await tcapi.viewer.getHierarchyChildren(
        modelId,
        batch,
        undefined,
        true,
      );
      (descendants || []).forEach((entity) => {
        const id = entity?.id ?? entity?.runtimeId;
        if (id != null) descendantIds.push(id);
      });
    } catch (error) {
      warningLogger("Unable to expand hierarchy entities", {
        modelId,
        containerCount: batch.length,
        message: error?.message,
      });
    }
  }

  const uniqueDescendantIds = [...new Map(
    descendantIds.map((id) => [String(id), id]),
  ).values()].filter((id) => !directKeys.has(String(id)));
  const convertedDescendants = await convertRuntimeIdsSafely(
    tcapi,
    modelId,
    uniqueDescendantIds,
  );

  const result = [...directlyConverted, ...convertedDescendants];
  const seen = new Set();
  const persistentRuntimeIds = result
    .map((item) => item.runtimeId)
    .filter((id) => {
      const key = String(id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  logger("Runtime entities resolved", {
    modelId,
    visibleEntityCount: uniqueRuntimeIds.length,
    directObjectCount: directlyConverted.length,
    containerEntityCount: containerIds.length,
    descendantEntityCount: uniqueDescendantIds.length,
    persistentObjectCount: persistentRuntimeIds.length,
  });

  return persistentRuntimeIds;
};

const getModelDisplayName = (model, modelId) =>
  model?.name ||
  model?.fileName ||
  model?.displayName ||
  model?.title ||
  String(modelId);

const parseViewerProperties = (propertyItem) => {
  const properties = propertyItem?.properties || [];
  let asmName = propertyItem?.product?.name || "";
  let asmPos = "";
  let positionCode = "";
  let weight = 0;
  let asmLength = 0;
  let cogX = null;
  let cogY = null;
  let cogZ = null;

  for (const property of properties) {
    for (const item of property?.properties || []) {
      const name = String(item?.name || "").trim();
      const upper = name.toUpperCase();
      const value = item?.value;

      if (!asmPos && (name === "Assembly/Cast unit Mark" || upper === "ASSEMBLY_POS")) {
        asmPos = String(value || "").replace("(?)", "").trim();
        continue;
      }
      if (!positionCode && (name === "Assembly/Cast unit position code" || upper === "ASSEMBLY_POSITION_CODE")) {
        positionCode = String(value || "").trim();
        continue;
      }
      if (!weight && upper.includes("WEIGHT") && value != null) {
        weight = Number(value);
        continue;
      }
      if (!asmName && upper.includes("NAME") && value != null) {
        asmName = String(value).trim();
        continue;
      }
      if (!asmLength && upper.includes("LENGTH") && value != null) {
        asmLength = Number(value).toFixed(0);
        continue;
      }
      if (cogX === null && (upper.includes("GRAVITY X") || upper.includes("GRAVITYX") || upper.includes("OX"))) {
        cogX = Number(value).toFixed(0);
        continue;
      }
      if (cogY === null && (upper.includes("GRAVITY Y") || upper.includes("GRAVITYY") || upper.includes("OY"))) {
        cogY = Number(value).toFixed(0);
        continue;
      }
      if (cogZ === null && (upper.includes("GRAVITY Z") || upper.includes("GRAVITYZ") || upper.includes("OZ"))) {
        cogZ = Number(value).toFixed(0);
      }
    }
  }

  return {
    asmName,
    asmPos,
    positionCode,
    weight,
    asmLength,
    cog: cogX !== null && cogY !== null && cogZ !== null ? [cogX, cogY, cogZ] : null,
  };
};

const summarizeViewerPropertyItem = (propertyItem, runtimeId) => ({
  runtimeId,
  product: propertyItem?.product || null,
  propertyGroups: (propertyItem?.properties || []).map((group) => ({
    groupName: group?.name ?? group?.groupName ?? "",
    properties: (group?.properties || []).map((property) => ({
      name: property?.name ?? "",
      value: property?.value ?? null,
      type: property?.type ?? null,
    })),
  })),
});

const createObjectsFromSelection = async ({
  tcapi,
  selections,
  selectedDate,
  referencePoint = null,
  assignmentMode = "manual",
}) => {
  const result = [];
  const propertyLogger = assignmentMode === "layer"
    ? logLayer
    : assignmentMode === "auto"
      ? logPicked
      : (event, details) => console.info(`[AssignSelected] ${event}`, details);
  for (const selection of selections || []) {
    const runtimeIds = selection?.objectRuntimeIds || [];
    if (!runtimeIds.length) continue;
    const resultCountBeforeModel = result.length;
    let convertibleCount = 0;

    for (
      let start = 0;
      start < runtimeIds.length;
      start += LAYER_PROPERTY_BATCH_SIZE
    ) {
      const batchRuntimeIds = runtimeIds.slice(
        start,
        start + LAYER_PROPERTY_BATCH_SIZE,
      );
      const convertedObjects = await convertRuntimeIdsSafely(
        tcapi,
        selection.modelId,
        batchRuntimeIds,
      );
      const validRuntimeIds = convertedObjects.map((item) => item.runtimeId);
      convertibleCount += validRuntimeIds.length;
      if (!validRuntimeIds.length) continue;

      const [boundingBoxes, propertyItems] = await Promise.all([
        tcapi.viewer
          .getObjectBoundingBoxes(selection.modelId, validRuntimeIds)
          .catch(() => []),
        tcapi.viewer.getObjectProperties(selection.modelId, validRuntimeIds),
      ]);

      propertyLogger("getObjectProperties result", {
        modelId: selection.modelId,
        batchStart: start,
        requestedRuntimeCount: validRuntimeIds.length,
        returnedPropertyCount: propertyItems?.length || 0,
        sampleRuntimeIds: validRuntimeIds.slice(
          0,
          LAYER_PROPERTY_LOG_SAMPLE_SIZE,
        ),
        sampleObjects: validRuntimeIds
          .slice(0, LAYER_PROPERTY_LOG_SAMPLE_SIZE)
          .map((runtimeId, index) =>
            summarizeViewerPropertyItem(propertyItems?.[index], runtimeId),
          ),
      });

      for (let index = 0; index < convertedObjects.length; index += 1) {
        const { runtimeId, externalId } = convertedObjects[index];

        const propertyData = parseViewerProperties(propertyItems?.[index]);
        const box = boundingBoxes?.[index];
        let center = [0, 0, 0];
        if (box?.boundingBox) {
          const min = [
            Number(1000 * box.boundingBox.min.x),
            Number(1000 * box.boundingBox.min.y),
            Number(1000 * box.boundingBox.min.z),
          ];
          const max = [
            Number(1000 * box.boundingBox.max.x),
            Number(1000 * box.boundingBox.max.y),
            Number(1000 * box.boundingBox.max.z),
          ];
          center = min.map((value, i) => Math.round((value + max[i]) / 2));
        }

        let distance = 0;
        if (referencePoint) {
          distance = Math.round(
            Math.sqrt(
              Math.pow(referencePoint[0] - center[0], 2) +
                Math.pow(referencePoint[1] - center[1], 2) +
                Math.pow(referencePoint[2] - center[2], 2),
            ),
          );
        }

        result.push({
          externalId: String(externalId),
          modelId: selection.modelId,
          runtimeId,
          id: runtimeId,
          asmPos: propertyData.asmPos,
          assignedDate: selectedDate?.isValid()
            ? selectedDate.format("YYYY-MM-DD")
            : null,
          date: selectedDate?.isValid()
            ? selectedDate.format("YYYY-MM-DD")
            : null,
          endDate: null,
          positionCode: propertyData.positionCode,
          cog: propertyData.cog,
          weight: propertyData.weight,
          length: propertyData.asmLength,
          name: propertyData.asmName,
          distance,
          center,
          objectAvailable: true,
        });
      }
    }

    logLayer("External ID conversion completed", {
      modelId: selection.modelId,
      runtimeCount: runtimeIds.length,
      convertibleCount,
      skippedCount: runtimeIds.length - convertibleCount,
      createdObjectCount: result.length - resultCountBeforeModel,
    });
  }
  return result;
};

function NodeItem({
  node,
  level,
  childrenByParent,
  nodeMap,
  sequenceGroups,
  nodes,
  selectedNodeIds,
  setSelectedNodeIds,
  canEdit,
  isViewer,
  isFree,
  loadedModelIds,
  activeSimulationItem,
  displayIndexMap,
  onEdit,
  onDelete,
  onCreateChild,
  onCopyNode,
  onCopyNodesFrom,
  onAssignDate,
  onAssignObject,
  onAutoAssign,
  onAssignByLayer,
  onSimulation,
  onSortByDate,
  onHighlightNode,
  onShowOnlyNode,
  onPersistObjects,
  onMoveObjects,
  onReorderNodes,
}) {
  const children = childrenByParent.get(String(node.id)) || [];
  const directObjectCount =
    sequenceGroups.get(String(node.id))?.objects?.length || 0;
  const leafMoveTargets = useMemo(
    () =>
      (nodes || []).filter(
        (target) =>
          (childrenByParent.get(String(target.id)) || []).length === 0,
      ),
    [nodes, childrenByParent],
  );
  const objectCount = getDescendantIds(node.id, childrenByParent).reduce(
    (total, id) => total + (sequenceGroups.get(id)?.objects?.length || 0),
    0,
  );

  const nodeDateRange = useMemo(() => {
    const descendantIds = getDescendantIds(node.id, childrenByParent);
    const startDates = [];
    const endDates = [];

    descendantIds.forEach((id) => {
      const objects = sequenceGroups.get(String(id))?.objects || [];

      objects.forEach((object) => {
        const startDate = parseDate(
          object?.assignedDate ?? object?.assigned_date ?? object?.date,
        );
        const endDate = parseDate(object?.endDate ?? object?.end_date);

        if (startDate) startDates.push(startDate);
        if (endDate) endDates.push(endDate);
      });
    });

    if (startDates.length === 0 && endDates.length === 0) {
      return null;
    }

    const startDate = startDates.length > 0
      ? startDates.reduce((earliest, current) =>
          current.valueOf() < earliest.valueOf() ? current : earliest,
        )
      : null;

    const endDate = endDates.length > 0
      ? endDates.reduce((latest, current) =>
          current.valueOf() > latest.valueOf() ? current : latest,
        )
      : null;

    return {
      start: startDate ? startDate.format("DD-MM-YYYY") : "?",
      end: endDate ? endDate.format("DD-MM-YYYY") : "?",
    };
  }, [node.id, childrenByParent, sequenceGroups]);

  const selected = selectedNodeIds.includes(String(node.id));

  const activeNodeId = String(activeSimulationItem?.nodeId || activeSimulationItem?.subPlanId || "");
  const activeHere = activeNodeId === String(node.id);
  const [activeKeys, setActiveKeys] = useState(activeHere ? [String(node.id)] : []);

  useEffect(() => {
    if (activeHere) {
      setActiveKeys([String(node.id)]);
    }
  }, [activeHere, node.id]);

  const items = useMemo(() => [
    {
      key: String(node.id),
      label: (
        <SortableHeader
          plan={node}
          objectCount={objectCount}
          dateRange={nodeDateRange}
          isOwner={canEdit}
          isFree={isFree}
          selected={selected}
          onSelect={canEdit ? (item, mode) => {
            const id = String(item.id);
            if (mode === "reset") {
              setSelectedNodeIds((current) => current.length ? [] : current);
              return;
            }
            setSelectedNodeIds((current) =>
              current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
            );
          } : undefined}
          onEdit={canEdit ? onEdit : undefined}
          onDelete={canEdit ? onDelete : undefined}
          onAddSubPlan={canEdit ? onCreateChild : undefined}
          addSubPlanDisabled={directObjectCount > 0}
          onAssignObject={canEdit ? onAssignObject : undefined}
          onAutoAssign={canEdit ? onAutoAssign : undefined}
          onAssignByLayer={canEdit ? onAssignByLayer : undefined}
          assignItemsDisabled={children.length > 0}
          onCopySubPlan={canEdit ? onCopyNode : undefined}
          onCopyNodesFrom={canEdit ? onCopyNodesFrom : undefined}
          copyNodesFromDisabled={directObjectCount > 0}
          onSortByDate={canEdit ? onSortByDate : undefined}
          onHighlightObject={onHighlightNode}
          onShowOnlyObject={onShowOnlyNode}
          onAssignDate={canEdit ? onAssignDate : undefined}
          onSimulation={onSimulation}
          addChildLabel="Add Sub Plan"
          copyLabel="Copy Plan"
        />
      ),
      children: (
        <>
          {children.length > 0 && (
            <NodeChildren
              parentId={node.id}
              level={level + 1}
              childrenByParent={childrenByParent}
              nodeMap={nodeMap}
              sequenceGroups={sequenceGroups}
              nodes={nodes}
              selectedNodeIds={selectedNodeIds}
              setSelectedNodeIds={setSelectedNodeIds}
              canEdit={canEdit}
              isViewer={isViewer}
              isFree={isFree}
              loadedModelIds={loadedModelIds}
              activeSimulationItem={activeSimulationItem}
              displayIndexMap={displayIndexMap}
              onEdit={onEdit}
              onDelete={onDelete}
              onCreateChild={onCreateChild}
              onCopyNode={onCopyNode}
              onCopyNodesFrom={onCopyNodesFrom}
              onAssignDate={onAssignDate}
              onAssignObject={onAssignObject}
              onAutoAssign={onAutoAssign}
              onAssignByLayer={onAssignByLayer}
              onSimulation={onSimulation}
              onSortByDate={onSortByDate}
              onHighlightNode={onHighlightNode}
              onShowOnlyNode={onShowOnlyNode}
              onPersistObjects={onPersistObjects}
              onMoveObjects={onMoveObjects}
              onReorderNodes={onReorderNodes}
            />
          )}

          {(directObjectCount > 0 || children.length === 0) && (
            <SequenceObjectCollapse
              subPlan={node}
              nodeMode
              sequenceObjectsOverride={[...sequenceGroups.values()]}
              projectIdOverride={node.trimbleProjectId}
              moveTargets={leafMoveTargets}
              activeSimulationItem={activeSimulationItem}
              displayIndexMap={displayIndexMap}
              isOwner={canEdit}
              loadedModelIds={loadedModelIds}
              onPersistObjects={onPersistObjects}
              onMoveObjects={onMoveObjects}
            />
          )}
        </>
      ),
      style: {
        background: normalizeColor(node.color)
          ? `rgb(${normalizeColor(node.color).r}, ${normalizeColor(node.color).g}, ${normalizeColor(node.color).b})`
          : undefined,
        boxShadow: selected || activeHere ? "inset 0 0 0 2px #1677ff" : "none",
        borderRadius: selected || activeHere ? 4 : 0,
        marginBottom: 4,
        marginLeft: Math.max(0, level - 1) * 4,
      },
    },
  ], [
    node, directObjectCount, objectCount, nodeDateRange, canEdit, isFree, selected, setSelectedNodeIds,
    onEdit, onDelete, onCreateChild, onAssignObject, onAutoAssign, onAssignByLayer,
    onCopyNode, onCopyNodesFrom, onSortByDate, onHighlightNode, onShowOnlyNode, onAssignDate, onSimulation,
    children, level, childrenByParent, nodeMap, sequenceGroups, nodes, leafMoveTargets,
    selectedNodeIds, isViewer, loadedModelIds, activeSimulationItem,
    displayIndexMap, onPersistObjects, onMoveObjects, onReorderNodes, activeHere, activeKeys,
  ]);

  return (
    <Collapse
      collapsible="icon"
      size="small"
      items={items}
      activeKey={activeKeys}
      onChange={(keys) => {
        setActiveKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)]);
      }}
      style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        overflow: "hidden",
        boxSizing: "border-box",
        borderRadius: 0,
        background: "transparent",
      }}
      styles={{
        header: {
          minHeight: 28,
          padding: "0 6px",
          alignItems: "center",
          lineHeight: 1.2,
        },
        body: { padding: 6 },
      }}
    />
  );
}

function NodeChildren(props) {
  const {
    parentId,
    childrenByParent,
    canEdit,
    onReorderNodes,
  } = props;
  const parentKey = parentId == null ? "__ROOT__" : String(parentId);
  const children = childrenByParent.get(parentKey) || [];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = async ({ active, over }) => {
    if (!canEdit || !over || String(active.id) === String(over.id)) return;
    const oldIndex = children.findIndex((item) => String(item.id) === String(active.id));
    const newIndex = children.findIndex((item) => String(item.id) === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(children, oldIndex, newIndex);

    /*
     * Optimistic node reorder. Do not wait for Supabase before rendering.
     * `children` is the exact previous sibling order and is used for rollback.
     */
    onReorderNodes?.(parentId, reordered);

    try {
      await updateNodesOrder(reordered);
    } catch (error) {
      onReorderNodes?.(parentId, children);
      message.error(error?.message || "Unable to reorder nodes.");
    }
  };

  return (
    <DndContext sensors={canEdit ? sensors : []} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={children.map((item) => String(item.id))} strategy={verticalListSortingStrategy}>
        {children.map((node) => <NodeItem key={node.id} {...props} node={node} />)}
      </SortableContext>
    </DndContext>
  );
}

export default function NodeSequenceMain({
  projectId,
  isOwner = false,
  isViewer = false,
  isFree = false,
  readOnly = false,
  loadedModelIds = [],
  activeSimulationItem = null,
  onSimulation,
  onDataChange = null,
  sequenceRefreshKey = 0,
}) {
  const { message: appMessage } = App.useApp();
  const reduxProjectId = useSelector((state) => state.sequence.projectId || "");
  const effectiveProjectId = projectId || reduxProjectId;
  const canEdit = isOwner && !readOnly;

  const [nodes, setNodes] = useState([]);
  const [sequenceGroups, setSequenceGroups] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [creatingParent, setCreatingParent] = useState(null);
  const [copyNodesTarget, setCopyNodesTarget] = useState(null);
  const [copyNodesSourceId, setCopyNodesSourceId] = useState(null);
  const [copyNodesProcessing, setCopyNodesProcessing] = useState(false);
  const [pendingAssignment, setPendingAssignment] = useState(null);
  const [assignmentProcessing, setAssignmentProcessing] = useState(false);
  const [layerOptions, setLayerOptions] = useState([]);
  const [layerLoading, setLayerLoading] = useState(false);
  const [layerSearch, setLayerSearch] = useState("");
  const [layerSelectedObjectCount, setLayerSelectedObjectCount] = useState(0);
  const tcapiRef = useRef(null);
  const originalLayersRef = useRef(new Map());
  const layerPreviewRevisionRef = useRef(0);
  const sequenceGroupsRef = useRef(new Map());
  const persistRevisionRef = useRef(new Map());

  useEffect(() => {
    sequenceGroupsRef.current = sequenceGroups;
  }, [sequenceGroups]);

  useEffect(() => {
    if (pendingAssignment?.mode !== "layer") {
      setLayerSelectedObjectCount(0);
      return undefined;
    }

    let active = true;

    const updateSelectedObjectCount = async () => {
      try {
        const tcapi = tcapiRef.current || (await WorkspaceAPI.connect(window.parent));
        tcapiRef.current = tcapi;
        const selection = await tcapi.viewer.getSelection();
        if (!active) return;

        const count = (selection || []).reduce(
          (total, item) => total + (item?.objectRuntimeIds?.length || 0),
          0,
        );
        setLayerSelectedObjectCount(count);
        logLayer("User selection count changed", { objectCount: count });
      } catch (error) {
        if (active) {
          setLayerSelectedObjectCount(0);
          warnLayer("Unable to read user selection count", {
            message: error?.message,
            error,
          });
        }
      }
    };

    const handleViewerEvent = (event) => {
      if (event?.data?.event === "viewer.onSelectionChanged") {
        updateSelectedObjectCount();
      }
    };

    window.addEventListener("message", handleViewerEvent);
    updateSelectedObjectCount();

    return () => {
      active = false;
      window.removeEventListener("message", handleViewerEvent);
    };
  }, [pendingAssignment?.mode]);

  const loadData = useCallback(async () => {
    if (!effectiveProjectId) return;
    setLoading(true);
    try {
      const tcapi = tcapiRef.current || (await WorkspaceAPI.connect(window.parent));
      tcapiRef.current = tcapi;
      const [loadedNodes, objectRows] = await Promise.all([
        getNodesByProject(effectiveProjectId),
        getSequenceObjectsByProject(effectiveProjectId),
      ]);
      const hydrated = await hydrateSequenceObjects({ tcapi, objects: objectRows || [] });
      const groups = new Map();
      loadedNodes.forEach((node) => groups.set(String(node.id), { nodeId: node.id, objects: [] }));
      hydrated.forEach((object) => {
        const nodeId = object?.nodeId;
        if (!nodeId) return;
        const key = String(nodeId);
        if (!groups.has(key)) groups.set(key, { nodeId, objects: [] });
        groups.get(key).objects.push({ ...object, nodeId });
      });
      setNodes(loadedNodes);
      const nextGroups = new Map(groups);
      sequenceGroupsRef.current = nextGroups;
      setSequenceGroups(nextGroups);
    } catch (error) {
      console.error("Failed to load node hierarchy:", error);
      appMessage.error(error?.message || "Unable to load node hierarchy.");
    } finally {
      setLoading(false);
    }
  }, [effectiveProjectId, appMessage]);

  useEffect(() => { loadData(); }, [loadData, sequenceRefreshKey]);

  const { nodeMap, childrenByParent } = useMemo(() => buildTreeMaps(nodes), [nodes]);
  const getRootNode = useCallback((nodeId) => {
    let currentId = nodeId != null ? String(nodeId) : null;
    const visited = new Set();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const current = nodeMap.get(currentId);
      if (!current) return null;
      const parentId = getNodeParentId(current);
      if (!parentId) return current;
      currentId = String(parentId);
    }
    return null;
  }, [nodeMap]);

  const exportData = useMemo(() => {
    const rootNodes = nodes
      .filter((node) => !getNodeParentId(node))
      .sort((a, b) => getNodeSort(a) - getNodeSort(b))
      .map((node) => ({ ...node, id: String(node.id) }));

    const groups = [];
    const simulationNodes = [];
    nodes.forEach((node) => {
      const root = getRootNode(node.id);
      if (!root) return;

      simulationNodes.push({
        ...node,
        id: String(node.id),
        planId: String(root.id),
        parentPlanId: String(root.id),
      });

      const group = sequenceGroups.get(String(node.id));
      if (!group) return;
      groups.push({
        ...group,
        planId: String(root.id),
        subPlanId: String(node.id),
        objects: (group.objects || []).map((object) => ({
          ...object,
          planId: String(root.id),
          subPlanId: String(node.id),
          nodeId: String(node.id),
        })),
      });
    });

    return {
      nodeMode: true,
      plans: rootNodes,
      subPlans: simulationNodes,
      sequenceObjects: groups,
    };
  }, [nodes, sequenceGroups, getRootNode]);

  useEffect(() => {
    onDataChange?.(exportData);
  }, [exportData, onDataChange]);

  const displayIndexMap = useMemo(() => {
    const dateCounters = new Map();
    const objectIndexes = new Map();
    const orderedGroups = [...sequenceGroups.values()];
    orderedGroups.forEach((group) => {
      (group.objects || []).forEach((object, index) => {
        const dateKey = object?.assignedDate || object?.date || "NO_DATE";
        const dateIndex = (dateCounters.get(dateKey) || 0) + 1;
        dateCounters.set(dateKey, dateIndex);
        objectIndexes.set(getObjectKey(object), `${index + 1}-${dateIndex}`);
      });
    });
    return objectIndexes;
  }, [sequenceGroups]);

  const refreshNodeGroup = useCallback(async (nodeId) => {
    const rows = await getSequenceObjectsByProject(effectiveProjectId);
    const tcapi = tcapiRef.current || (await WorkspaceAPI.connect(window.parent));
    tcapiRef.current = tcapi;
    const hydrated = await hydrateSequenceObjects({ tcapi, objects: rows || [] });
    const groups = new Map();
    nodes.forEach((node) => groups.set(String(node.id), { nodeId: node.id, objects: [] }));
    hydrated.forEach((object) => {
      if (!object?.nodeId) return;
      const key = String(object.nodeId);
      if (!groups.has(key)) groups.set(key, { nodeId: object.nodeId, objects: [] });
      groups.get(key).objects.push({ ...object, nodeId: object.nodeId });
    });
    sequenceGroupsRef.current = groups;
    setSequenceGroups(groups);
  }, [effectiveProjectId, nodes]);

  const persistObjects = useCallback(async ({ nodeId, objects }) => {
    const key = String(nodeId);
    const revision = (persistRevisionRef.current.get(key) || 0) + 1;
    persistRevisionRef.current.set(key, revision);

    const nextObjects = Array.isArray(objects)
      ? objects.map((object) => ({
          ...object,
          nodeId,
        }))
      : [];

    /*
     * Optimistic UI:
     * update the in-memory group immediately. This is important for Node mode
     * because newly picked Trimble objects already contain modelId/runtimeId.
     * Waiting for Supabase and replacing the objects with DB-only rows would
     * remove those runtime fields and make the table appear empty until reload.
     */
    const previousGroup = sequenceGroupsRef.current.get(key) || {
      nodeId,
      objects: [],
    };

    const optimisticGroups = new Map(sequenceGroupsRef.current);
    optimisticGroups.set(key, {
      nodeId,
      objects: nextObjects,
    });
    sequenceGroupsRef.current = optimisticGroups;
    setSequenceGroups(optimisticGroups);

    try {
      const saved = await replaceSequenceObjectsForNode({
        trimbleProjectId: effectiveProjectId,
        nodeId,
        objects: nextObjects,
      });

      /*
       * Merge DB fields (dbId, dates, sort_datetime, camera, etc.) back into
       * the original runtime objects instead of replacing them. This preserves
       * modelId/runtimeId/objectAvailable and therefore keeps the UI visible
       * without requiring a full reload.
       */
      const savedByExternalId = new Map(
        saved.map((object) => [
          String(getExternalId(object) ?? ""),
          object,
        ]),
      );

      /*
       * Preserve the exact optimistic array order. Supabase/PostgREST does not
       * guarantee that returned INSERT rows have the same order as the input.
       */
      const merged = nextObjects.map((runtimeObject) => {
        const savedObject = savedByExternalId.get(
          String(getExternalId(runtimeObject) ?? ""),
        );

        if (!savedObject) {
          return {
            ...runtimeObject,
            nodeId,
          };
        }

        return {
          ...runtimeObject,
          dbId: savedObject.dbId ?? runtimeObject.dbId,
          trimbleProjectId:
            savedObject.trimbleProjectId ?? runtimeObject.trimbleProjectId,
          subPlanId: savedObject.subPlanId,
          nodeId,
          externalId:
            savedObject.externalId ?? getExternalId(runtimeObject),
          assignedDate: savedObject.assignedDate,
          date: savedObject.date,
          sortDatetime: savedObject.sortDatetime,
          camera: savedObject.camera,
          createdAt: savedObject.createdAt ?? runtimeObject.createdAt,
          updatedAt: savedObject.updatedAt ?? runtimeObject.updatedAt,
        };
      });

      /* Ignore a stale response when a newer drag/update already started. */
      if (persistRevisionRef.current.get(key) === revision) {
        const next = new Map(sequenceGroupsRef.current);
        next.set(key, {
          nodeId,
          objects: merged,
        });
        sequenceGroupsRef.current = next;
        setSequenceGroups(next);
      }

      return merged;
    } catch (error) {
      /*
       * Roll back only this Node's optimistic update when persistence fails.
       */
      /* A failed older request must not roll back a newer successful drag. */
      if (persistRevisionRef.current.get(key) === revision) {
        const next = new Map(sequenceGroupsRef.current);
        next.set(key, previousGroup);
        sequenceGroupsRef.current = next;
        setSequenceGroups(next);
      }

      throw error;
    }
  }, [effectiveProjectId]);

  const handleEdit = useCallback((node) => {
    if (!canEdit) return;
    setEditingNode(node);
    setCreatingParent(null);
    setModalOpen(true);
  }, [canEdit]);

  const handleCreateChild = useCallback((node) => {
    if (!canEdit) return;

    const directObjects =
      sequenceGroups.get(String(node?.id))?.objects || [];
    if (directObjects.length > 0) {
      appMessage.warning(
        "Move all items out of this node before adding a sub node.",
      );
      return;
    }

    setEditingNode(null);
    setCreatingParent(node);
    setModalOpen(true);
  }, [canEdit, sequenceGroups, appMessage]);

  const handleModalCancel = useCallback(() => {
    setModalOpen(false);
    setEditingNode(null);
    setCreatingParent(null);
  }, []);

  const handleCreateNodes = useCallback(async ({ names, parentId, color, items }) => {
    const nodesToCreate = Array.isArray(items) && items.length
      ? items
      : names.map((name) => ({ name, color }));
    for (let index = 0; index < nodesToCreate.length; index += 1) {
      await createNode({
        trimbleProjectId: effectiveProjectId,
        parentId,
        name: nodesToCreate[index].name,
        color: nodesToCreate[index].color ?? null,
      });
    }
    await loadData();
  }, [effectiveProjectId, loadData]);

  const handleUpdateNode = useCallback(async ({ id, name, color }) => {
    await updateNode({ id, name, color });
    setNodes((current) => current.map((node) => String(node.id) === String(id) ? { ...node, name, color } : node));
  }, []);

  const handleDeleteNode = useCallback(async (node) => {
    if (!canEdit || !node?.id) return;
    const confirmed = window.confirm(`Delete "${node.name}" and all child nodes?`);
    if (!confirmed) return;
    await deleteNode(node.id);
    await loadData();
  }, [canEdit, loadData]);

  const handleCopyNode = useCallback(async (node) => {
    if (!canEdit || !node?.id) return;
    const sourceIds = getDescendantIds(node.id, childrenByParent);
    const idMap = new Map();
    for (const sourceId of sourceIds) {
      const source = nodeMap.get(sourceId);
      if (!source) continue;
      const parentId = getNodeParentId(source);
      const newParentId = parentId && idMap.has(String(parentId)) ? idMap.get(String(parentId)) : parentId;
      const copy = await createNode({
        trimbleProjectId: effectiveProjectId,
        parentId: sourceId === String(node.id) ? getNodeParentId(node) : newParentId,
        name: sourceId === String(node.id)
          ? `${source.name} Copy`
          : source.name,
        color: source.color ?? null,
        nodeType: source.nodeType,
        sortOrder: getNodeSort(source) + 1,
      });
      idMap.set(sourceId, copy.id);
    }
    await loadData();
  }, [canEdit, childrenByParent, nodeMap, effectiveProjectId, loadData]);

  const openCopyNodesFrom = useCallback((targetNode) => {
    if (!canEdit || !targetNode?.id) return;
    const directObjects =
      sequenceGroups.get(String(targetNode.id))?.objects || [];
    if (directObjects.length > 0) {
      appMessage.warning(
        "Move all items out of this node before copying sub nodes into it.",
      );
      return;
    }
    setCopyNodesSourceId(null);
    setCopyNodesTarget(targetNode);
  }, [canEdit, sequenceGroups, appMessage]);

  const closeCopyNodesFrom = useCallback(() => {
    if (copyNodesProcessing) return;
    setCopyNodesTarget(null);
    setCopyNodesSourceId(null);
  }, [copyNodesProcessing]);

  const confirmCopyNodesFrom = useCallback(async () => {
    if (
      !canEdit ||
      !copyNodesTarget?.id ||
      !copyNodesSourceId ||
      copyNodesProcessing
    ) {
      return;
    }

    const sourceChildren =
      childrenByParent.get(String(copyNodesSourceId)) || [];
    if (!sourceChildren.length) {
      appMessage.warning("The selected source node has no sub nodes.");
      return;
    }

    setCopyNodesProcessing(true);
    try {
      for (const sourceChild of sourceChildren) {
        const sourceIds = getDescendantIds(
          sourceChild.id,
          childrenByParent,
        );
        const copiedIdMap = new Map();

        for (const sourceId of sourceIds) {
          const source = nodeMap.get(String(sourceId));
          if (!source) continue;

          const sourceParentId = getNodeParentId(source);
          const targetParentId = String(sourceId) === String(sourceChild.id)
            ? copyNodesTarget.id
            : copiedIdMap.get(String(sourceParentId));
          if (!targetParentId) continue;

          const copied = await createNode({
            trimbleProjectId: effectiveProjectId,
            parentId: targetParentId,
            name: source.name,
            color: source.color ?? null,
            nodeType: source.nodeType,
            sortOrder: getNodeSort(source),
          });
          copiedIdMap.set(String(sourceId), copied.id);
        }
      }

      await loadData();
      appMessage.success(
        `Sub plans copied into ${copyNodesTarget.name || "the target plan"}.`,
      );
      setCopyNodesTarget(null);
      setCopyNodesSourceId(null);
    } catch (error) {
      console.error("Copy nodes from source failed:", error);
      appMessage.error(error?.message || "Unable to copy plans.");
    } finally {
      setCopyNodesProcessing(false);
    }
  }, [
    canEdit,
    copyNodesTarget,
    copyNodesSourceId,
    copyNodesProcessing,
    childrenByParent,
    nodeMap,
    effectiveProjectId,
    loadData,
    appMessage,
  ]);

  const getNodeObjects = useCallback((nodeId) => {
    const ids = getDescendantIds(nodeId, childrenByParent);
    return ids.flatMap((id) => sequenceGroups.get(id)?.objects || []);
  }, [childrenByParent, sequenceGroups]);

  const handleAssignDate = useCallback((
    node,
    date,
    dateStep,
    considerWeekend = false,
    endDate = null,
  ) => {
    if (!canEdit || !node?.id) return;
    const step = Number(dateStep) || 0;

    const targetIds = selectedNodeIds.includes(String(node.id))
      ? selectedNodeIds
      : [String(node.id)];

    let dateCount = 0;
    const byNode = new Map();
    targetIds.forEach((id) => {
      getDescendantIds(id, childrenByParent).forEach((nodeId) => {
        const current = sequenceGroups.get(nodeId)?.objects || [];
        byNode.set(nodeId, current);
      });
    });

    let updatedCount = 0;
    const promises = [];
    byNode.forEach((objects, nodeId) => {
      let hasChanges = false;
      const updated = objects.map((object) => {
        let nextDate = null;
        let nextEndDate = null;
        const offset = dateCount;

        if (date) {
          nextDate = addSequenceDays(date, offset, considerWeekend);
        } else {
          const currentDate = object?.assignedDate || object?.date;
          nextDate = step !== 0 && currentDate
            ? addSequenceDays(currentDate, step, considerWeekend)
            : null;
        }

        if (endDate) {
          nextEndDate = addSequenceDays(endDate, offset, considerWeekend);
        } else if (step !== 0) {
          const currentEndDate = object?.endDate || object?.end_date;
          nextEndDate = currentEndDate
            ? addSequenceDays(currentEndDate, step, considerWeekend)
            : null;
        }

        if (date || endDate) {
          dateCount += step;
        }

        const value = nextDate?.isValid()
          ? nextDate.format("YYYY-MM-DD")
          : null;
        const endValue = nextEndDate?.isValid()
          ? nextEndDate.format("YYYY-MM-DD")
          : null;

        if (
          object?.assignedDate === value &&
          object?.date === value &&
          (object?.endDate ?? object?.end_date ?? null) === endValue
        ) {
          return object;
        }

        hasChanges = true;
        updatedCount += 1;
        return {
          ...object,
          assignedDate: value,
          date: value,
          endDate: endValue,
        };
      });

      if (hasChanges) {
        promises.push(persistObjects({ nodeId, objects: updated }));
      }
    });

    Promise.all(promises)
      .then(() => updatedCount ? appMessage.success(`${updatedCount} object(s) updated.`) : appMessage.info("There are no objects to update."))
      .catch((error) => appMessage.error(error?.message || "Unable to assign dates."));
  }, [canEdit, selectedNodeIds, childrenByParent, sequenceGroups, persistObjects, appMessage]);

  const restoreLayerVisibility = useCallback(async () => {
    const tcapi = tcapiRef.current;
    const originalLayers = originalLayersRef.current;
    if (!tcapi || !originalLayers.size) return;

    await Promise.allSettled(
      [...originalLayers.entries()].map(([modelId, layers]) =>
        tcapi.viewer.setLayersVisibility(
          modelId,
          layers.map((layer) => ({ ...layer })),
        ),
      ),
    );
  }, []);

  const loadLayerOptions = useCallback(async () => {
    logLayer("Loading layers started");
    setLayerLoading(true);
    setLayerOptions([]);
    originalLayersRef.current = new Map();

    try {
      const tcapi = tcapiRef.current || (await WorkspaceAPI.connect(window.parent));
      tcapiRef.current = tcapi;

      const [modelObjectGroups, models] = await Promise.all([
        tcapi.viewer.getObjects(),
        tcapi.viewer.getModels().catch(() => []),
      ]);

      const loadedModelIds = [...new Set(
        (modelObjectGroups || [])
          .map((group) => group?.modelId)
          .filter((modelId) => modelId != null),
      )];
      logLayer("Loaded models discovered", {
        modelCount: loadedModelIds.length,
        modelIds: loadedModelIds,
      });

      const results = await Promise.allSettled(
        loadedModelIds.map(async (modelId) => {
          const layers = await tcapi.viewer.getLayers(modelId);
          const model = (models || []).find((item) =>
            [item?.id, item?.modelId, item?.fileId, item?.versionId]
              .filter((value) => value != null)
              .some((value) => String(value) === String(modelId)),
          );

          return {
            modelId,
            modelName: getModelDisplayName(model, modelId),
            layers: Array.isArray(layers) ? layers : [],
          };
        }),
      );

      const nextOptions = [];
      const originalLayers = new Map();

      results.forEach((result) => {
        if (result.status !== "fulfilled") return;

        const { modelId, modelName, layers } = result.value;
        originalLayers.set(
          String(modelId),
          layers.map((layer) => ({ ...layer })),
        );

        layers.forEach((layer, index) => {
          const layerName = String(layer?.name || "").trim();
          if (!layerName) return;

          nextOptions.push({
            key: `${String(modelId)}::${index}::${layerName}`,
            modelId: String(modelId),
            modelName,
            layerName,
            label: `${modelName} / ${layerName}`,
          });
        });
      });

      originalLayersRef.current = originalLayers;
      nextOptions.sort((left, right) =>
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
      setLayerOptions(nextOptions);
      logLayer("Loading layers completed", {
        modelCount: originalLayers.size,
        layerCount: nextOptions.length,
      });

      if (!nextOptions.length) {
        appMessage.info("No layers were found in the loaded models.");
      }
    } catch (error) {
      console.error("Load layers failed:", error);
      warnLayer("Loading layers failed", {
        message: error?.message,
        error,
      });
      appMessage.error(error?.message || "Unable to load model layers.");
    } finally {
      setLayerLoading(false);
    }
  }, [appMessage]);

  const resolveLayerSelections = useCallback(async (
    selectedOptions,
    {
      persistentOnly = false,
      restoreAfterResolve = true,
    } = {},
  ) => {
    const tcapi = tcapiRef.current || (await WorkspaceAPI.connect(window.parent));
    tcapiRef.current = tcapi;
    logLayer("Resolving layer objects started", {
      selectedLayerCount: selectedOptions?.length || 0,
      selectedLayers: (selectedOptions || []).slice(0, 20).map((option) => ({
        modelId: option.modelId,
        layerName: option.layerName,
      })),
      selectedLayersTruncated: (selectedOptions?.length || 0) > 20,
    });
    const selectedByModel = new Map();
    (selectedOptions || []).forEach((option) => {
      const modelId = String(option.modelId);
      if (!selectedByModel.has(modelId)) selectedByModel.set(modelId, new Set());
      selectedByModel.get(modelId).add(normalizeLayerName(option.layerName));
    });

    if (!selectedByModel.size) return [];

    try {
      await Promise.all(
        [...originalLayersRef.current.entries()].map(([modelId, layers]) =>
          tcapi.viewer.setLayersVisibility(
            modelId,
            layers.map((layer) => ({
              ...layer,
              visible: Boolean(
                selectedByModel
                  .get(String(modelId))
                  ?.has(normalizeLayerName(layer?.name)),
              ),
            })),
          ),
        ),
      );
      logLayer("Temporary layer visibility applied", {
        selectedModelCount: selectedByModel.size,
      });

      /* Allow the viewer to finish applying presentation-layer visibility. */
      await new Promise((resolve) => window.setTimeout(resolve, 250));

      const modelGroups = await tcapi.viewer.getObjects(undefined, {
        visible: true,
      });
      const candidateGroups = (modelGroups || [])
        .filter((group) => selectedByModel.has(String(group?.modelId)))
        .map((group) => ({
          modelId: group.modelId,
          candidateRuntimeIds: getRuntimeIdsFromModelGroup(group),
        }));

      await Promise.all(
        candidateGroups.map(async ({ modelId, candidateRuntimeIds }) => {
          const sampleRuntimeIds = candidateRuntimeIds.slice(
            0,
            LAYER_PROPERTY_LOG_SAMPLE_SIZE,
          );
          if (!sampleRuntimeIds.length) {
            warnLayer("No visible runtime IDs available for property logging", {
              modelId,
            });
            return;
          }

          try {
            const propertyItems = await tcapi.viewer.getObjectProperties(
              modelId,
              sampleRuntimeIds,
            );
            logLayer("Visible object properties sample", {
              modelId,
              selectedLayers: [...(selectedByModel.get(String(modelId)) || [])],
              visibleRuntimeCount: candidateRuntimeIds.length,
              sampleRuntimeIds,
              objects: sampleRuntimeIds.map((runtimeId, index) =>
                summarizeViewerPropertyItem(propertyItems?.[index], runtimeId),
              ),
            });
          } catch (error) {
            warnLayer("Unable to load visible object properties sample", {
              modelId,
              sampleRuntimeIds,
              message: error?.message,
              error,
            });
          }
        }),
      );

      const selections = (
        await Promise.all(
          candidateGroups.map(async ({ modelId, candidateRuntimeIds }) => {
            /*
             * Preview must use every visible runtime entity because the
             * Viewer can highlight layer/container entities even when they
             * do not have a persistent external ID. Assignment, however,
             * must resolve only persistable model objects.
             */
            const objectRuntimeIds = persistentOnly
              ? await resolvePersistentRuntimeIds(
                  tcapi,
                  modelId,
                  candidateRuntimeIds,
                )
              : candidateRuntimeIds;

            return {
              modelId,
              rawVisibleCount: candidateRuntimeIds.length,
              objectRuntimeIds,
            };
          }),
        )
      ).filter((selection) => selection.objectRuntimeIds.length > 0);

      logLayer("Layer objects resolved", {
        modelCount: selections.length,
        models: selections.map((selection) => ({
          modelId: selection.modelId,
          rawVisibleCount: selection.rawVisibleCount,
          assignableCount: selection.objectRuntimeIds.length,
          invalidEntityCount:
            selection.rawVisibleCount - selection.objectRuntimeIds.length,
        })),
        totalAssignableCount: selections.reduce(
          (total, selection) => total + selection.objectRuntimeIds.length,
          0,
        ),
        persistentOnly,
      });

      return selections.map(({ rawVisibleCount, ...selection }) => selection);
    } catch (error) {
      console.error("Resolve layer objects failed:", error);
      warnLayer("Resolving layer objects failed", {
        message: error?.message,
        error,
      });
      throw error;
    } finally {
      if (restoreAfterResolve) {
        await restoreLayerVisibility();
        logLayer("Original layer visibility restored");
      }
    }
  }, [restoreLayerVisibility]);

  const previewLayers = useCallback(async (layerKeys) => {
    const revision = layerPreviewRevisionRef.current + 1;
    layerPreviewRevisionRef.current = revision;
    const selectedKeys = new Set((layerKeys || []).map(String));
    const selectedOptions = layerOptions.filter((item) =>
      selectedKeys.has(String(item.key)),
    );
    const tcapi = tcapiRef.current;
    if (!tcapi) return;

    logLayer("Highlight requested", {
      revision,
      selectedLayerCount: selectedOptions.length,
    });

    try {
      if (!selectedOptions.length) {
        await restoreLayerVisibility();
        if (layerPreviewRevisionRef.current !== revision) return;
        await tcapi.viewer.setSelection(
          { modelObjectIds: [] },
          "set",
        );
        logLayer("Layer isolate cleared", { revision });
        return;
      }

      const selections = await resolveLayerSelections(selectedOptions, {
        persistentOnly: false,
        restoreAfterResolve: false,
      });
      if (layerPreviewRevisionRef.current !== revision) return;

      /*
       * Layer selection only isolates the Viewer. The user must explicitly
       * pick the objects to assign; never select every visible layer entity
       * automatically because getObjects({ visible: true }) can return a
       * model/hierarchy container representing the whole model.
       */
      await tcapi.viewer.setSelection(
        { modelObjectIds: [] },
        "set",
      );
      logLayer("Layers isolated; waiting for user object selection", {
        revision,
        visibleModelCount: selections.length,
        visibleEntityCount: selections.reduce(
          (total, selection) => total + selection.objectRuntimeIds.length,
          0,
        ),
      });
    } catch (error) {
      if (layerPreviewRevisionRef.current !== revision) return;
      warnLayer("Highlight failed", {
        revision,
        message: error?.message,
        error,
      });
      appMessage.error(error?.message || "Unable to highlight the selected layers.");
    }
  }, [layerOptions, resolveLayerSelections, appMessage]);

  const openAssignment = useCallback((node, mode) => {
    if (!canEdit || assignmentProcessing) return;

    const hasSubNodes =
      (childrenByParent.get(String(node?.id)) || []).length > 0;
    if (hasSubNodes) {
      appMessage.warning(
        "Items can only be assigned to a plan without sub plans.",
      );
      return;
    }

    setPendingAssignment({
      node,
      mode,
      date: dayjs(),
      withoutDate: false,
      layerKeys: [],
    });
    if (mode === "layer") {
      setLayerSelectedObjectCount(0);
      setLayerSearch("");
      loadLayerOptions();
    } else {
      /* Do not let an earlier layer preview affect picked-object assignment. */
      layerPreviewRevisionRef.current += 1;
      restoreLayerVisibility();
    }
  }, [
    canEdit,
    assignmentProcessing,
    childrenByParent,
    appMessage,
    loadLayerOptions,
    restoreLayerVisibility,
  ]);

  const closeAssignment = useCallback(() => {
    const wasLayerAssignment = pendingAssignment?.mode === "layer";
    layerPreviewRevisionRef.current += 1;
    setLayerSelectedObjectCount(0);
    setPendingAssignment(null);
    restoreLayerVisibility();
    if (wasLayerAssignment && tcapiRef.current) {
      tcapiRef.current.viewer
        .setSelection({ modelObjectIds: [] }, "set")
        .catch(() => undefined);
    }
  }, [pendingAssignment, restoreLayerVisibility]);

  const executeAssignment = useCallback(async () => {
    const assignment = pendingAssignment;
    if (!assignment?.node || assignmentProcessing) return;

    const selectedDate = assignment.withoutDate
      ? null
      : assignment.date?.startOf("day");
    if (!assignment.withoutDate && !selectedDate?.isValid()) {
      appMessage.warning("Please select an assigned date.");
      return;
    }

    const selectedLayerKeys = new Set(
      (assignment.layerKeys || []).map(String),
    );
    const selectedLayerOptions = assignment.mode === "layer"
      ? layerOptions.filter((item) => selectedLayerKeys.has(String(item.key)))
      : [];
    if (assignment.mode === "layer" && !selectedLayerOptions.length) {
      appMessage.warning("Please select at least one layer.");
      return;
    }

    /* Close immediately so manual point picking can continue in the Viewer. */
    setPendingAssignment(null);
    setAssignmentProcessing(true);

    if (assignment.mode === "layer") {
      logLayer("Assignment started", {
        nodeId: assignment.node.id,
        nodeName: assignment.node.name,
        selectedLayerCount: selectedLayerOptions.length,
        withoutDate: assignment.withoutDate,
        assignedDate: selectedDate?.isValid()
          ? selectedDate.format("YYYY-MM-DD")
          : null,
      });
    }

    try {
      const tcapi = tcapiRef.current || (await WorkspaceAPI.connect(window.parent));
      tcapiRef.current = tcapi;
      let selections;
      if (assignment.mode === "layer") {
        /* Layers only restrict visibility; assignment uses user-picked objects. */
        const viewerSelection = await tcapi.viewer.getSelection();
        logLayer("User object selection received", {
          modelCount: viewerSelection?.length || 0,
          objectCount: (viewerSelection || []).reduce(
            (total, selection) =>
              total + (selection?.objectRuntimeIds?.length || 0),
            0,
          ),
        });

        selections = (
          await Promise.all(
            (viewerSelection || []).map(async (selection) => ({
              modelId: selection.modelId,
              objectRuntimeIds: await resolvePersistentRuntimeIds(
                tcapi,
                selection.modelId,
                selection.objectRuntimeIds || [],
                logLayer,
                warnLayer,
              ),
            })),
          )
        ).filter((selection) => selection.objectRuntimeIds.length > 0);
      } else {
        const viewerSelection = await tcapi.viewer.getSelection();

        if (assignment.mode === "auto") {
          logPicked("Viewer selection received", {
            modelCount: viewerSelection?.length || 0,
            objectCount: (viewerSelection || []).reduce(
              (total, selection) =>
                total + (selection?.objectRuntimeIds?.length || 0),
              0,
            ),
          });

          selections = (
            await Promise.all(
              (viewerSelection || []).map(async (selection) => ({
                modelId: selection.modelId,
                objectRuntimeIds: await resolvePersistentRuntimeIds(
                  tcapi,
                  selection.modelId,
                  selection.objectRuntimeIds || [],
                  logPicked,
                  warnPicked,
                ),
              })),
            )
          ).filter((selection) => selection.objectRuntimeIds.length > 0);

          logPicked("Persistent objects resolved", {
            modelCount: selections.length,
            objectCount: selections.reduce(
              (total, selection) =>
                total + selection.objectRuntimeIds.length,
              0,
            ),
          });
        } else {
          selections = viewerSelection;
        }
      }
      if (!selections?.length) {
        if (assignment.mode === "layer") {
          warnLayer("No assignable objects found", {
            selectedLayerCount: selectedLayerOptions.length,
          });
        }
        appMessage.info(
          assignment.mode === "layer"
            ? "Please select at least one visible object in the model before assigning."
            : "Please select at least one object.",
        );
        return;
      }

      if (assignment.mode === "layer") {
        logLayer("Runtime objects ready for conversion", {
          modelCount: selections.length,
          objectCount: selections.reduce(
            (total, selection) => total + selection.objectRuntimeIds.length,
            0,
          ),
        });
      }

      const allExisting = [...sequenceGroups.values()].flatMap((group) => group.objects || []);
      const existingIds = new Set(allExisting.map((object) => String(getExternalId(object))).filter(Boolean));

      let referencePoint = null;
      if (assignment.mode === "manual") {
         appMessage.info(
          "Please pick a reference point in the model to assign objects."
        );
        tcapi.viewer.activateTool("pointMarkup");
        const point = await new Promise((resolve) => {
          const handler = (event) => {
            if (event.data?.event !== "viewer.onMarkupChanged") return;
            window.removeEventListener("message", handler);
            const start = event.data?.data?.data?.markup?.start;
            if (!start) return resolve(null);
            resolve([Number(start.positionX), Number(start.positionY), Number(start.positionZ)]);
          };
          window.addEventListener("message", handler);
        });
        referencePoint = point;
        await tcapi.viewer.activateTool("selection");
      }

      const newObjects = await createObjectsFromSelection({
        tcapi,
        selections,
        selectedDate,
        referencePoint,
        assignmentMode: assignment.mode,
      });

      if (assignment.mode === "layer") {
        logLayer("Runtime objects hydrated", {
          hydratedCount: newObjects.length,
        });
      }

      const unique = [];
      const seen = new Set();
      for (const object of newObjects) {
        const key = String(getExternalId(object));
        if (!key || existingIds.has(key) || seen.has(key)) continue;
        seen.add(key);
        unique.push(object);
      }

      if (referencePoint) unique.sort((a, b) => Number(a.distance) - Number(b.distance));

      if (!unique.length) {
        if (assignment.mode === "layer") {
          logLayer("Assignment stopped: all objects duplicated or invalid", {
            hydratedCount: newObjects.length,
            existingObjectCount: existingIds.size,
          });
        }
        appMessage.warning("No new objects were assigned because they are duplicated.");
        return;
      }

      const nodeId = assignment.node.id;
      const existing = sequenceGroups.get(String(nodeId))?.objects || [];
      if (assignment.mode === "layer") {
        logLayer("Persisting objects", {
          nodeId,
          existingCount: existing.length,
          newUniqueCount: unique.length,
          duplicateOrInvalidCount: newObjects.length - unique.length,
          finalCount: existing.length + unique.length,
        });
      }
      await persistObjects({ nodeId, objects: [...existing, ...unique] });
      if (assignment.mode === "layer") {
        logLayer("Assignment completed", {
          nodeId,
          assignedCount: unique.length,
        });
      }
      appMessage.success(
        assignment.mode === "layer"
          ? `${unique.length} object(s) assigned from ${selectedLayerOptions.length} layer(s).`
          : `${unique.length} object(s) assigned.`,
      );
    } catch (error) {
      console.error("Assign objects failed:", error);
      if (assignment.mode === "layer") {
        warnLayer("Assignment failed", {
          nodeId: assignment.node.id,
          message: error?.message,
          code: error?.code,
          details: error?.details,
          hint: error?.hint,
          error,
        });
      } else if (assignment.mode === "auto") {
        warnPicked("Assignment failed", {
          nodeId: assignment.node.id,
          message: error?.message,
          code: error?.code,
          details: error?.details,
          hint: error?.hint,
          error,
        });
      }
      appMessage.error(error?.message || "Assign objects failed.");
    } finally {
      if (assignment.mode === "layer") {
        await restoreLayerVisibility();
      }
      setAssignmentProcessing(false);
    }
  }, [
    pendingAssignment,
    assignmentProcessing,
    layerOptions,
    sequenceGroups,
    persistObjects,
    restoreLayerVisibility,
    appMessage,
  ]);

  const handleHighlightNode = useCallback(async (node) => {
    try {
      const objects = getNodeObjects(node.id);
      const groups = new Map();
      objects.forEach((object) => {
        if (object?.objectAvailable === false || object?.modelId == null || object?.runtimeId == null) return;
        const key = String(object.modelId);
        if (!groups.has(key)) groups.set(key, { modelId: object.modelId, objectRuntimeIds: new Set() });
        groups.get(key).objectRuntimeIds.add(object.runtimeId);
      });
      const modelObjectIds = [...groups.values()].map((group) => ({
        modelId: group.modelId,
        objectRuntimeIds: [...group.objectRuntimeIds],
      }));
      const tcapi = tcapiRef.current || (await WorkspaceAPI.connect(window.parent));
      tcapiRef.current = tcapi;
      await tcapi.viewer.setSelection({ modelObjectIds }, "set");
      if (!modelObjectIds.length) {
        appMessage.info("No loaded objects are available for highlighting.");
      }
    } catch (error) {
      console.error(error);
      appMessage.error("Unable to highlight the plan objects.");
    }
  }, [getNodeObjects, appMessage]);

  const handleShowOnlyNode = useCallback(async (node) => {
    try {
      const objects = getNodeObjects(node.id);
      const groups = new Map();
      objects.forEach((object) => {
        if (
          object?.objectAvailable === false ||
          object?.modelId == null ||
          object?.runtimeId == null
        ) {
          return;
        }
        const key = String(object.modelId);
        if (!groups.has(key)) {
          groups.set(key, {
            modelId: object.modelId,
            entityIds: new Set(),
          });
        }
        groups.get(key).entityIds.add(object.runtimeId);
      });

      const modelEntities = [...groups.values()].map((group) => ({
        modelId: group.modelId,
        entityIds: [...group.entityIds],
      }));
      if (!modelEntities.length) {
        appMessage.info("No loaded objects are available for Show Only.");
        return;
      }

      const tcapi = tcapiRef.current || (await WorkspaceAPI.connect(window.parent));
      tcapiRef.current = tcapi;
      await tcapi.viewer.setSelection({ modelObjectIds: [] }, "set");
      await tcapi.viewer.isolateEntities(modelEntities);
    } catch (error) {
      console.error(error);
      appMessage.error("Unable to show only the plan objects.");
    }
  }, [getNodeObjects, appMessage]);

  const handleSortByDate = useCallback(async (node) => {
    if (!canEdit) return;
    const objects = sequenceGroups.get(String(node.id))?.objects || [];
    if (objects.length < 2) {
      appMessage.info("There are not enough objects to sort.");
      return;
    }
    const sorted = [...objects].sort((a, b) => {
      const first = parseDate(a?.assignedDate || a?.date);
      const second = parseDate(b?.assignedDate || b?.date);
      if (!first && !second) return 0;
      if (!first) return 1;
      if (!second) return -1;
      const diff = first.valueOf() - second.valueOf();
      return diff || String(a?.externalId || "").localeCompare(String(b?.externalId || ""));
    });
    const updates = sorted.map((object, index) => ({
      dbId: object.dbId,
      externalId: getExternalId(object),
      sortDatetime: new Date(Date.now() + index).toISOString(),
    }));
    await updateSequenceObjectSortDatesForNode(updates);
    await refreshNodeGroup(node.id);
  }, [canEdit, sequenceGroups, appMessage, refreshNodeGroup]);

  const handleSimulation = useCallback((node) => {
    if (isFree || !node?.id) return;
    const descendantIds = getDescendantIds(node.id, childrenByParent);
    const simulationPlan = { ...node, id: String(node.id), name: node.name };
    const simulationSubPlans = descendantIds.map((id, index) => {
      const item = nodeMap.get(id);
      return {
        ...item,
        id: String(item.id),
        planId: String(node.id),
        parentPlanId: String(node.id),
        sortDatetime: new Date(Date.now() + index).toISOString(),
      };
    });
    const simulationObjects = descendantIds.map((id) => ({
      nodeId: id,
      planId: String(node.id),
      subPlanId: id,
      objects: (sequenceGroups.get(id)?.objects || []).map((object) => ({
        ...object,
        planId: String(node.id),
        subPlanId: id,
        nodeId: id,
      })),
    }));

    onSimulation?.({
      planId: String(node.id),
      subPlanId: null,
      simulationData: {
        plans: [simulationPlan],
        subPlans: simulationSubPlans,
        sequenceObjects: simulationObjects,
      },
    });
  }, [isFree, childrenByParent, nodeMap, sequenceGroups, onSimulation]);


  const handleReorderNodes = useCallback((parentId, reordered) => {
    const ids = new Set(reordered.map((item) => String(item.id)));
    const orderMap = new Map(reordered.map((item, index) => [String(item.id), index]));
    setNodes((current) =>
      current
        .map((node) =>
          ids.has(String(node.id))
            ? { ...node, sortOrder: orderMap.get(String(node.id)) ?? node.sortOrder }
            : node,
        )
        .sort((a, b) => {
          const aSame = String(getNodeParentId(a) ?? "__ROOT__") === String(parentId ?? "__ROOT__");
          const bSame = String(getNodeParentId(b) ?? "__ROOT__") === String(parentId ?? "__ROOT__");
          if (aSame && bSame) return getNodeSort(a) - getNodeSort(b);
          return 0;
        }),
    );
  }, []);

  const handleMoveNodeObjects = useCallback(async ({ sourceNodeId, targetNodeId, movedObjects }) => {
    const targetHasSubNodes =
      (childrenByParent.get(String(targetNodeId)) || []).length > 0;
    if (targetHasSubNodes) {
      appMessage.warning(
        "Items can only be moved to a plan without sub plans.",
      );
      return;
    }

    const dbIds = (movedObjects || []).map((object) => object?.dbId).filter(Boolean);
    if (!dbIds.length) return;
    await moveSequenceObjectsToNode({ objectIds: dbIds, targetNodeId });
    await loadData();
  }, [childrenByParent, appMessage, loadData]);

  const layerTreeData = useMemo(() => {
    const matcher = createWildcardMatcher(layerSearch);
    const byModel = new Map();

    layerOptions.forEach((option) => {
      const modelId = String(option.modelId);
      if (!byModel.has(modelId)) {
        byModel.set(modelId, {
          modelId,
          modelName: option.modelName,
          options: [],
        });
      }
      byModel.get(modelId).options.push(option);
    });

    return [...byModel.values()]
      .map((model) => {
        const modelMatches = matcher?.test(String(model.modelName || ""));
        const children = model.options
          .filter((option) =>
            !matcher ||
            modelMatches ||
            matcher.test(option.layerName) ||
            matcher.test(option.label),
          )
          .map((option) => ({
            key: option.key,
            title: option.layerName,
            isLeaf: true,
          }));

        if (!children.length) return null;

        return {
          key: `model::${model.modelId}`,
          title: `${model.modelName} (${children.length})`,
          children,
        };
      })
      .filter(Boolean);
  }, [layerOptions, layerSearch]);

  const rootNodes = childrenByParent.get("__ROOT__") || [];

  const copyNodesSourceTreeData = useMemo(() => {
    const buildSourceNode = (node) => {
      const children = childrenByParent.get(String(node.id)) || [];
      const isTarget = String(node.id) === String(copyNodesTarget?.id || "");
      return {
        key: String(node.id),
        title: `${node.name || "Unnamed Plan"} (${children.length} sub plan${children.length === 1 ? "" : "s"})`,
        disabled: isTarget || children.length === 0,
        children: children.map(buildSourceNode),
      };
    };

    return rootNodes.map(buildSourceNode);
  }, [rootNodes, childrenByParent, copyNodesTarget]);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        overflowX: "hidden",
        boxSizing: "border-box",
      }}
    >
      {pendingAssignment && (
        <Modal
          title={
            pendingAssignment.mode === "auto"
              ? "Assign Picked Assemblies"
              : pendingAssignment.mode === "layer"
                ? "Assign by Layer"
                : "Assign Multiple Assemblies"
          }
          open
          okText={pendingAssignment.mode === "layer" ? "Assign" : "Continue"}
          cancelText="Cancel"
          onOk={executeAssignment}
          onCancel={closeAssignment}
          destroyOnHidden
          maskClosable={false}
          okButtonProps={{
            disabled:
              pendingAssignment.mode === "layer" &&
              (
                layerLoading ||
                !(pendingAssignment.layerKeys || []).length ||
                layerSelectedObjectCount < 1
              ),
            loading: layerLoading,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pendingAssignment.mode === "layer" && (
              <>
                <Input.Search
                  value={layerSearch}
                  allowClear
                  placeholder="Search layers: Steel*, *Grid*, Level-?"
                  onChange={(event) => setLayerSearch(event.target.value)}
                />

                <div
                  style={{
                    border: "1px solid #d9d9d9",
                    borderRadius: 6,
                    minHeight: 160,
                    maxHeight: 280,
                    overflow: "auto",
                    padding: "6px 4px",
                  }}
                >
                  {layerLoading ? (
                    <div style={{ padding: 24, textAlign: "center" }}>
                      <Spin size="small" />
                    </div>
                  ) : layerTreeData.length ? (
                    <Tree
                      key={`layers-${layerOptions.length}`}
                      checkable
                      blockNode
                      defaultExpandAll
                      treeData={layerTreeData}
                      checkedKeys={pendingAssignment.layerKeys || []}
                      onCheck={(checkedKeys) => {
                        const checkedSet = new Set(
                          (Array.isArray(checkedKeys)
                            ? checkedKeys
                            : checkedKeys?.checked || []
                          ).map(String),
                        );
                        const layerKeys = layerOptions
                          .filter((option) => checkedSet.has(String(option.key)))
                          .map((option) => option.key);

                        logLayer("Layer selection changed", {
                          selectedLayerCount: layerKeys.length,
                          search: layerSearch,
                        });

                        setPendingAssignment((current) => ({
                          ...current,
                          layerKeys,
                        }));
                        previewLayers(layerKeys);
                      }}
                    />
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="No matching layers"
                    />
                  )}
                </div>

                <div style={{ color: "rgba(0, 0, 0, 0.55)", fontSize: 12 }}>
                  {(pendingAssignment.layerKeys || []).length} layer(s) selected
                  {` • ${layerSelectedObjectCount} object(s) selected`}
                </div>

                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "#e6f4ff",
                    color: "#0958d9",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  Select the required objects in the 3D Viewer, then click Assign.
                </div>
              </>
            )}

            <Checkbox
              checked={Boolean(pendingAssignment.withoutDate)}
              onChange={(event) =>
                setPendingAssignment((current) => ({
                  ...current,
                  withoutDate: event.target.checked,
                }))
              }
            >
              Assign without date
            </Checkbox>

            <DatePicker 
              value={pendingAssignment.date || dayjs()}
              format="DD-MM-YYYY"
              allowClear={false}
              disabled={Boolean(pendingAssignment.withoutDate)}
              style={{ width: "100%" }}
              onChange={(date) =>
                setPendingAssignment((current) => ({ ...current, date }))
              }
            />
          </div>
        </Modal>
      )}

      {copyNodesTarget && (
        <Modal
          title={`Copy Plans/Sub Plans Into ${copyNodesTarget.name || "Plans/Sub Plans"}`}
          open
          okText="Copy Plans/Sub Plans"
          cancelText="Cancel"
          confirmLoading={copyNodesProcessing}
          okButtonProps={{ disabled: !copyNodesSourceId }}
          onOk={confirmCopyNodesFrom}
          onCancel={closeCopyNodesFrom}
          maskClosable={false}
          destroyOnHidden
        >
          <div style={{ marginBottom: 10, color: "rgba(0, 0, 0, 0.65)" }}>
            Select a source Plan/Sub Plan.
          </div>
          <div
            style={{
              maxHeight: 360,
              overflow: "auto",
              border: "1px solid #d9d9d9",
              borderRadius: 6,
              padding: 8,
            }}
          >
            <Tree
              blockNode
              defaultExpandAll
              treeData={copyNodesSourceTreeData}
              selectedKeys={copyNodesSourceId ? [String(copyNodesSourceId)] : []}
              onSelect={(selectedKeys) => {
                setCopyNodesSourceId(selectedKeys?.[0] || null);
              }}
            />
          </div>
        </Modal>
      )}

      {modalOpen && (
        <SubPlanModal
          title={editingNode ? "Edit Plan/Sub Plan" : "Create Plan/Sub Plan"}
          buttonName={editingNode ? "Modify" : "Create"}
          plan={creatingParent}
          subPlan={editingNode}
          open
          onCancel={handleModalCancel}
          isEditing={Boolean(editingNode)}
          nodeMode
          projectIdOverride={effectiveProjectId}
          onCreateOverride={({ names, parentId, color, items }) =>
            handleCreateNodes({ names, parentId, color, items })
          }
          onUpdateOverride={handleUpdateNode}
          entityLabel="Node"
        />
      )}

      <Spin
        spinning={loading || assignmentProcessing}
        tip={assignmentProcessing ? "Assigning items..." : undefined}
      >
        {!rootNodes.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Plans" />
        ) : (
          <NodeChildren
            parentId={null}
            level={0}
            childrenByParent={childrenByParent}
            nodeMap={nodeMap}
            sequenceGroups={sequenceGroups}
            nodes={nodes}
            selectedNodeIds={selectedNodeIds}
            setSelectedNodeIds={setSelectedNodeIds}
            canEdit={canEdit}
            isViewer={isViewer}
            isFree={isFree}
            loadedModelIds={loadedModelIds}
            activeSimulationItem={activeSimulationItem}
            displayIndexMap={displayIndexMap}
            onEdit={handleEdit}
            onDelete={handleDeleteNode}
            onCreateChild={handleCreateChild}
            onCopyNode={handleCopyNode}
            onCopyNodesFrom={openCopyNodesFrom}
            onAssignDate={handleAssignDate}
            onAssignObject={(node) => openAssignment(node, "manual")}
            onAutoAssign={(node) => openAssignment(node, "auto")}
            onAssignByLayer={(node) => openAssignment(node, "layer")}
            onSimulation={handleSimulation}
            onSortByDate={handleSortByDate}
            onHighlightNode={handleHighlightNode}
            onShowOnlyNode={handleShowOnlyNode}
            onPersistObjects={persistObjects}
            onMoveObjects={handleMoveNodeObjects}
            onReorderNodes={handleReorderNodes}
          />
        )}
      </Spin>
    </div>
  );
}
