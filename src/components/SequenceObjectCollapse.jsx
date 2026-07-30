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
} from "../store/sequence/action";


const getObjectKey = (obj) => {
  const runtimeId = obj?.id ?? obj?.runtimeId ?? obj?.objectRuntimeId;

  return `${obj?.modelId}-${runtimeId}`;
};

const getObjectDate = (obj) => {
  return obj?.date || obj?.assignedDate || "";
};

const isSameObject = (first, second) => {
  if (!first || !second) {
    return false;
  }

  const firstId = first.id ?? first.runtimeId ?? first.objectRuntimeId;

  const secondId = second.id ?? second.runtimeId ?? second.objectRuntimeId;

  return (
    String(first.modelId) === String(second.modelId) &&
    String(firstId) === String(secondId)
  );
};

const normalizeUnit = (unit) =>
  String(unit || "")
    .trim()
    .toLowerCase();

const roundByDecimals = (value, decimals = 2) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  const numericDecimals = Number(decimals);

  const safeDecimals = Number.isInteger(numericDecimals)
    ? Math.max(0, numericDecimals)
    : 2;

  const factor = 10 ** safeDecimals;

  return Math.round((numericValue + Number.EPSILON) * factor) / factor;
};


const gcd = (a, b) => {
  let first = Math.abs(Number(a));
  let second = Math.abs(Number(b));

  while (second !== 0) {
    const temporary = second;

    second = first % second;
    first = temporary;
  }

  return first || 1;
};

const formatFeetInchesFraction = (valueMm, denominator = 16) => {
  const lengthMm = Number(valueMm);

  if (!Number.isFinite(lengthMm)) {
    return "";
  }

  const sign = lengthMm < 0 ? "-" : "";
  const absoluteMm = Math.abs(lengthMm);

  const totalInches = absoluteMm / 25.4;

  let feet = Math.floor(totalInches / 12);
  let remainingInches = totalInches - feet * 12;

  let wholeInches = Math.floor(remainingInches);

  let numerator = Math.round((remainingInches - wholeInches) * denominator);

  if (numerator >= denominator) {
    wholeInches += 1;
    numerator = 0;
  }

  if (wholeInches >= 12) {
    feet += Math.floor(wholeInches / 12);
    wholeInches %= 12;
  }

  if (numerator === 0) {
    return `${sign}${feet}'-${wholeInches}"`;
  }

  const divisor = gcd(numerator, denominator);

  const reducedNumerator = numerator / divisor;
  const reducedDenominator = denominator / divisor;

  return `${sign}${feet}'-${wholeInches} ${reducedNumerator}/${reducedDenominator}"`;
};

const convertLengthFromMm = (value, formatting) => {
  const lengthMm = Number(value);

  if (!Number.isFinite(lengthMm)) {
    return 0;
  }

  const targetUnit = normalizeUnit(formatting?.lengthUnit || "mm");

  const decimals = formatting?.lengthDecimals ?? 0;

  let convertedValue = lengthMm;

  switch (targetUnit) {
    case "mm":
      convertedValue = lengthMm;
      break;

    case "cm":
      convertedValue = lengthMm / 10;
      break;

    case "m":
      convertedValue = lengthMm / 1000;
      break;

    case "km":
      convertedValue = lengthMm / 1_000_000;
      break;

    case "in":
      convertedValue = lengthMm / 25.4;
      break;

    case "ft":
      convertedValue = lengthMm / 304.8;
      break;

    case "ft-in":
      return formatFeetInchesFraction(lengthMm, 16);

    case "yd":
      convertedValue = lengthMm / 914.4;
      break;

    case "mi":
      convertedValue = lengthMm / 1_609_344;
      break;

    case "sin":
      convertedValue = lengthMm / (1200 / 39.37);
      break;

    case "sft":
      convertedValue = lengthMm / (1200 / 3.937);
      break;

    case "syd":
      convertedValue = lengthMm / ((1200 / 3.937) * 3);
      break;

    case "smi":
      convertedValue = lengthMm / ((1200 / 3.937) * 5280);
      break;

    default:
      convertedValue = lengthMm;
      break;
  }

  return roundByDecimals(convertedValue, decimals);
};


const convertMassFromKg = (value, formatting) => {
  const massKg = Number(value);

  if (!Number.isFinite(massKg)) {
    return null;
  }

  const targetUnit = normalizeUnit(formatting?.massUnit || "kg");

  const decimals = formatting?.massDecimals ?? 2;

  let convertedValue = massKg;

  switch (targetUnit) {
    case "mg":
      convertedValue = massKg * 1_000_000;
      break;

    case "g":
      convertedValue = massKg * 1000;
      break;

    case "kg":
      convertedValue = massKg;
      break;

    case "t":
    case "tonne":
    case "metric-ton":
    case "metricton":
      convertedValue = massKg / 1000;
      break;

    case "oz":
      convertedValue = massKg * 35.2739619496;
      break;

    case "lb":
    case "lbs":
      convertedValue = massKg * 2.20462262185;
      break;

    case "ton":
    case "short-ton":
    case "shortton":
      convertedValue = massKg / 907.18474;
      break;

    case "long-ton":
    case "longton":
      convertedValue = massKg / 1016.0469088;
      break;

    default:
      convertedValue = massKg;
      break;
  }

  return roundByDecimals(convertedValue, decimals);
};

const getDisplayMassUnit = (formatting) => {
  const massUnit = normalizeUnit(formatting?.massUnit || "kg");

  switch (massUnit) {
    case "lbs":
      return "lb";

    case "tonne":
    case "metric-ton":
    case "metricton":
      return "t";

    case "short-ton":
    case "shortton":
      return "ton";

    case "longton":
      return "long-ton";

    default:
      return massUnit || "kg";
  }
};


const DEFAULT_PROJECT_FORMATTING = {
  unitSystem: "metric",

  lengthUnit: "mm",
  lengthDecimals: 0,

  massUnit: "kg",
  massDecimals: 2,
};

const getProjectFormatting = async (tcapi) => {
  try {
    const settings = await tcapi.project.getSettings();

    const formatting = settings?.formatting || {};

    const result = {
      unitSystem:
        formatting.unitSystem || DEFAULT_PROJECT_FORMATTING.unitSystem,

      lengthUnit:
        formatting.lengthUnit || DEFAULT_PROJECT_FORMATTING.lengthUnit,

      lengthDecimals:
        formatting.lengthDecimals ?? DEFAULT_PROJECT_FORMATTING.lengthDecimals,

      massUnit: formatting.massUnit || DEFAULT_PROJECT_FORMATTING.massUnit,

      massDecimals:
        formatting.massDecimals ?? DEFAULT_PROJECT_FORMATTING.massDecimals,
    };

    console.log("Project formatting:", result);

    return result;
  } catch (error) {
    console.error("Get project settings failed:", error);

    return DEFAULT_PROJECT_FORMATTING;
  }
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
  }) => {
    const { message } = App.useApp();

    const [assignDate, setAssignDate] = useState(null);

    const [dateStep, setDateStep] = useState(0);

    const sortableId = getObjectKey(item);

    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({
        id: sortableId,
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
      if (item?.weight == null || !Number.isFinite(Number(item.weight))) {
        return null;
      }

      return convertMassFromKg(item.weight, projectFormatting);
    }, [item?.weight, projectFormatting]);

    const displayWeightUnit = useMemo(
      () => getDisplayMassUnit(projectFormatting),
      [projectFormatting],
    );

    const displayLength = useMemo(() => {
      if (item?.length == null || !Number.isFinite(Number(item.length))) {
        return null;
      }

      return convertLengthFromMm(item.length, projectFormatting);
    }, [item?.length, projectFormatting]);

    const displayLengthUnit = useMemo(
      () => normalizeUnit(projectFormatting?.lengthUnit || "mm"),
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

    const contextMenuItems = [
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
              disabled={!assignDate}
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
      {
        key: "zoomIn",
        icon: <ZoomInOutlined />,
        label: "Zoom To Selected",

        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
          onZoomIn(item);
        },
      },
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
        key: "delete",
        danger: true,
        icon: <DeleteOutlined />,
        label: "Delete",

        onClick: ({ domEvent }) => {
          domEvent.stopPropagation();
          onDeleteMulti();
        },
      },
    ];

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
            <span
              {...listeners}
              style={{
                display: "flex",
                alignItems: "center",
                cursor: "grab",
                flexShrink: 0,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {icon}
            </span>

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
                }}
              >
                {`${displayIndex}: `}
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

            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={handleDeleteClick}
            />
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
}) => {
  const dispatch = useDispatch();

  const sequenceObjects = useSelector(
    (state) => state.sequence.sequenceObjects || [],
  );

  const loading = useSelector((state) => state.sequence.pending);

  const [selectedIds, setSelectedIds] = useState([]);

  const [lastSelected, setLastSelected] = useState(null);

  const [focusedIndex, setFocusedIndex] = useState(0);

  const [projectFormatting, setProjectFormatting] = useState(
    DEFAULT_PROJECT_FORMATTING,
  );

  const tcapiRef = useRef(null);
  const listRef = useRef(null);


  useEffect(() => {
    let mounted = true;

    const connectApi = async () => {
      try {
        const tcapi = await WorkspaceAPI.connect(window.parent);

        tcapiRef.current = tcapi;

        const formatting = await getProjectFormatting(tcapi);

        if (mounted) {
          setProjectFormatting(formatting);
        }
      } catch (error) {
        console.error("Connect Trimble API failed:", error);

        if (mounted) {
          setProjectFormatting(DEFAULT_PROJECT_FORMATTING);
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

  const currentObjects = useMemo(() => {
    const subPlanObjects = sequenceObjects.find(
      (group) => group && String(group.subPlanId) === String(subPlan.id),
    );

    return subPlanObjects?.objects || [];
  }, [sequenceObjects, subPlan.id]);

  const items = useMemo(() => {
    const result = [];

    sequenceObjects.forEach((group) => {
      const objects = group?.objects || [];

      objects.forEach((obj) => {
        const runtimeId = obj.id ?? obj.runtimeId ?? obj.objectRuntimeId;

        result.push({
          ...obj,

          planId: group.planId || group.id,

          subPlanId: group.subPlanId,

          modelId: obj.modelId,

          id: runtimeId,
        });
      });
    });

    return result;
  }, [sequenceObjects]);

  const updateObjects = useCallback(
    (objects) => {
      dispatch(
        SetObjectsRequest({
          subPlanId: subPlan.id,

          objects,
        }),
      );
    },
    [dispatch, subPlan.id],
  );

  const selectObjectsInViewer = useCallback(async (objects) => {
    try {
      const tcapi = tcapiRef.current;

      if (!tcapi || !objects?.length) {
        return;
      }

      const modelGroups = new Map();

      objects.forEach((item) => {
        const runtimeId = item.id ?? item.runtimeId ?? item.objectRuntimeId;

        if (item.modelId == null || runtimeId == null) {
          return;
        }

        const modelKey = String(item.modelId);

        if (!modelGroups.has(modelKey)) {
          modelGroups.set(modelKey, {
            modelId: item.modelId,

            objectRuntimeIds: [],
          });
        }

        modelGroups.get(modelKey).objectRuntimeIds.push(runtimeId);
      });

      const modelObjectIds = [...modelGroups.values()]
        .map((group) => ({
          ...group,

          objectRuntimeIds: [...new Set(group.objectRuntimeIds)],
        }))
        .filter((group) => group.objectRuntimeIds.length > 0);

      if (!modelObjectIds.length) {
        return;
      }

      const selector = {
        modelObjectIds,
      };

      console.log("Selected model objects:", modelObjectIds);

      await tcapi.viewer.setSelection(selector, "set");

      // await tcapi.viewer.setCamera(selector, {
      //   animationTime: 800,
      // });
    } catch (error) {
      console.error("Select and zoom objects error:", error);
    }
  }, []);

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

          modelId: item.modelId,

          id: item.id,
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
          String(item.modelId) === String(activeSimulationItem.modelId) &&
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
      const runtimeId = item.id ?? item.runtimeId ?? item.objectRuntimeId;

      dispatch(
        SetActiveSimulationItem({
          planId: item.planId,

          subPlanId: item.subPlanId || subPlan.id,

          modelId: item.modelId,

          id: runtimeId,
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
        String(item.modelId) === String(activeSimulationItem.modelId) &&
        String(item.id ?? item.runtimeId ?? item.objectRuntimeId) ===
          String(activeSimulationItem.id),
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
    (event) => {
      const { active, over } = event;

      if (!over || active.id === over.id) {
        return;
      }

      const oldIndex = currentObjects.findIndex(
        (item) => getObjectKey(item) === active.id,
      );

      const newIndex = currentObjects.findIndex(
        (item) => getObjectKey(item) === over.id,
      );

      if (oldIndex < 0 || newIndex < 0) {
        return;
      }

      const reordered = arrayMove(currentObjects, oldIndex, newIndex);

      updateObjects(reordered);

      setFocusedIndex(newIndex);
    },
    [currentObjects, updateObjects],
  );

  const handleAssignDate = useCallback(
    (date, dateStep) => {
      if (!date) {
        return;
      }

      const step = Number(dateStep) || 0;

      const selectedKeys = new Set(
        selectedIds.map((item) => getObjectKey(item)),
      );

      let dateCount = 0;

      const updated = currentObjects.map((obj) => {
        const key = getObjectKey(obj);

        if (!selectedKeys.has(key)) {
          return obj;
        }

        const assignedDate = date.add(dateCount, "day").format("DD-MM-YYYY");

        dateCount += step;

        return {
          ...obj,
          date: assignedDate,
        };
      });

      updateObjects(updated);
    },
    [currentObjects, selectedIds, updateObjects],
  );

  const handleDelete = useCallback(
    (item) => {
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
    [currentObjects, updateObjects],
  );

  const handleDeleteMulti = useCallback(() => {
    if (!selectedIds.length) {
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
  }, [currentObjects, selectedIds, updateObjects]);

  const handleAddCamera = useCallback(
    async (item) => {
      try {
        const tcapi =
          tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

        const camera = await tcapi.viewer.getCamera();

        if (!camera) {
          return;
        }

        const newObjects = currentObjects.map((obj) => {
          if (!isSameObject(obj, item)) {
            return obj;
          }

          return {
            ...obj,
            camera,
          };
        });

        updateObjects(newObjects);
      } catch (error) {
        console.error("Save camera failed:", error);
      }
    },
    [currentObjects, updateObjects],
  );

  const updateObjectCamera = useCallback(
    (item, camera) => {
      const newObjects = currentObjects.map((obj) =>
        isSameObject(obj, item)
          ? {
              ...obj,
              camera,
            }
          : obj,
      );

      updateObjects(newObjects);
    },
    [currentObjects, updateObjects],
  );

  const handleChangeCamera = useCallback(
    async (item) => {
      try {
        const tcapi =
          tcapiRef.current || (await WorkspaceAPI.connect(window.parent));

        const camera = await tcapi.viewer.getCamera();

        if (!camera) {
          return;
        }

        updateObjectCamera(item, camera);
      } catch (error) {
        console.error("Change camera failed:", error);
      }
    },
    [updateObjectCamera],
  );

  const handleDeleteCamera = useCallback(
    (item) => {
      try {
        updateObjectCamera(item, null);
      } catch (error) {
        console.error("Delete camera failed:", error);
      }
    },
    [updateObjectCamera],
  );

  const handleZoomToSelected = useCallback(async () => {
    try {
      const tcapi = tcapiRef.current;

      if (!tcapi) {
        return;
      }

      const selectedKeys = new Set(
        selectedIds.map((item) => getObjectKey(item)),
      );

      const modelGroups = new Map();

      currentObjects.forEach((obj) => {
        const key = getObjectKey(obj);

        if (!selectedKeys.has(key)) {
          return;
        }

        const runtimeId = obj.id ?? obj.runtimeId ?? obj.objectRuntimeId;

        if (obj.modelId == null || runtimeId == null) {
          return;
        }

        const modelKey = String(obj.modelId);

        if (!modelGroups.has(modelKey)) {
          modelGroups.set(modelKey, {
            modelId: obj.modelId,
            objectRuntimeIds: [],
          });
        }

        modelGroups.get(modelKey).objectRuntimeIds.push(runtimeId);
      });

      const modelObjectIds = [...modelGroups.values()]
        .map((group) => ({
          modelId: group.modelId,
          objectRuntimeIds: [...new Set(group.objectRuntimeIds)],
        }))
        .filter((group) => group.objectRuntimeIds.length > 0);

      if (!modelObjectIds.length) {
        return;
      }

      const selector = {
        modelObjectIds,
      };

      console.log("Zoom objects:", selector);

      await tcapi.viewer.setSelection(selector, "set");

      await tcapi.viewer.setCamera(selector, {
        animationTime: 800,
      });
    } catch (error) {
      console.error("Zoom selected objects error:", error);
    }
  }, [currentObjects, selectedIds]);

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
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEndSubItem}
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
