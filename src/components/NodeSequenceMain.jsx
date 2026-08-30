import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Checkbox, Collapse, DatePicker, Empty, Modal, Spin, message } from "antd";
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
    const hex = color.trim().replace(/^#/, "");
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

const createObjectsFromSelection = async ({ tcapi, selections, selectedDate, referencePoint = null }) => {
  const result = [];
  for (const selection of selections || []) {
    const runtimeIds = selection?.objectRuntimeIds || [];
    if (!runtimeIds.length) continue;

    const [objectIds, boundingBoxes, propertyItems] = await Promise.all([
      tcapi.viewer.convertToObjectIds(selection.modelId, runtimeIds),
      tcapi.viewer.getObjectBoundingBoxes(selection.modelId, runtimeIds).catch(() => []),
      tcapi.viewer.getObjectProperties(selection.modelId, runtimeIds),
    ]);

    for (let index = 0; index < runtimeIds.length; index += 1) {
      const runtimeId = runtimeIds[index];
      const externalId = objectIds?.[index];
      if (externalId == null) continue;

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
  onAssignDate,
  onAssignObject,
  onAutoAssign,
  onSimulation,
  onSortByDate,
  onHighlightNode,
  onPersistObjects,
  onMoveObjects,
  onReorderNodes,
}) {
  const children = childrenByParent.get(String(node.id)) || [];
  const directObjectCount =
    sequenceGroups.get(String(node.id))?.objects?.length || 0;
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
          onAssignObject={canEdit ? onAssignObject : undefined}
          onAutoAssign={canEdit ? onAutoAssign : undefined}
          assignItemsDisabled={children.length > 0}
          onCopySubPlan={canEdit ? onCopyNode : undefined}
          onSortByDate={canEdit ? onSortByDate : undefined}
          onHighlightObject={onHighlightNode}
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
              onAssignDate={onAssignDate}
              onAssignObject={onAssignObject}
              onAutoAssign={onAutoAssign}
              onSimulation={onSimulation}
              onSortByDate={onSortByDate}
              onHighlightNode={onHighlightNode}
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
              moveTargets={nodes}
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
    onEdit, onDelete, onCreateChild, onAssignObject, onAutoAssign,
    onCopyNode, onSortByDate, onHighlightNode, onAssignDate, onSimulation,
    children, level, childrenByParent, nodeMap, sequenceGroups, nodes,
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
  const [pendingAssignment, setPendingAssignment] = useState(null);
  const [assignmentProcessing, setAssignmentProcessing] = useState(false);
  const tcapiRef = useRef(null);
  const sequenceGroupsRef = useRef(new Map());
  const persistRevisionRef = useRef(new Map());

  useEffect(() => {
    sequenceGroupsRef.current = sequenceGroups;
  }, [sequenceGroups]);

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
    setEditingNode(null);
    setCreatingParent(node);
    setModalOpen(true);
  }, [canEdit]);

  const handleModalCancel = useCallback(() => {
    setModalOpen(false);
    setEditingNode(null);
    setCreatingParent(null);
  }, []);

  const handleCreateNodes = useCallback(async ({ names, parentId, color }) => {
    for (let index = 0; index < names.length; index += 1) {
      await createNode({
        trimbleProjectId: effectiveProjectId,
        parentId,
        name: names[index],
        color,
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
        name: `${source.name} Copy`,
        color: source.color ?? null,
        nodeType: source.nodeType,
        sortOrder: getNodeSort(source) + 1,
      });
      idMap.set(sourceId, copy.id);
    }
    await loadData();
  }, [canEdit, childrenByParent, nodeMap, effectiveProjectId, loadData]);

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

  const openAssignment = useCallback((node, mode) => {
    if (!canEdit || assignmentProcessing) return;

    const hasSubNodes =
      (childrenByParent.get(String(node?.id)) || []).length > 0;
    if (hasSubNodes) {
      appMessage.warning(
        "Items can only be assigned to a node without sub nodes.",
      );
      return;
    }

    setPendingAssignment({ node, mode, date: dayjs(), withoutDate: false });
  }, [canEdit, assignmentProcessing, childrenByParent, appMessage]);

  const closeAssignment = useCallback(() => setPendingAssignment(null), []);

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

    /* Close immediately so manual point picking can continue in the Viewer. */
    setPendingAssignment(null);
    setAssignmentProcessing(true);

    try {
      const tcapi = tcapiRef.current || (await WorkspaceAPI.connect(window.parent));
      tcapiRef.current = tcapi;
      const selections = await tcapi.viewer.getSelection();
      if (!selections?.length) {
        appMessage.info("Please select at least one object.");
        return;
      }
      
      const allExisting = [...sequenceGroups.values()].flatMap((group) => group.objects || []);
      const existingIds = new Set(allExisting.map((object) => String(getExternalId(object))).filter(Boolean));

      let referencePoint = null;
      if (assignment.mode === "manual") {
        appMessage.info("Please pick a reference point in the model.");
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
      });

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
        appMessage.info("No new objects were assigned because they were duplicates.");
        return;
      }

      const nodeId = assignment.node.id;
      const existing = sequenceGroups.get(String(nodeId))?.objects || [];
      await persistObjects({ nodeId, objects: [...existing, ...unique] });
      appMessage.success(`${unique.length} object(s) assigned.`);
    } catch (error) {
      console.error("Assign objects failed:", error);
      appMessage.error(error?.message || "Assign objects failed.");
    } finally {
      setAssignmentProcessing(false);
    }
  }, [pendingAssignment, assignmentProcessing, sequenceGroups, persistObjects, appMessage]);

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
      const modelObjectIds = [...groups.values()].map((group) => ({ modelId: group.modelId, objectRuntimeIds: [...group.objectRuntimeIds] }));
      const tcapi = tcapiRef.current || (await WorkspaceAPI.connect(window.parent));
      tcapiRef.current = tcapi;
      await tcapi.viewer.setSelection({ modelObjectIds }, "set");
      if (!modelObjectIds.length) appMessage.info("No loaded objects are available for highlighting.");
    } catch (error) {
      console.error(error);
      appMessage.error("Unable to highlight the node objects.");
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
    const dbIds = (movedObjects || []).map((object) => object?.dbId).filter(Boolean);
    if (!dbIds.length) return;
    await moveSequenceObjectsToNode({ objectIds: dbIds, targetNodeId });
    await loadData();
  }, [loadData]);

  const rootNodes = childrenByParent.get("__ROOT__") || [];

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
          title={pendingAssignment.mode === "auto" ? "Assign Picked Items" : "Assign Multiple Items"}
          open
          okText="Continue"
          cancelText="Cancel"
          onOk={executeAssignment}
          onCancel={closeAssignment}
          destroyOnHidden
          maskClosable={false}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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

      {modalOpen && (
        <SubPlanModal
          title={editingNode ? "Edit Node" : "Create Node"}
          buttonName={editingNode ? "Modify" : "Create"}
          plan={creatingParent}
          subPlan={editingNode}
          open
          onCancel={handleModalCancel}
          isEditing={Boolean(editingNode)}
          nodeMode
          projectIdOverride={effectiveProjectId}
          onCreateOverride={({ names, parentId, color }) => handleCreateNodes({ names, parentId, color })}
          onUpdateOverride={handleUpdateNode}
          entityLabel="Node"
        />
      )}

      <Spin
        spinning={loading || assignmentProcessing}
        tip={assignmentProcessing ? "Assigning items..." : undefined}
      >
        {!rootNodes.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Nodes" />
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
            onAssignDate={handleAssignDate}
            onAssignObject={(node) => openAssignment(node, "manual")}
            onAutoAssign={(node) => openAssignment(node, "auto")}
            onSimulation={handleSimulation}
            onSortByDate={handleSortByDate}
            onHighlightNode={handleHighlightNode}
            onPersistObjects={persistObjects}
            onMoveObjects={handleMoveNodeObjects}
            onReorderNodes={handleReorderNodes}
          />
        )}
      </Spin>
    </div>
  );
}
