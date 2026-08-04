import React, {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  Empty,
  List,
  Dropdown,
  Button,
  DatePicker,
  Input,
  Tooltip,
  App,
} from "antd";
import * as WorkspaceAPI from "trimble-connect-workspace-api";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import {
  useSortable,
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";

import {
  FileOutlined,
  DeleteOutlined,
  EditOutlined,
  CloseOutlined,
  CameraOutlined,
  EyeInvisibleOutlined,
  ZoomInOutlined,
} from "@ant-design/icons";

import {
  SetObjectsRequest,
  SetActiveSimulationItem,
  UpdateSequenceObjectSortDatesRequest,
} from "../store/sequence/action";

import {
  DEFAULT_FORMATTING,
  convertMassFromKg,
  getDisplayMassUnit,
  normalizeProjectFormatting,
} from "../utils/projectFormatting";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

/*
 * Supabase stores stable object references:
 * - modelExternalId / model_external_id
 * - externalId / external_id
 *
 * Runtime model IDs and runtime object IDs are resolved from Trimble Connect.
 */

const getInternalObjectId = (obj) =>
  obj?.externalId ?? obj?.external_id ?? obj?.objectId ?? obj?.id ?? null;

const getObjectModelId = (obj) =>
  obj?.modelId ?? obj?.modelExternalId ?? obj?.model_external_id ?? null;

const getStableModelId = (obj) =>
  obj?.modelExternalId ?? obj?.model_external_id ?? obj?.modelId ?? null;

const getObjectKey = (obj) => {
  const modelId = getStableModelId(obj);
  const objectId = getInternalObjectId(obj);

  return `${String(modelId)}-${String(objectId)}`;
};

const getObjectDate = (obj) => obj?.date || obj?.assignedDate || "";

const isSameObject = (first, second) => {
  if (!first || !second) {
    return false;
  }

  return (
    String(getObjectModelId(first)) === String(getObjectModelId(second)) &&
    String(getInternalObjectId(first)) === String(getInternalObjectId(second))
  );
};

const createSortDatesBetween = ({ previousItem, nextItem, count }) => {
  if (!Number.isInteger(count) || count <= 0) {
    return [];
  }

  const defaultGap = 1000;

  const previousTime = previousItem?.sortDatetime
    ? new Date(previousItem.sortDatetime).getTime()
    : null;

  const nextTime = nextItem?.sortDatetime
    ? new Date(nextItem.sortDatetime).getTime()
    : null;

  if (previousTime == null && nextTime == null) {
    const baseTime = Date.now();

    return Array.from({ length: count }, (_, index) =>
      new Date(baseTime + index).toISOString(),
    );
  }

  if (previousTime == null) {
    return Array.from({ length: count }, (_, index) =>
      new Date(nextTime - defaultGap * (count - index)).toISOString(),
    );
  }

  if (nextTime == null) {
    return Array.from({ length: count }, (_, index) =>
      new Date(previousTime + defaultGap * (index + 1)).toISOString(),
    );
  }

  const availableGap = nextTime - previousTime;
  const step = availableGap / (count + 1);

  if (step < 1) {
    throw new Error(
      "There is not enough sort_datetime space between adjacent objects.",
    );
  }

  return Array.from({ length: count }, (_, index) =>
    new Date(previousTime + Math.floor(step * (index + 1))).toISOString(),
  );
};

const SortableSubItem = React.memo(
  ({
    item,
    displayIndex,
    icon,

    selectedIds,
    setSelectedIds,

    lastSelected,
    setLastSelected,

    setFocusedIndex,
    currentObjects,

    onAssignDate,
    onDelete,
    onDeleteMulti,

    selectObjectsInViewer,
    setActiveItem,
    listRef,

    onAddCamera,
    onChangeCamera,
    onDeleteCamera,
    onZoomIn,

    projectFormatting,
    isOwner = false,
  }) => {
    const { message } = App.useApp();

    const [assignDate, setAssignDate] = useState(null);

    const [dateStep, setDateStep] = useState(0);

    const sortableId = getObjectKey(item);

    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({
        id: sortableId,
        disabled: !isOwner,
      });

    const isSelected = selectedIds.some((selected) =>
      isSameObject(selected, item),
    );

    const style = {
      transform: CSS.Transform.toString(transform),

      transition,
      cursor: "pointer",

      background: isSelected ? "#e6f4ff" : undefined,

      paddingLeft: 10,
      paddingRight: 2,

      border: isSelected ? "1px solid #91caff" : undefined,
    };

    const displayWeight = useMemo(() => {
      const rawWeight = item?.rawWeight ?? item?.weight;

      if (rawWeight == null || !Number.isFinite(Number(rawWeight))) {
        return null;
      }

      return convertMassFromKg(rawWeight, projectFormatting);
    }, [item?.rawWeight, item?.weight, projectFormatting]);

    const displayWeightUnit = useMemo(
      () => getDisplayMassUnit(projectFormatting),
      [projectFormatting],
    );

    const handleClick = async (event) => {
      event.stopPropagation();

      listRef.current?.focus();

      const isCtrlSelect = event.ctrlKey || event.metaKey;

      const isShiftSelect = event.shiftKey;

      let nextSelection = [];

      if (isShiftSelect && lastSelected) {
        const startIndex = currentObjects.findIndex((obj) =>
          isSameObject(obj, lastSelected),
        );

        const endIndex = currentObjects.findIndex((obj) =>
          isSameObject(obj, item),
        );

        if (startIndex !== -1 && endIndex !== -1) {
          const range = currentObjects.slice(
            Math.min(startIndex, endIndex),
            Math.max(startIndex, endIndex) + 1,
          );

          nextSelection = [
            ...new Map(
              [...selectedIds, ...range].map((obj) => [getObjectKey(obj), obj]),
            ).values(),
          ];

          setSelectedIds(nextSelection);

          setLastSelected(item);
        }
      } else if (isCtrlSelect) {
        const exists = selectedIds.some((selected) =>
          isSameObject(selected, item),
        );

        nextSelection = exists
          ? selectedIds.filter((selected) => !isSameObject(selected, item))
          : [...selectedIds, item];

        setSelectedIds(nextSelection);

        setLastSelected(item);
      } else {
        nextSelection = [item];

        setSelectedIds(nextSelection);

        setLastSelected(item);
        setActiveItem(item);
      }

      const clickedIndex = currentObjects.findIndex((obj) =>
        isSameObject(obj, item),
      );

      if (clickedIndex !== -1) {
        setFocusedIndex(clickedIndex);
      }

      await selectObjectsInViewer(nextSelection);
    };

    const handleDeleteClick = (event) => {
      event.stopPropagation();

      if (!isOwner) {
        return;
      }

      onDelete(item);
    };

    const handleGoToCamera = useCallback(
      async (selectedItem) => {
        if (!selectedItem?.camera) {
          message.warning("This item does not have a saved camera.");

          return;
        }

        try {
          const tcapi = await WorkspaceAPI.connect(window.parent);

          await tcapi.viewer.setCamera(selectedItem.camera, {
            animationTime: 1000,
          });
        } catch (error) {
          console.error("Go to camera failed:", error);

          message.error("Unable to restore the saved camera.");
        }
      },
      [message],
    );

    const contextMenuItems = useMemo(() => {
      const items = [
        {
          key: "zoomIn",
          icon: <ZoomInOutlined />,
          label: "Zoom To Selected",

          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onZoomIn(item);
          },
        },
      ];

      /*
       * Viewer can only use read-only actions.
       */
      if (!isOwner) {
        return items;
      }

      items.unshift(
        {
          key: "assignDate",
          label: (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <DatePicker
                size="small"
                value={assignDate}
                onChange={setAssignDate}
              />

              <Input
                size="small"
                type="number"
                style={{
                  width: 50,
                }}
                value={dateStep}
                onChange={(event) => setDateStep(event.target.value)}
              />

              <Button
                size="small"
                type="text"
                disabled={!assignDate && !dateStep}
                icon={<EditOutlined />}
                onClick={(event) => {
                  event.stopPropagation();

                  onAssignDate(assignDate, dateStep);
                }}
              />
            </div>
          ),
        },

        {
          type: "divider",
        },
      );

      items.push(
        {
          key: "addView",
          icon: <CameraOutlined />,
          label: "Add Camera",

          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onAddCamera(item);
          },
        },

        {
          key: "updateView",
          icon: <CameraOutlined />,
          label: "Change Camera",

          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onChangeCamera(item);
          },
        },

        {
          key: "deleteView",
          danger: true,
          icon: <EyeInvisibleOutlined />,
          label: "Delete Camera",

          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onDeleteCamera(item);
          },
        },

        {
          type: "divider",
        },

        {
          key: "delete",
          danger: true,
          icon: <DeleteOutlined />,
          label: "Delete",

          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            onDeleteMulti();
          },
        },
      );

      return items;
    }, [
      assignDate,
      dateStep,
      isOwner,
      item,
      onAddCamera,
      onAssignDate,
      onChangeCamera,
      onDeleteCamera,
      onDeleteMulti,
      onZoomIn,
    ]);

    const displayDate = getObjectDate(item);

    return (
      <Dropdown
        trigger={["contextMenu"]}
        menu={{
          items: contextMenuItems,
        }}
      >
        <List.Item
          ref={setNodeRef}
          data-object-key={sortableId}
          style={style}
          {...attributes}
          onClick={handleClick}
          tabIndex={-1}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              gap: 8,
            }}
          >
            {isOwner ? (
              <span
                {...listeners}
                style={{
                  display: "flex",
                  alignItems: "center",
                  cursor: "grab",
                  flexShrink: 0,
                  touchAction: "none",
                }}
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                {icon}
              </span>
            ) : (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexShrink: 0,
                }}
              >
                {icon}
              </span>
            )}

            <strong
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  minWidth: 24,
                  marginRight: 8,
                }}
              >
                {`${displayIndex}:`}
              </span>

              {item.asmPos || item.id}

              {item.positionCode ? ` [${item.positionCode}]` : ""}

              {displayWeight != null
                ? ` (${displayWeight} ${displayWeightUnit})`
                : ""}

              {/*
               *
               * {displayLength != null
               *   ? ` [${displayLength} ${
               *       displayLengthUnit ===
               *       "ft-in"
               *         ? ""
               *         : displayLengthUnit
               *     }]`
               *   : ""}
               */}
            </strong>

            <div
              style={{
                flex: 1,
              }}
            />

            {displayDate && (
              <span
                style={{
                  opacity: 0.7,
                  whiteSpace: "nowrap",
                }}
              >
                {displayDate}
              </span>
            )}

            {item.camera && (
              <Tooltip title="Go to saved camera">
                <CameraOutlined
                  onClick={(event) => {
                    event.stopPropagation();

                    handleGoToCamera(item);
                  }}
                  style={{
                    color: "#1677ff",
                    fontSize: 16,
                    cursor: "pointer",
                  }}
                />
              </Tooltip>
            )}

            {isOwner && (
              <Button
                type="text"
                icon={<CloseOutlined />}
                onClick={handleDeleteClick}
              />
            )}
          </div>
        </List.Item>
      </Dropdown>
    );
  },
);

const SequenceObjectCollapse = ({
  subPlan,
  activeSimulationItem,
  displayIndexMap,
  isOwner = false,
}) => {
  const dispatch = useDispatch();

  const sequenceObjects = useSelector(
    (state) => state.sequence.sequenceObjects || [],
  );

  const projectId = useSelector((state) => state.sequence.projectId || "");

  const loading = useSelector((state) => state.sequence.pending);

  const [selectedIds, setSelectedIds] = useState([]);

  const [lastSelected, setLastSelected] = useState(null);

  const [focusedIndex, setFocusedIndex] = useState(0);

  const [localObjects, setLocalObjects] = useState([]);

  const [projectFormatting, setProjectFormatting] =
    useState(DEFAULT_FORMATTING);

  const tcapiRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    const connectApi = async () => {
      try {
        const tcapi = await WorkspaceAPI.connect(window.parent);

        tcapiRef.current = tcapi;

        const settings = await tcapi.project.getSettings();

        const formatting = normalizeProjectFormatting(
          settings?.formatting || DEFAULT_FORMATTING,
        );

        if (mounted) {
          setProjectFormatting(formatting);
        }
      } catch (error) {
        console.error("Connect Trimble API failed:", error);

        if (mounted) {
          setProjectFormatting(DEFAULT_FORMATTING);
        }
      }
    };

    connectApi();

    return () => {
      mounted = false;
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const reduxObjects = useMemo(() => {
    const subPlanObjects = sequenceObjects.find(
      (group) => group && String(group.subPlanId) === String(subPlan.id),
    );

    return subPlanObjects?.objects || [];
  }, [sequenceObjects, subPlan.id]);

  useEffect(() => {
    setLocalObjects(reduxObjects);
  }, [reduxObjects]);

  const currentObjects = localObjects;

  const items = useMemo(() => {
    const result = [];

    sequenceObjects.forEach((group) => {
      const objects = group?.objects || [];

      objects.forEach((obj) => {
        const objectId = getInternalObjectId(obj);
        const modelId = getObjectModelId(obj);

        if (objectId == null || modelId == null) {
          return;
        }

        result.push({
          ...obj,
          objectId,
          planId: obj.planId ?? group.planId ?? group.id,
          subPlanId: obj.subPlanId ?? group.subPlanId,
          modelId,
          id: objectId,
        });
      });
    });

    return result;
  }, [sequenceObjects]);

  const updateObjects = useCallback(
    (objects) => {
      const nextObjects = Array.isArray(objects) ? objects : [];

      /*
       * Optimistic UI update:
       * do not wait for Supabase before rendering
       * the new order or edited values.
       */
      setLocalObjects(nextObjects);

      if (!projectId) {
        console.error("Trimble project ID is missing.");
        return;
      }

      dispatch(
        SetObjectsRequest({
          projectId,
          planId: subPlan.planId,
          subPlanId: subPlan.id,
          objects: nextObjects,
        }),
      );
    },
    [dispatch, projectId, subPlan.id, subPlan.planId],
  );

  /*
   * Convert danh sách Internal Object ID sang Runtime ID theo từng model.
   * Mỗi model chỉ gọi convertToObjectRuntimeIds một lần.
   */
  const resolveViewerModelObjects = useCallback(async (objects) => {
    const tcapi =
      tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

    tcapiRef.current = tcapi;

    if (!objects?.length) {
      return [];
    }

    const modelGroups = new Map();

    objects.forEach((item) => {
      const objectId = getInternalObjectId(item);

      const modelId = getObjectModelId(item);

      if (modelId == null || objectId == null) {
        return;
      }

      const modelKey = String(modelId);

      if (!modelGroups.has(modelKey)) {
        modelGroups.set(modelKey, {
          modelId,
          objectIds: [],
        });
      }

      modelGroups.get(modelKey).objectIds.push(objectId);
    });

    const modelObjectIds = [];

    for (const group of modelGroups.values()) {
      const objectIds = [
        ...new Map(
          group.objectIds.map((objectId) => [String(objectId), objectId]),
        ).values(),
      ];

      if (!objectIds.length) {
        continue;
      }

      let objectRuntimeIds = [];

      try {
        objectRuntimeIds = await tcapi.viewer.convertToObjectRuntimeIds(
          group.modelId,
          objectIds,
        );
      } catch (error) {
        console.error("convertToObjectRuntimeIds failed:", {
          modelId: group.modelId,
          objectIds,
          error,
        });

        continue;
      }

      const validRuntimeIds = (objectRuntimeIds || []).filter(
        (runtimeId) => runtimeId != null,
      );

      if (!validRuntimeIds.length) {
        continue;
      }

      modelObjectIds.push({
        modelId: group.modelId,
        objectRuntimeIds: [...new Set(validRuntimeIds)],
      });
    }

    return modelObjectIds;
  }, []);

  const selectObjectsInViewer = useCallback(
    async (objects) => {
      try {
        const tcapi =
          tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

        tcapiRef.current = tcapi;

        const modelObjectIds = await resolveViewerModelObjects(objects);

        if (!modelObjectIds.length) {
          return;
        }

        await tcapi.viewer.setSelection(
          {
            modelObjectIds,
          },
          "set",
        );
      } catch (error) {
        console.error("Select objects error:", error);
      }
    },
    [resolveViewerModelObjects],
  );

  const changeIndex = useCallback(
    async (newIndex) => {
      if (!items.length) {
        return;
      }

      const safeIndex = Math.max(0, Math.min(newIndex, items.length - 1));

      const item = items[safeIndex];

      dispatch(
        SetActiveSimulationItem({
          planId: item.planId,

          subPlanId: item.subPlanId,

          modelId: getObjectModelId(item),

          id: getInternalObjectId(item),
          objectId: getInternalObjectId(item),
        }),
      );

      await selectObjectsInViewer([item]);
    },
    [items, dispatch, selectObjectsInViewer],
  );

  const getCurrentIndex = useCallback(() => {
    if (activeSimulationItem) {
      return items.findIndex(
        (item) =>
          String(item.subPlanId) === String(activeSimulationItem.subPlanId) &&
          String(getObjectModelId(item)) ===
            String(activeSimulationItem.modelId) &&
          String(item.id) === String(activeSimulationItem.id),
      );
    }

    const currentItem = selectedIds[0] || currentObjects[focusedIndex];

    if (!currentItem) {
      return -1;
    }

    return items.findIndex(
      (item) =>
        String(item.subPlanId) ===
          String(currentItem.subPlanId || subPlan.id) &&
        isSameObject(item, currentItem),
    );
  }, [
    items,
    activeSimulationItem,
    selectedIds,
    currentObjects,
    focusedIndex,
    subPlan.id,
  ]);

  const next = useCallback(() => {
    const currentIndex = getCurrentIndex();

    if (currentIndex === -1) {
      changeIndex(0);
      return;
    }

    changeIndex(currentIndex + 1);
  }, [getCurrentIndex, changeIndex]);

  const prev = useCallback(() => {
    const currentIndex = getCurrentIndex();

    if (currentIndex === -1) {
      changeIndex(0);
      return;
    }

    changeIndex(currentIndex - 1);
  }, [getCurrentIndex, changeIndex]);

  const setActiveItem = useCallback(
    (item) => {
      const objectId = getInternalObjectId(item);

      dispatch(
        SetActiveSimulationItem({
          planId: item.planId,

          subPlanId: item.subPlanId || subPlan.id,

          modelId: getObjectModelId(item),

          id: objectId,
          objectId,
        }),
      );
    },
    [dispatch, subPlan.id],
  );

  useEffect(() => {
    if (!activeSimulationItem || !currentObjects.length) {
      return;
    }

    if (String(activeSimulationItem.subPlanId) !== String(subPlan.id)) {
      return;
    }

    const index = currentObjects.findIndex(
      (item) =>
        String(getObjectModelId(item)) ===
          String(activeSimulationItem.modelId) &&
        String(getInternalObjectId(item)) ===
          String(activeSimulationItem.objectId ?? activeSimulationItem.id),
    );

    if (index === -1) {
      return;
    }

    const item = currentObjects[index];

    setFocusedIndex(index);
    setSelectedIds([item]);
    setLastSelected(item);

    const timeoutId = setTimeout(() => {
      listRef.current?.focus();

      const element = listRef.current?.querySelector(
        `[data-object-key="${getObjectKey(item)}"]`,
      );

      element?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [activeSimulationItem, currentObjects, subPlan.id]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.key === "ArrowDown") {
        next();
      } else {
        prev();
      }
    },
    [next, prev],
  );

  const onDragEndSubItem = useCallback(
    ({ active, over }) => {
      if (!isOwner) {
        return;
      }

      if (!over) {
        return;
      }

      const activeKey = String(active.id);
      const overKey = String(over.id);

      if (activeKey === overKey) {
        return;
      }

      const oldIndex = currentObjects.findIndex(
        (item) => getObjectKey(item) === activeKey,
      );

      const newIndex = currentObjects.findIndex(
        (item) => getObjectKey(item) === overKey,
      );

      if (oldIndex < 0 || newIndex < 0) {
        return;
      }

      const selectedKeySet = new Set(
        selectedIds.map((item) => getObjectKey(item)),
      );

      /*
       * If the dragged row is not selected,
       * move only that row.
       */
      if (!selectedKeySet.has(activeKey)) {
        selectedKeySet.clear();
        selectedKeySet.add(activeKey);
      }

      const movingObjects = currentObjects.filter((item) =>
        selectedKeySet.has(getObjectKey(item)),
      );

      /*
       * Dropping onto the moving group itself
       * does not change its position.
       */
      if (movingObjects.length > 1 && selectedKeySet.has(overKey)) {
        return;
      }

      const remainingObjects = currentObjects.filter(
        (item) => !selectedKeySet.has(getObjectKey(item)),
      );

      const overIndexInRemaining = remainingObjects.findIndex(
        (item) => getObjectKey(item) === overKey,
      );

      if (overIndexInRemaining < 0) {
        return;
      }

      const movingDown = oldIndex < newIndex;

      const insertIndex = movingDown
        ? overIndexInRemaining + 1
        : overIndexInRemaining;

      const safeInsertIndex = Math.max(
        0,
        Math.min(insertIndex, remainingObjects.length),
      );

      const previousItem =
        safeInsertIndex > 0 ? remainingObjects[safeInsertIndex - 1] : null;

      const nextItem =
        safeInsertIndex < remainingObjects.length
          ? remainingObjects[safeInsertIndex]
          : null;

      let sortDates;

      try {
        sortDates = createSortDatesBetween({
          previousItem,
          nextItem,
          count: movingObjects.length,
        });
      } catch (error) {
        console.error("Unable to calculate sequence object order:", error);

        return;
      }

      /*
       * Only the dragged/selected rows receive
       * a new sortDatetime.
       */
      const updatedMovingObjects = movingObjects.map((object, index) => ({
        ...object,
        sortDatetime: sortDates[index],
      }));

      const reordered = [
        ...remainingObjects.slice(0, safeInsertIndex),
        ...updatedMovingObjects,
        ...remainingObjects.slice(safeInsertIndex),
      ];

      /*
       * Optimistic UI update.
       */
      setLocalObjects(reordered);

      /*
       * Only update the selected rows in Supabase.
       */
      dispatch(
        UpdateSequenceObjectSortDatesRequest({
          subPlanId: subPlan.id,
          objects: updatedMovingObjects.map((object) => ({
            dbId: object.dbId,
            modelExternalId:
              object.modelExternalId ??
              object.model_external_id ??
              object.modelId,
            externalId: object.externalId ?? object.external_id ?? object.id,
            sortDatetime: object.sortDatetime,
          })),
        }),
      );

      setSelectedIds(updatedMovingObjects);

      const activeItem = updatedMovingObjects.find(
        (item) => getObjectKey(item) === activeKey,
      );

      if (activeItem) {
        setLastSelected(activeItem);
      }

      const nextActiveIndex = reordered.findIndex(
        (item) => getObjectKey(item) === activeKey,
      );

      setFocusedIndex(nextActiveIndex);
    },
    [currentObjects, selectedIds, dispatch, isOwner, subPlan.id],
  );

  const handleAssignDate = useCallback(
    (date, dateStep) => {
      if (!isOwner) {
        return;
      }

      const step = Number(dateStep) || 0;
      if (!date && step <= 0) {
        return;
      }

      const selectedKeys = new Set(
        selectedIds.map((item) => getObjectKey(item)),
      );

      if (!selectedKeys.size) {
        return;
      }

      let dateCount = 0;

      const updated = currentObjects.map((object) => {
        const key = getObjectKey(object);

        if (!selectedKeys.has(key)) {
          return object;
        }

        let nextDate = null;

        if (date) {
          nextDate = date.add(dateCount, "day");

          dateCount += step;
        } else {
          const currentAssignedDate = object.assignedDate;

          if (!currentAssignedDate) {
            return object;
          }

          const next = dayjs(currentAssignedDate);

          if (!next.isValid()) {
            return object;
          }

          nextDate = next.add(step, "day");
        }

        return {
          ...object,
          assignedDate: nextDate.format("YYYY-MM-DD"),
          date: nextDate.format("YYYY-MM-DD"),
        };
      });

      updateObjects(updated);
    },
    [currentObjects, isOwner, selectedIds, updateObjects],
  );

  const handleDelete = useCallback(
    (item) => {
      if (!isOwner) {
        return;
      }

      const updated = currentObjects.filter((obj) => !isSameObject(obj, item));

      updateObjects(updated);

      setSelectedIds((previous) =>
        previous.filter((selected) => !isSameObject(selected, item)),
      );

      setLastSelected((previous) =>
        isSameObject(previous, item) ? null : previous,
      );

      setFocusedIndex((previous) => {
        if (!updated.length) {
          return -1;
        }

        return Math.max(0, Math.min(previous, updated.length - 1));
      });
    },
    [currentObjects, isOwner, updateObjects],
  );

  const handleDeleteMulti = useCallback(() => {
    if (!isOwner || !selectedIds.length) {
      return;
    }

    const selectedKeys = new Set(selectedIds.map((obj) => getObjectKey(obj)));

    const updated = currentObjects.filter(
      (obj) => !selectedKeys.has(getObjectKey(obj)),
    );

    updateObjects(updated);

    setSelectedIds([]);
    setLastSelected(null);

    setFocusedIndex((previous) => {
      if (!updated.length) {
        return -1;
      }

      return Math.max(0, Math.min(previous, updated.length - 1));
    });
  }, [currentObjects, isOwner, selectedIds, updateObjects]);

  const getCameraTargetObjects = useCallback(
    (triggerItem) => {
      const triggerKey = getObjectKey(triggerItem);

      const selectedKeySet = new Set(
        selectedIds.map((object) => getObjectKey(object)),
      );

      if (selectedKeySet.has(triggerKey)) {
        return currentObjects.filter((object) =>
          selectedKeySet.has(getObjectKey(object)),
        );
      }

      return currentObjects.filter(
        (object) => getObjectKey(object) === triggerKey,
      );
    },
    [currentObjects, selectedIds],
  );

  const updateSelectedObjectCameras = useCallback(
    (triggerItem, camera) => {
      if (!isOwner) {
        return;
      }

      const targetObjects = getCameraTargetObjects(triggerItem);

      if (!targetObjects.length) {
        return;
      }

      const targetKeySet = new Set(
        targetObjects.map((object) => getObjectKey(object)),
      );

      const newObjects = currentObjects.map((object) =>
        targetKeySet.has(getObjectKey(object))
          ? {
              ...object,
              camera,
            }
          : object,
      );

      updateObjects(newObjects);

      setSelectedIds(
        newObjects.filter((object) => targetKeySet.has(getObjectKey(object))),
      );
    },
    [currentObjects, getCameraTargetObjects, isOwner, updateObjects],
  );
  const handleAddCamera = useCallback(
    async (item) => {
      if (!isOwner) {
        return;
      }

      try {
        const tcapi =
          tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

        tcapiRef.current = tcapi;

        const camera = await tcapi.viewer.getCamera();

        if (!camera) {
          return;
        }

        updateSelectedObjectCameras(item, camera);
      } catch (error) {
        console.error("Save camera failed:", error);
      }
    },
    [isOwner, updateSelectedObjectCameras],
  );

  const handleChangeCamera = useCallback(
    async (item) => {
      if (!isOwner) {
        return;
      }

      try {
        const tcapi =
          tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

        tcapiRef.current = tcapi;

        const camera = await tcapi.viewer.getCamera();

        if (!camera) {
          return;
        }

        updateSelectedObjectCameras(item, camera);
      } catch (error) {
        console.error("Change camera failed:", error);
      }
    },
    [isOwner, updateSelectedObjectCameras],
  );

  const handleDeleteCamera = useCallback(
    (item) => {
      if (!isOwner) {
        return;
      }

      try {
        updateSelectedObjectCameras(item, null);
      } catch (error) {
        console.error("Delete camera failed:", error);
      }
    },
    [isOwner, updateSelectedObjectCameras],
  );

  const handleZoomToSelected = useCallback(async () => {
    try {
      const tcapi =
        tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

      tcapiRef.current = tcapi;

      const selectedKeys = new Set(
        selectedIds.map((item) => getObjectKey(item)),
      );

      const selectedObjects = currentObjects.filter((obj) =>
        selectedKeys.has(getObjectKey(obj)),
      );

      const modelObjectIds = await resolveViewerModelObjects(selectedObjects);

      if (!modelObjectIds.length) {
        return;
      }

      const selector = {
        modelObjectIds,
      };

      await tcapi.viewer.setSelection(selector, "set");

      await tcapi.viewer.setCamera(selector, {
        animationTime: 800,
      });
    } catch (error) {
      console.error("Zoom selected objects error:", error);
    }
  }, [currentObjects, selectedIds, resolveViewerModelObjects]);

  useEffect(() => {
    if (!currentObjects.length) {
      setFocusedIndex(-1);
      return;
    }

    if (focusedIndex > currentObjects.length - 1) {
      setFocusedIndex(currentObjects.length - 1);
    }
  }, [currentObjects.length, focusedIndex]);

  if (!currentObjects.length) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Objects" />
    );
  }

  return (
    <DndContext
      sensors={isOwner ? sensors : []}
      collisionDetection={closestCenter}
      onDragEnd={isOwner ? onDragEndSubItem : undefined}
    >
      <SortableContext
        items={currentObjects.map((item) => getObjectKey(item))}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={listRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          style={{
            outline: "none",
          }}
        >
          <List
            loading={loading}
            dataSource={currentObjects}
            style={{
              marginLeft: 10,
              minWidth: 100,
              maxHeight: 600,
              overflowY: "auto",
            }}
            renderItem={(item) => (
              <SortableSubItem
                key={getObjectKey(item)}
                item={item}
                isOwner={isOwner}
                displayIndex={displayIndexMap?.get(getObjectKey(item)) || 1}
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                lastSelected={lastSelected}
                setLastSelected={setLastSelected}
                setFocusedIndex={setFocusedIndex}
                currentObjects={currentObjects}
                icon={<FileOutlined />}
                onAssignDate={handleAssignDate}
                onDelete={handleDelete}
                onDeleteMulti={handleDeleteMulti}
                onAddCamera={handleAddCamera}
                onChangeCamera={handleChangeCamera}
                onDeleteCamera={handleDeleteCamera}
                onZoomIn={handleZoomToSelected}
                selectObjectsInViewer={selectObjectsInViewer}
                setActiveItem={setActiveItem}
                listRef={listRef}
                projectFormatting={projectFormatting}
              />
            )}
          />
        </div>
      </SortableContext>
    </DndContext>
  );
};

export default SequenceObjectCollapse;
