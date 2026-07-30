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

        const groupPlanId = String(
          group.planId || "",
        );

        const plan = plans.find(
          (item) =>
            String(item.id) ===
            groupPlanId,
        );

        const objects =
          group.objects || [];

        objects.forEach(
          (obj, objectIndex) => {
            const runtimeId =
              obj.id ??
              obj.runtimeId ??
              obj.objectRuntimeId;

            const planId = String(
              group.planId ??
                obj.planId ??
                "",
            );

            const subPlanId = String(
              group.subPlanId ??
                obj.subPlanId ??
                "",
            );

            const simulationDate =
              obj.assignedDate ||
              obj.date;

            const parsedDate =
              parseDate(
                simulationDate,
              );

            if (!parsedDate) {
              return;
            }

            if (runtimeId == null) {
              return;
            }

            result.push({
              ...obj,

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

              modelId:
                obj.modelId ||
                group.modelId,

              runtimeId,

              id: String(runtimeId),

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

  const items = useMemo(() => {
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

    return filtered.map(
      (item, itemIndex) => ({
        ...item,

        value:
          filtered.length === 1
            ? 0
            : Math.round(
                (itemIndex /
                  (filtered.length -
                    1)) *
                  100,
              ),
      }),
    );
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

  const colorObjectInTrimble =
    useCallback(
      async (item) => {
        if (
          item?.modelId == null ||
          item?.runtimeId == null
        ) {
          return;
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

        if (!subPlan?.color) {
          return;
        }

        const tcapi =
          await getTcapi();

        await tcapi.viewer.setObjectState(
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
          {
            color: {
              r: subPlan.color.r,
              g: subPlan.color.g,
              b: subPlan.color.b,
            },

            visible: true,
          },
        );
      },
      [
        getTcapi,
        subPlans,
      ],
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
  const isolateObjectsInTrimble =
    useCallback(
      async (
        objects,
        includeGrid = false,
      ) => {
        if (!objects?.length) {
          return;
        }

        const tcapi =
          await getTcapi();

        const isolateObjects =
          objects
            .filter(
              (group) =>
                group?.modelId !=
                  null &&
                Array.isArray(
                  group.entityIds,
                ) &&
                group.entityIds
                  .length > 0,
            )
            .map((group) => ({
              modelId:
                group.modelId,

              entityIds: [
                ...new Set(
                  group.entityIds,
                ),
              ],
            }));

        if (
          !isolateObjects.length
        ) {
          return;
        }

        const modelMap =
          new Map(
            isolateObjects.map(
              (group) => [
                String(
                  group.modelId,
                ),
                group,
              ],
            ),
          );

        if (includeGrid) {
          const grids =
            await getGridObjects();

          (grids || []).forEach(
            (group) => {
              if (
                group?.modelId ==
                null
              ) {
                return;
              }

              const gridIds = (
                group.objects || []
              )
                .map(
                  (gridObject) =>
                    gridObject.id,
                )
                .filter(
                  (gridId) =>
                    gridId != null,
                );

              if (!gridIds.length) {
                return;
              }

              const modelKey =
                String(
                  group.modelId,
                );

              if (
                modelMap.has(
                  modelKey,
                )
              ) {
                const target =
                  modelMap.get(
                    modelKey,
                  );

                target.entityIds = [
                  ...new Set([
                    ...target.entityIds,
                    ...gridIds,
                  ]),
                ];
              } else {
                const target = {
                  modelId:
                    group.modelId,

                  entityIds: [
                    ...new Set(
                      gridIds,
                    ),
                  ],
                };

                isolateObjects.push(
                  target,
                );

                modelMap.set(
                  modelKey,
                  target,
                );
              }
            },
          );
        }

        await tcapi.viewer.isolateEntities(
          isolateObjects,
        );
      },
      [
        getTcapi,
        getGridObjects,
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

            id: String(item.id),

            runtimeId:
              item.runtimeId,
          }),
        );

        try {
          const accumulatedObjects =
            buildAccumulatedObjects(
              safeIndex,
            );

          await isolateObjectsInTrimble(
            accumulatedObjects,
            showGrid,
          );

          await gotoCamera(
            item,
            accumulatedObjects,
          );

          await colorObjectInTrimble(
            item,
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
        isolateObjectsInTrimble,
        gotoCamera,
        colorObjectInTrimble,
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
          const accumulatedObjects =
            buildAccumulatedObjects(
              index,
            );

          /*
           * Truyền checked trực tiếp vì setShowGrid là async.
           */
          await isolateObjectsInTrimble(
            accumulatedObjects,
            checked,
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
        buildAccumulatedObjects,
        isolateObjectsInTrimble,
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
      ) : !items.length ? (
        <div>
          No objects match the selected plans and date range
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
        </>
      )}
    </div>
  );
}