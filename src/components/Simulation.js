import {
  Button,
  DatePicker,
  Select,
  Slider,
  Space,
  Switch,
  Tooltip,
} from "antd";

import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

import {
  StepBackwardOutlined,
  StepForwardOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
} from "@ant-design/icons";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useDispatch, useSelector } from "react-redux";

import * as WorkspaceAPI from "trimble-connect-workspace-api";

import {
  SetActiveSimulationItem,
  SetSimulationDateRange,
} from "../store/sequence/action";

dayjs.extend(customParseFormat);

const DATE_FORMATS = [
  "DD-MM-YYYY",
  "DD/MM/YYYY",
  "YYYY-MM-DD",
  "YYYY/MM/DD",
];

const DEFAULT_PROJECT_FORMATTING = {
  massUnit: "kg",
  massDecimals: 2,
};

/*
 * Màu mặc định của các object chưa chạy simulation.
 */
const SIMULATION_BACKGROUND_COLOR = {
  r: 210,
  g: 210,
  b: 210,
};


const normalizeUnit = (unit) =>
  String(unit || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

const roundByDecimals = (value, decimals = 2) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const numericDecimals = Number(decimals);

  const safeDecimals = Number.isInteger(numericDecimals)
    ? Math.max(0, numericDecimals)
    : 2;

  const factor = 10 ** safeDecimals;

  return (
    Math.round(
      (numericValue + Number.EPSILON) * factor,
    ) / factor
  );
};

const convertMassFromKg = (
  value,
  formatting = DEFAULT_PROJECT_FORMATTING,
) => {
  const massKg = Number(value);

  if (!Number.isFinite(massKg)) {
    return null;
  }

  const targetUnit = normalizeUnit(
    formatting?.massUnit || "kg",
  );

  const decimals =
    formatting?.massDecimals ?? 2;

  let convertedValue = massKg;

  switch (targetUnit) {
    case "mg":
    case "milligram":
    case "milligrams":
      convertedValue =
        massKg * 1_000_000;
      break;

    case "g":
    case "gram":
    case "grams":
      convertedValue =
        massKg * 1000;
      break;

    case "kg":
    case "kilogram":
    case "kilograms":
      convertedValue = massKg;
      break;

    /*
     * Metric tonne
     */
    case "t":
    case "tonne":
    case "tonnes":
    case "metric-ton":
    case "metricton":
      convertedValue =
        massKg / 1000;
      break;

    case "oz":
    case "ounce":
    case "ounces":
      convertedValue =
        massKg * 35.2739619496;
      break;

    case "lb":
    case "lbs":
    case "pound":
    case "pounds":
      convertedValue =
        massKg * 2.20462262185;
      break;

    /*
     * US short ton
     */
    case "ton":
    case "short-ton":
    case "shortton":
      convertedValue =
        massKg / 907.18474;
      break;

    /*
     * Imperial long ton
     */
    case "long-ton":
    case "longton":
      convertedValue =
        massKg / 1016.0469088;
      break;

    default:
      convertedValue = massKg;
      break;
  }

  return roundByDecimals(
    convertedValue,
    decimals,
  );
};

const getDisplayMassUnit = (
  formatting = DEFAULT_PROJECT_FORMATTING,
) => {
  const unit = normalizeUnit(
    formatting?.massUnit || "kg",
  );

  switch (unit) {
    case "milligram":
    case "milligrams":
      return "mg";

    case "gram":
    case "grams":
      return "g";

    case "kilogram":
    case "kilograms":
      return "kg";

    case "lbs":
    case "pound":
    case "pounds":
      return "lb";

    case "ounce":
    case "ounces":
      return "oz";

    case "tonne":
    case "tonnes":
    case "metric-ton":
    case "metricton":
      return "t";

    case "short-ton":
    case "shortton":
      return "ton";

    case "longton":
      return "long-ton";

    default:
      return unit || "kg";
  }
};

export default function Simulation() {
  const dispatch = useDispatch();

  const plans = useSelector(
    (state) => state.sequence.plans || [],
  );

  const sequenceObjects = useSelector(
    (state) => state.sequence.sequenceObjects || [],
  );

  const subPlans = useSelector(
    (state) => state.sequence.subPlans || [],
  );

  const tcapiRef = useRef(null);
  const intervalRef = useRef(null);


  const simulationActivatedRef = useRef(false);

  const gridObjectsRef = useRef(null);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [delay, setDelay] = useState(200);

  const [
    projectFormatting,
    setProjectFormatting,
  ] = useState(
    DEFAULT_PROJECT_FORMATTING,
  );

  const [
    selectedPlanIds,
    setSelectedPlanIds,
  ] = useState([]);

  const [
    selectedSubPlanIds,
    setSelectedSubPlanIds,
  ] = useState([]);

  const [startDate, setStartDate] =
    useState(null);

  const [endDate, setEndDate] =
    useState(null);

  const [showGrid, setShowGrid] =
    useState(false);

  /*
   * Transparency chung của toàn bộ model.
   *
   * viewer.setOpacity sử dụng thang 0 → 100:
   * 0   = model rõ hoàn toàn.
   * 100 = model trong suốt hoàn toàn.
   *
   * Các object đã chạy simulation được setObjectState
   * về opacity 100 và tô màu theo SubPlan.
   */
  const [
    modelTransparency,
    setModelTransparency,
  ] = useState(0);

  /*
   * sequenceObjects chỉ lưu Internal Object ID trong obj.id.
   * items sẽ chứa Runtime ID đã được resolve từ Viewer.
   */
  const [items, setItems] = useState([]);
  const [resolvingRuntimeIds, setResolvingRuntimeIds] =
    useState(false);


  const parseDate = useCallback((value) => {
    if (!value) {
      return null;
    }

    if (dayjs.isDayjs(value)) {
      return value.isValid()
        ? value
        : null;
    }

    const strictDate = dayjs(
      value,
      DATE_FORMATS,
      true,
    );

    if (strictDate.isValid()) {
      return strictDate;
    }

    const normalDate = dayjs(value);

    return normalDate.isValid()
      ? normalDate
      : null;
  }, []);


  useEffect(() => {
    const validPlanIds = plans.map(
      (plan) => String(plan.id),
    );

    setSelectedPlanIds((current) => {
      if (!current.length) {
        return validPlanIds;
      }

      const existingSelectedIds =
        current.filter((id) =>
          validPlanIds.includes(
            String(id),
          ),
        );

      if (!existingSelectedIds.length) {
        return validPlanIds;
      }

      const newPlanIds =
        validPlanIds.filter(
          (id) =>
            !existingSelectedIds.includes(
              id,
            ),
        );

      return [
        ...existingSelectedIds,
        ...newPlanIds,
      ];
    });
  }, [plans]);


  const availableSubPlans = useMemo(() => {
    const selectedPlanSet = new Set(
      selectedPlanIds.map((id) =>
        String(id),
      ),
    );

    return subPlans.filter((subPlan) => {
      const subPlanPlanId =
        subPlan.planId ??
        subPlan.parentPlanId;

      if (subPlanPlanId == null) {
        return true;
      }

      return selectedPlanSet.has(
        String(subPlanPlanId),
      );
    });
  }, [subPlans, selectedPlanIds]);

  // =====================================================
  // DEFAULT SELECT ALL AVAILABLE SUB PLANS
  // =====================================================

  useEffect(() => {
    const validSubPlanIds =
      availableSubPlans.map(
        (subPlan) =>
          String(subPlan.id),
      );

    setSelectedSubPlanIds((current) => {
      const existingSelectedIds =
        current.filter((id) =>
          validSubPlanIds.includes(
            String(id),
          ),
        );

      if (!existingSelectedIds.length) {
        return validSubPlanIds;
      }

      const newSubPlanIds =
        validSubPlanIds.filter(
          (id) =>
            !existingSelectedIds.includes(
              id,
            ),
        );

      return [
        ...existingSelectedIds,
        ...newSubPlanIds,
      ];
    });
  }, [availableSubPlans]);

  // =====================================================
  // BUILD ALL SIMULATION ITEMS
  // =====================================================

  const allItems = useMemo(() => {
    if (!sequenceObjects.length) {
      return [];
    }

    const result = [];
    let originalIndex = 0;

    sequenceObjects.forEach(
      (group, groupIndex) => {
        if (!group) {
          return;
        }

        const objects = group.objects || [];

        objects.forEach(
          (obj, objectIndex) => {
            /*
             * obj.id là Internal Object ID.
             * Không sử dụng nó trực tiếp với setSelection,
             * isolateEntities hoặc setObjectState.
             */
            const objectId = obj.id;

            const modelId =
              obj.modelId ??
              group.modelId;

            const planId = String(
              obj.planId ??
                group.planId ??
                "",
            );

            const subPlanId = String(
              obj.subPlanId ??
                group.subPlanId ??
                "",
            );

            const simulationDate =
              obj.assignedDate ||
              obj.date;

            const parsedDate =
              parseDate(
                simulationDate,
              );

            if (
              objectId == null ||
              modelId == null ||
              !parsedDate
            ) {
              return;
            }

            const plan = plans.find(
              (item) =>
                String(item.id) ===
                planId,
            );

            result.push({
              ...obj,

              objectId,
              modelId,
              planId,
              subPlanId,

              groupIndex,
              objectIndex,

              originalIndex:
                originalIndex++,

              planName:
                plan?.name ||
                group.planName ||
                `Plan ${groupIndex + 1}`,

              name:
                obj.asmPos ||
                obj.name ||
                obj.objectName ||
                `Object ${objectIndex + 1}`,

              /*
               * Giữ id là Internal Object ID để Redux/UI
               * nhận diện object ổn định.
               */
              id: String(objectId),

              simulationDate:
                parsedDate.format(
                  "DD-MM-YYYY",
                ),

              simulationTime:
                parsedDate.valueOf(),
            });
          },
        );
      },
    );

    return result.sort((a, b) => {
      if (
        a.simulationTime !==
        b.simulationTime
      ) {
        return (
          a.simulationTime -
          b.simulationTime
        );
      }

      return (
        a.originalIndex -
        b.originalIndex
      );
    });
  }, [
    sequenceObjects,
    plans,
    parseDate,
  ]);

  // =====================================================
  // FILTER ITEMS
  // =====================================================

  const filteredItems = useMemo(() => {
    const selectedPlanSet = new Set(
      selectedPlanIds.map((id) =>
        String(id),
      ),
    );

    const selectedSubPlanSet =
      new Set(
        selectedSubPlanIds.map((id) =>
          String(id),
        ),
      );

    const start = startDate
      ? dayjs(startDate).startOf(
          "day",
        )
      : null;

    const end = endDate
      ? dayjs(endDate).endOf("day")
      : null;

    const filtered = allItems.filter(
      (item) => {
        if (
          !selectedPlanSet.has(
            String(item.planId),
          )
        ) {
          return false;
        }

        if (
          item.subPlanId &&
          selectedSubPlanSet.size &&
          !selectedSubPlanSet.has(
            String(item.subPlanId),
          )
        ) {
          return false;
        }

        const itemDate =
          parseDate(
            item.simulationDate,
          );

        if (!itemDate) {
          return false;
        }

        if (
          start &&
          itemDate.isBefore(
            start,
            "day",
          )
        ) {
          return false;
        }

        if (
          end &&
          itemDate.isAfter(
            end,
            "day",
          )
        ) {
          return false;
        }

        return true;
      },
    );

    return filtered;
  }, [
    allItems,
    selectedPlanIds,
    selectedSubPlanIds,
    startDate,
    endDate,
    parseDate,
  ]);

  const current = items[index];

  /*
   * Convert weight từ kg sang massUnit của project.
   */
  const displayWeight = useMemo(() => {
    if (
      current?.weight == null ||
      !Number.isFinite(
        Number(current.weight),
      )
    ) {
      return null;
    }

    return convertMassFromKg(
      current.weight,
      projectFormatting,
    );
  }, [
    current?.weight,
    projectFormatting,
  ]);

  const displayWeightUnit =
    useMemo(
      () =>
        getDisplayMassUnit(
          projectFormatting,
        ),
      [projectFormatting],
    );

  // =====================================================
  // RESET SIMULATION WHEN FILTER CHANGES
  // =====================================================

  useEffect(() => {
    setPlaying(false);
    setIndex(0);

    clearInterval(
      intervalRef.current,
    );
  }, [
    selectedPlanIds,
    selectedSubPlanIds,
    startDate,
    endDate,
  ]);

  /*
   * Chỉ kiểm tra index.
   * Không gọi isolateEntities khi items thay đổi.
   */
  useEffect(() => {
    if (!items.length) {
      setIndex(0);
      setPlaying(false);

      clearInterval(
        intervalRef.current,
      );

      return;
    }

    if (index >= items.length) {
      setIndex(
        items.length - 1,
      );
    }
  }, [items.length, index]);

  // =====================================================
  // SAVE DATE RANGE TO REDUX
  // =====================================================

  useEffect(() => {
    dispatch(
      SetSimulationDateRange({
        startDate: startDate
          ? startDate.format(
              "DD-MM-YYYY",
            )
          : null,

        endDate: endDate
          ? endDate.format(
              "DD-MM-YYYY",
            )
          : null,
      }),
    );
  }, [
    startDate,
    endDate,
    dispatch,
  ]);

  // =====================================================
  // TRIMBLE CONNECT API
  // =====================================================

  const getTcapi =
    useCallback(async () => {
      if (!tcapiRef.current) {
        tcapiRef.current =
          await WorkspaceAPI.connect(
            window.parent,
          );
      }

      return tcapiRef.current;
    }, []);

  /*
   * Resolve Internal Object IDs -> Runtime IDs.
   *
   * Mỗi model chỉ gọi convertToObjectRuntimeIds một lần.
   * Runtime ID không được lưu lâu dài trong Redux vì có thể
   * thay đổi khi model được reload.
   */
  useEffect(() => {
    let cancelled = false;

    const resolveRuntimeIds = async () => {
      setPlaying(false);

      clearInterval(
        intervalRef.current,
      );

      setIndex(0);

      if (!filteredItems.length) {
        setItems([]);
        setResolvingRuntimeIds(false);
        return;
      }

      setResolvingRuntimeIds(true);
      setItems([]);

      try {
        const tcapi = await getTcapi();
        const modelGroups = new Map();

        filteredItems.forEach(
          (item, itemIndex) => {
            if (
              item?.modelId == null ||
              item?.objectId == null
            ) {
              return;
            }

            const modelKey = String(
              item.modelId,
            );

            if (!modelGroups.has(modelKey)) {
              modelGroups.set(modelKey, {
                modelId: item.modelId,
                entries: [],
              });
            }

            modelGroups
              .get(modelKey)
              .entries.push({
                item,
                itemIndex,
              });
          },
        );

        const resolvedByIndex = new Map();

        for (const group of modelGroups.values()) {
          /*
           * Loại objectId trùng trước khi convert.
           */
          const uniqueObjectIds = [];
          const uniqueObjectIdKeys =
            new Set();

          group.entries.forEach(
            ({ item }) => {
              const objectIdKey =
                String(item.objectId);

              if (
                uniqueObjectIdKeys.has(
                  objectIdKey,
                )
              ) {
                return;
              }

              uniqueObjectIdKeys.add(
                objectIdKey,
              );

              uniqueObjectIds.push(
                item.objectId,
              );
            },
          );

          if (!uniqueObjectIds.length) {
            continue;
          }

          let runtimeIds = [];

          try {
            runtimeIds =
              await tcapi.viewer.convertToObjectRuntimeIds(
                group.modelId,
                uniqueObjectIds,
              );
          } catch (error) {
            console.error(
              "convertToObjectRuntimeIds failed:",
              {
                modelId: group.modelId,
                objectIds: uniqueObjectIds,
                error,
              },
            );

            continue;
          }

          const runtimeIdMap = new Map();

          uniqueObjectIds.forEach(
            (objectId, objectIndex) => {
              const runtimeId =
                runtimeIds?.[objectIndex];

              if (runtimeId == null) {
                console.warn(
                  "Runtime ID was not found:",
                  {
                    modelId:
                      group.modelId,
                    objectId,
                  },
                );

                return;
              }

              runtimeIdMap.set(
                String(objectId),
                runtimeId,
              );
            },
          );

          group.entries.forEach(
            ({ item, itemIndex }) => {
              const runtimeId =
                runtimeIdMap.get(
                  String(
                    item.objectId,
                  ),
                );

              if (runtimeId == null) {
                return;
              }

              resolvedByIndex.set(
                itemIndex,
                {
                  ...item,
                  runtimeId,
                },
              );
            },
          );
        }

        if (cancelled) {
          return;
        }

        const resolvedItems =
          filteredItems
            .map((item, itemIndex) =>
              resolvedByIndex.get(
                itemIndex,
              ),
            )
            .filter(Boolean);

        const nextItems =
          resolvedItems.map(
            (item, itemIndex) => ({
              ...item,

              value:
                resolvedItems.length === 1
                  ? 0
                  : Math.round(
                      (itemIndex /
                        (resolvedItems.length -
                          1)) *
                        100,
                    ),
            }),
          );

        setItems(nextItems);

        if (
          filteredItems.length > 0 &&
          nextItems.length === 0
        ) {
          console.warn(
            "No simulation object could be converted to a Runtime ID.",
          );
        }
      } catch (error) {
        if (!cancelled) {
          console.error(
            "Resolve simulation Runtime IDs failed:",
            error,
          );

          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setResolvingRuntimeIds(false);
        }
      }
    };

    resolveRuntimeIds();

    return () => {
      cancelled = true;
    };
  }, [
    filteredItems,
    getTcapi,
  ]);

  /*
   * Lấy Project Unit Setting một lần khi component load.
   */
  useEffect(() => {
    let mounted = true;

    const loadProjectFormatting =
      async () => {
        try {
          const tcapi =
            await getTcapi();

          const settings =
            await tcapi.project.getSettings();

          const formatting =
            settings?.formatting ||
            {};

          if (!mounted) {
            return;
          }

          const nextFormatting = {
            massUnit:
              formatting.massUnit ||
              DEFAULT_PROJECT_FORMATTING.massUnit,

            massDecimals:
              formatting.massDecimals ??
              DEFAULT_PROJECT_FORMATTING.massDecimals,
          };

          setProjectFormatting(
            nextFormatting,
          );

          console.log(
            "Simulation project formatting:",
            nextFormatting,
          );
        } catch (error) {
          console.error(
            "Get project formatting failed:",
            error,
          );

          if (mounted) {
            setProjectFormatting(
              DEFAULT_PROJECT_FORMATTING,
            );
          }
        }
      };

    loadProjectFormatting();

    return () => {
      mounted = false;
    };
  }, [getTcapi]);

  const buildAccumulatedObjects =
    useCallback(
      (toIndex) => {
        const modelMap =
          new Map();

        items
          .slice(
            0,
            toIndex + 1,
          )
          .forEach((item) => {
            if (
              item.modelId == null ||
              item.runtimeId == null
            ) {
              return;
            }

            const modelKey =
              String(
                item.modelId,
              );

            if (
              !modelMap.has(
                modelKey,
              )
            ) {
              modelMap.set(
                modelKey,
                {
                  modelId:
                    item.modelId,

                  entityIds: [],
                },
              );
            }

            modelMap
              .get(modelKey)
              .entityIds.push(
                item.runtimeId,
              );
          });

        return Array.from(
          modelMap.values(),
        ).map((group) => ({
          ...group,

          entityIds: [
            ...new Set(
              group.entityIds,
            ),
          ],
        }));
      },
      [items],
    );

  const selectObjectInTrimble =
    useCallback(
      async (item) => {
        if (
          item?.modelId == null ||
          item?.runtimeId == null
        ) {
          return;
        }

        const tcapi =
          await getTcapi();

        await tcapi.viewer.setSelection(
          {
            modelObjectIds: [
              {
                modelId:
                  item.modelId,

                objectRuntimeIds: [
                  item.runtimeId,
                ],
              },
            ],
          },
          "set",
        );
      },
      [getTcapi],
    );



  const gotoCamera =
    useCallback(
      async (item, objects) => {
        try {
          const tcapi =
            await getTcapi();

          if (item?.camera) {
            await tcapi.viewer.setCamera(
              item.camera,
              {
                animationTime:
                  1000,
              },
            );

            return;
          }

          /*
           * Có thể bật lại setCamera theo selector nếu cần.
           */

          // if (!objects?.length) {
          //   return;
          // }

          // const selector = {
          //   modelObjectIds: objects
          //     .filter(
          //       (group) =>
          //         group.modelId != null &&
          //         Array.isArray(group.entityIds) &&
          //         group.entityIds.length > 0,
          //     )
          //     .map((group) => ({
          //       modelId: group.modelId,
          //       objectRuntimeIds: [
          //         ...new Set(group.entityIds),
          //       ],
          //     })),
          // };

          // if (!selector.modelObjectIds.length) {
          //   return;
          // }

          // await tcapi.viewer.setCamera(selector, {
          //   animationTime: 1000,
          // });
        } catch (error) {
          console.error(
            "gotoCamera error:",
            error,
          );
        }
      },
      [getTcapi],
    );

  const getGridObjects =
    useCallback(async () => {
      if (
        gridObjectsRef.current
      ) {
        return (
          gridObjectsRef.current
        );
      }

      const tcapi =
        await getTcapi();

      const result =
        await tcapi.viewer.getObjects(
          {
            parameter: {
              class: "IFCGRID",
            },
          },
        );

      gridObjectsRef.current =
        result || [];

      return gridObjectsRef.current;
    }, [getTcapi]);

  /*
   * includeGrid được truyền trực tiếp thay vì phụ thuộc showGrid.
   *
   * Nhờ vậy khi showGrid hoặc sequenceObjects thay đổi,
   * function không tự chạy lại thông qua useEffect.
   */
  const buildGridSelector =
    useCallback(async () => {
      const grids =
        await getGridObjects();

      return {
        modelObjectIds: (
          grids || []
        )
          .filter(
            (group) =>
              group?.modelId != null,
          )
          .map((group) => ({
            modelId:
              group.modelId,

            objectRuntimeIds: (
              group.objects || []
            )
              .map(
                (gridObject) =>
                  gridObject?.id,
              )
              .filter(
                (runtimeId) =>
                  runtimeId != null,
              ),
          }))
          .filter(
            (group) =>
              group.objectRuntimeIds
                .length > 0,
          ),
      };
    }, [getGridObjects]);

  /*
   * Áp dụng màu và trạng thái rõ hoàn toàn
   * cho toàn bộ object đã chạy simulation.
   *
   * Object được gom theo Model + SubPlan để
   * mỗi SubPlan nhận đúng màu.
   */
  const applyCompletedObjectStates =
    useCallback(
      async (
        completedItems,
        includeGrid = false,
      ) => {
        const tcapi =
          await getTcapi();

        const stateGroups =
          new Map();

        for (
          const item of
          completedItems || []
        ) {
          if (
            item?.modelId == null ||
            item?.runtimeId == null
          ) {
            continue;
          }

          const subPlan =
            subPlans.find(
              (subPlanItem) =>
                String(
                  subPlanItem.id,
                ) ===
                String(
                  item.subPlanId,
                ),
            );

          const groupKey = [
            String(item.modelId),
            String(item.subPlanId),
          ].join("::");

          if (
            !stateGroups.has(
              groupKey,
            )
          ) {
            stateGroups.set(
              groupKey,
              {
                modelId:
                  item.modelId,

                runtimeIds:
                  new Set(),

                color:
                  subPlan?.color ||
                  null,
              },
            );
          }

          stateGroups
            .get(groupKey)
            .runtimeIds.add(
              item.runtimeId,
            );
        }

        for (
          const group of
          stateGroups.values()
        ) {
          const selector = {
            modelObjectIds: [
              {
                modelId:
                  group.modelId,

                objectRuntimeIds: [
                  ...group.runtimeIds,
                ],
              },
            ],
          };

          const objectState = {
            visible: true,

            /*
             * Object đã chạy luôn rõ hoàn toàn.
             */
            opacity: 100,
          };

          if (group.color) {
            objectState.color = {
              r:
                group.color.r,

              g:
                group.color.g,

              b:
                group.color.b,
            };
          }

          await tcapi.viewer.setObjectState(
            selector,
            objectState,
          );
        }

        /*
         * Grid luôn rõ hoàn toàn khi được bật.
         */
        if (includeGrid) {
          const gridSelector =
            await buildGridSelector();

          if (
            gridSelector.modelObjectIds
              .length > 0
          ) {
            await tcapi.viewer.setObjectState(
              gridSelector,
              {
                visible: true,
                opacity: 100,
              },
            );
          }
        }
      },
      [
        buildGridSelector,
        getTcapi,
        subPlans,
      ],
    );

  /*
   * Kết hợp:
   *
   * 1. setOpacity(transparency):
   *    áp dụng transparency chung cho toàn viewer.
   *
   * 2. setObjectState(selector, state):
   *    object đã chạy được đưa về rõ 100%
   *    và tô màu theo SubPlan.
   */
  const applySimulationTransparency =
    useCallback(
      async (
        currentIndex,
        includeGrid = false,
        transparency = 0,
      ) => {
        if (
          !items.length ||
          currentIndex < 0 ||
          currentIndex >=
            items.length
        ) {
          return;
        }

        const tcapi =
          await getTcapi();

        const safeTransparency =
          Math.max(
            0,
            Math.min(
              100,
              Number(
                transparency,
              ) || 0,
            ),
          );

        const completedItems =
          items.slice(
            0,
            currentIndex + 1,
          );

        /*
         * Reset trạng thái từ lần chạy trước.
         */
        await tcapi.viewer.setObjectState(
          undefined,
          {
            visible: "reset",
            color: "reset",
            opacity: 100,
          },
        );

        /*
         * Ban đầu toàn bộ model có màu xám nhạt.
         * Các object đã chạy sẽ được đổi sang màu SubPlan
         * trong applyCompletedObjectStates().
         */
        await tcapi.viewer.setObjectState(
          undefined,
          {
            visible: true,
            color:
              SIMULATION_BACKGROUND_COLOR,
          },
        );

        /*
         * Áp dụng transparency chung cho toàn bộ viewer.
         *
         * 0   = rõ hoàn toàn.
         * 100 = trong suốt hoàn toàn.
         */
        await tcapi.viewer.setOpacity(
          safeTransparency,
        );

        /*
         * Khôi phục các object đã chạy:
         * - visible
         * - object opacity 100%
         * - màu của SubPlan
         *
         * Các object chưa chạy vẫn giữ màu xám nhạt
         * và transparency chung của viewer.
         */
        await applyCompletedObjectStates(
          completedItems,
          includeGrid,
        );
      },
      [
        applyCompletedObjectStates,
        getTcapi,
        items,
      ],
    );

  // =====================================================
  // NAVIGATION
  // =====================================================

  const goToIndex =
    useCallback(
      async (newIndex) => {
        if (!items.length) {
          return;
        }

        const safeIndex =
          Math.max(
            0,
            Math.min(
              newIndex,
              items.length - 1,
            ),
          );

        const item =
          items[safeIndex];

        if (!item) {
          return;
        }

        /*
         * Simulation chỉ active khi người dùng thực sự
         * tương tác với Play/Next/Previous/Slider.
         */
        simulationActivatedRef.current =
          true;

        setIndex(safeIndex);

        dispatch(
          SetActiveSimulationItem({
            planId: String(
              item.planId,
            ),

            subPlanId: String(
              item.subPlanId,
            ),

            modelId:
              item.modelId,

            id: String(
              item.objectId,
            ),

            objectId:
              item.objectId,

            runtimeId:
              item.runtimeId,
          }),
        );

        try {
          const accumulatedObjects =
            buildAccumulatedObjects(
              safeIndex,
            );

          await applySimulationTransparency(
            safeIndex,
            showGrid,
            modelTransparency,
          );

          await gotoCamera(
            item,
            accumulatedObjects,
          );

          await selectObjectInTrimble(
            item,
          );
        } catch (error) {
          console.error(
            "Simulation viewer error:",
            error,
          );
        }
      },
      [
        items,
        dispatch,
        showGrid,
        buildAccumulatedObjects,
        applySimulationTransparency,
        modelTransparency,
        gotoCamera,
        selectObjectInTrimble,
      ],
    );

  // =====================================================
  // SHOW/HIDE GRID
  // =====================================================

  const handleShowGridChange =
    useCallback(
      async (checked) => {
        setShowGrid(checked);

        /*
         * Nếu người dùng chưa chạy simulation thì chỉ cập nhật
         * state của Switch, không isolate model.
         */
        if (
          !simulationActivatedRef.current
        ) {
          return;
        }

        if (
          !items.length ||
          index < 0 ||
          index >= items.length
        ) {
          return;
        }

        try {
          /*
           * Truyền checked trực tiếp vì setShowGrid là async.
           */
          await applySimulationTransparency(
            index,
            checked,
            modelTransparency,
          );
        } catch (error) {
          console.error(
            "Update grid visibility error:",
            error,
          );
        }
      },
      [
        items.length,
        index,
        applySimulationTransparency,
        modelTransparency,
      ],
    );

  const handleTransparencyChange =
    useCallback(
      async (value) => {
        const nextTransparency =
          Math.max(
            0,
            Math.min(
              100,
              Number(value) || 0,
            ),
          );

        setModelTransparency(
          nextTransparency,
        );

        /*
         * Chưa chạy simulation thì chỉ lưu giá trị slider.
         */
        if (
          !simulationActivatedRef.current
        ) {
          return;
        }

        if (
          !items.length ||
          index < 0 ||
          index >= items.length
        ) {
          return;
        }

        try {
          await applySimulationTransparency(
            index,
            showGrid,
            nextTransparency,
          );

          const currentItem =
            items[index];

          if (currentItem) {
            await selectObjectInTrimble(
              currentItem,
            );
          }
        } catch (error) {
          console.error(
            "Update simulation transparency failed:",
            error,
          );
        }
      },
      [
        applySimulationTransparency,
        index,
        items,
        selectObjectInTrimble,
        showGrid,
      ],
    );

  const next = useCallback(() => {
    setPlaying(false);

    clearInterval(
      intervalRef.current,
    );

    goToIndex(index + 1);
  }, [index, goToIndex]);

  const prev = useCallback(() => {
    setPlaying(false);

    clearInterval(
      intervalRef.current,
    );

    goToIndex(index - 1);
  }, [index, goToIndex]);

  const togglePlay =
    useCallback(async () => {
      if (!items.length) {
        return;
      }

      if (!playing) {
        if (
          index >=
          items.length - 1
        ) {
          await goToIndex(0);
        } else {
          await goToIndex(index);
        }
      }

      setPlaying(
        (currentPlaying) =>
          !currentPlaying,
      );
    }, [
      items.length,
      playing,
      index,
      goToIndex,
    ]);

  // =====================================================
  // AUTO PLAY
  // =====================================================

  useEffect(() => {
    if (
      !playing ||
      !items.length
    ) {
      clearInterval(
        intervalRef.current,
      );

      return;
    }

    intervalRef.current =
      setInterval(() => {
        const nextIndex =
          index + 1;

        if (
          nextIndex >=
          items.length
        ) {
          clearInterval(
            intervalRef.current,
          );

          setPlaying(false);

          return;
        }

        goToIndex(nextIndex);
      }, delay);

    return () => {
      clearInterval(
        intervalRef.current,
      );
    };
  }, [
    playing,
    delay,
    index,
    items.length,
    goToIndex,
  ]);

  useEffect(() => {
    return () => {
      clearInterval(
        intervalRef.current,
      );

      const tcapi =
        tcapiRef.current;

      if (!tcapi) {
        return;
      }

      Promise.all([
        tcapi.viewer.setOpacity(
          0,
        ),

        tcapi.viewer.setObjectState(
          undefined,
          {
            visible: "reset",
            color: "reset",
            opacity: 100,
          },
        ),
      ]).catch((error) => {
        console.error(
          "Reset simulation viewer state failed:",
          error,
        );
      });
    };
  }, []);

  // =====================================================
  // SLIDER MARKS
  // =====================================================

  const marks = useMemo(() => {
    return items.reduce(
      (
        result,
        item,
        itemIndex,
      ) => {
        result[item.value] = {
          label: (
            <div
              onClick={() => {
                setPlaying(false);

                clearInterval(
                  intervalRef.current,
                );

                goToIndex(
                  itemIndex,
                );
              }}
              style={{
                width: 8,
                height: 8,
                borderRadius:
                  "50%",
                cursor:
                  "pointer",
              }}
            />
          ),
        };

        return result;
      },
      {},
    );
  }, [items, goToIndex]);

  // =====================================================
  // FILTER HANDLERS
  // =====================================================

  const handlePlanChange = (
    values,
  ) => {
    setPlaying(false);
    setIndex(0);

    clearInterval(
      intervalRef.current,
    );

    setSelectedPlanIds(
      values || [],
    );
  };

  const handleSubPlanChange = (
    values,
  ) => {
    setPlaying(false);
    setIndex(0);

    clearInterval(
      intervalRef.current,
    );

    setSelectedSubPlanIds(
      values || [],
    );
  };

  const handleStartDateChange = (
    date,
  ) => {
    setPlaying(false);
    setIndex(0);

    clearInterval(
      intervalRef.current,
    );

    setStartDate(date);

    if (
      date &&
      endDate &&
      date.isAfter(
        endDate,
        "day",
      )
    ) {
      setEndDate(null);
    }
  };

  const handleEndDateChange = (
    date,
  ) => {
    setPlaying(false);
    setIndex(0);

    clearInterval(
      intervalRef.current,
    );

    setEndDate(date);

    if (
      date &&
      startDate &&
      date.isBefore(
        startDate,
        "day",
      )
    ) {
      setStartDate(null);
    }
  };

  // =====================================================
  // EMPTY DATA
  // =====================================================

  if (!allItems.length) {
    return (
      <div>
        There is no simulation data available
      </div>
    );
  }

  // =====================================================
  // JSX
  // =====================================================

  return (
    <div style={{ width: "100%" }}>
      {/* FILTERS */}
      <div
        style={{
          width: "100%",
          marginBottom: 24,
        }}
      >
        {/* PLAN + GRID */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            marginBottom: 8,
          }}
        >
          <Select
            mode="multiple"
            size="small"
            allowClear
            showSearch
            maxTagCount="responsive"
            value={selectedPlanIds}
            placeholder="Select plans"
            optionFilterProp="label"
            onChange={
              handlePlanChange
            }
            style={{
              flex: 1,
              minWidth: 0,
            }}
            options={plans.map(
              (plan) => ({
                value: String(
                  plan.id,
                ),

                label:
                  plan.name ||
                  "Unnamed Plan",
              }),
            )}
          />

          <Tooltip
            title={
              showGrid
                ? "Hide Grid"
                : "Show Grid"
            }
          >
            <Switch
              checked={showGrid}
              onChange={
                handleShowGridChange
              }
              size="small"
            />
          </Tooltip>
        </div>

        {/* SUB PLAN */}
        <div
          style={{
            width: "100%",
            marginBottom: 8,
          }}
        >
          <Select
            mode="multiple"
            size="small"
            allowClear
            showSearch
            maxTagCount="responsive"
            value={
              selectedSubPlanIds
            }
            placeholder="Select sub plans"
            optionFilterProp="label"
            onChange={
              handleSubPlanChange
            }
            disabled={
              !availableSubPlans.length
            }
            style={{
              width: "100%",
            }}
            options={availableSubPlans.map(
              (subPlan) => {
                const subPlanPlanId =
                  subPlan.planId ??
                  subPlan.parentPlanId;

                const parentPlan =
                  plans.find(
                    (plan) =>
                      String(
                        plan.id,
                      ) ===
                      String(
                        subPlanPlanId,
                      ),
                  );

                const subPlanName =
                  subPlan.name ||
                  "Unnamed Sub Plan";

                const label =
                  parentPlan?.name
                    ? `${subPlanName} (${parentPlan.name})`
                    : subPlanName;

                return {
                  value: String(
                    subPlan.id,
                  ),

                  label,
                };
              },
            )}
          />
        </div>

        {/* DATE FILTERS */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(2, minmax(0, 1fr))",
            gap: 8,
            width: "100%",
          }}
        >
          <DatePicker
            size="small"
            style={{
              width: "100%",
            }}
            format="DD-MM-YYYY"
            placeholder="Start Date"
            value={startDate}
            onChange={
              handleStartDateChange
            }
            disabledDate={(date) => {
              if (!endDate) {
                return false;
              }

              return date.isAfter(
                endDate,
                "day",
              );
            }}
          />

          <DatePicker
            size="small"
            style={{
              width: "100%",
            }}
            format="DD-MM-YYYY"
            placeholder="End Date"
            value={endDate}
            onChange={
              handleEndDateChange
            }
            disabledDate={(date) => {
              if (!startDate) {
                return false;
              }

              return date.isBefore(
                startDate,
                "day",
              );
            }}
          />
        </div>
      </div>

      {!selectedPlanIds.length ? (
        <div>
          Please select at least one plan
        </div>
      ) : resolvingRuntimeIds ? (
        <div>
          Resolving model object IDs...
        </div>
      ) : !items.length ? (
        <div>
          No objects match the selected plans and date range,
          or their Runtime IDs could not be resolved
        </div>
      ) : (
        <>
          {/* CURRENT ITEM */}
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              alignItems: "center",
              gap: 12,
              marginBottom: 8,
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            <span>
              {current?.planName ||
                "-"}
            </span>

            <span>
              {`${current?.asmPos ?? ""} Grid: ${
                current?.positionCode ?? ""
              }`}
            </span>

            <span>
              {displayWeight != null
                ? `${displayWeight} ${displayWeightUnit}`
                : "-"}
            </span>

            <span>
              {current?.simulationDate ||
                "-"}
            </span>
          </div>

          {/* SIMULATION SLIDER */}
          <Slider
            style={{
              width: "100%",
            }}
            min={0}
            max={100}
            value={
              current?.value ?? 0
            }
            marks={marks}
            tooltip={{
              open: false,
            }}
            onChange={(value) => {
              const nearestIndex =
                items.reduce(
                  (
                    bestIndex,
                    item,
                    itemIndex,
                  ) => {
                    const currentDistance =
                      Math.abs(
                        item.value -
                          value,
                      );

                    const bestDistance =
                      Math.abs(
                        items[
                          bestIndex
                        ].value -
                          value,
                      );

                    return currentDistance <
                      bestDistance
                      ? itemIndex
                      : bestIndex;
                  },
                  0,
                );

              setPlaying(false);

              clearInterval(
                intervalRef.current,
              );

              goToIndex(
                nearestIndex,
              );
            }}
          />

          {/* CONTROLS */}
          <div
            style={{
              display: "flex",
              justifyContent:
                "center",
              marginTop: 16,
            }}
          >
            <Space>
              <Button
                icon={
                  <StepBackwardOutlined />
                }
                onClick={prev}
                disabled={index === 0}
              />

              <Button
                type="primary"
                shape="circle"
                icon={
                  playing ? (
                    <PauseCircleOutlined />
                  ) : (
                    <PlayCircleOutlined />
                  )
                }
                onClick={togglePlay}
              />

              <Button
                icon={
                  <StepForwardOutlined />
                }
                onClick={next}
                disabled={
                  index ===
                  items.length - 1
                }
              />
            </Space>
          </div>

          {/* SPEED */}
          <div
            style={{
              marginTop: 12,
            }}
          >
            <span>
              Timing: {delay} ms
            </span>

            <Slider
              min={50}
              max={5000}
              step={50}
              value={delay}
              onChange={setDelay}
              tooltip={{
                formatter: (value) =>
                  `${value} ms`,
              }}
            />
          </div>

          {/* MODEL TRANSPARENCY */}
          <div
            style={{
              marginTop: 12,
            }}
          >
            <span>
              Model transparency:{" "}
              {modelTransparency}%
            </span>

            <Slider
              min={0}
              max={100}
              step={5}
              value={
                modelTransparency
              }
              marks={{
                0: "Opaque",
                50: "50%",
                100: "100%",
              }}
              onChange={
                handleTransparencyChange
              }
              tooltip={{
                formatter: (value) =>
                  `${value}% transparent`,
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}