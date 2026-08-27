import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useDispatch,
  useSelector,
} from "react-redux";

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

import {
  Collapse,
  Button,
  Modal,
  Form,
  Input,
  Spin,
  message,
} from "antd";

import dayjs from "dayjs";

import * as WorkspaceAPI from "trimble-connect-workspace-api";

import {
  DeletePlanRequest,
  UpdatePlanRequest,
  UpdatePlansOrderRequest,
  SetObjectsRequest,
} from "../store/sequence/action";

import SubPlanModal from "./SubPlanModal";
import SubPlanCollapse from "./SubPlanCollapse";
import SortableHeader from "./SortableHeader";
import CopySubPlanModal from "./CopySubPlanModal";
import NodeSequenceMain from "./NodeSequenceMain";
import { getNodesByProject } from "../services/nodeService";

/* ========================================================================== */
/* DATE                                                                       */
/* ========================================================================== */

const DATE_FORMATS = [
  "YYYY-MM-DD",
  "DD-MM-YYYY",
  "DD/MM/YYYY",
  "YYYY/MM/DD",
];

/*
 * Parse date từ nhiều format cũ.
 */
const parseDate = (value) => {
  if (!value) {
    return null;
  }

  if (dayjs.isDayjs(value)) {
    return value.isValid()
      ? value
      : null;
  }

  for (const format of DATE_FORMATS) {
    const parsed = dayjs(
      value,
      format,
      true,
    );

    if (parsed.isValid()) {
      return parsed;
    }
  }

  const fallback =
    dayjs(value);

  return fallback.isValid()
    ? fallback
    : null;
};

/*
 * Shift weekend dates forward:
 * Saturday -> Monday
 * Sunday   -> Monday
 */
const shiftWeekendForward = (value) => {
  const parsed = parseDate(value);

  if (!parsed) {
    return null;
  }

  let result = parsed.startOf("day");

  if (result.day() === 6) {
    result = result.add(2, "day");
  } else if (result.day() === 0) {
    result = result.add(1, "day");
  }

  return result;
};

/*
 * Add/subtract working days, excluding Saturday and Sunday.
 */
const addWorkingDays = (value, amount) => {
  let result = shiftWeekendForward(value);

  if (!result) {
    return null;
  }

  const days = Number(amount) || 0;

  if (days === 0) {
    return result;
  }

  const direction = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);

  while (remaining > 0) {
    result = result.add(direction, "day");

    const day = result.day();

    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return result;
};

const addSequenceDays = (value, amount, considerWeekend = false) => {
  const parsed = parseDate(value);

  if (!parsed) {
    return null;
  }

  if (considerWeekend) {
    return parsed
      .startOf("day")
      .add(Number(amount) || 0, "day");
  }

  return addWorkingDays(value, amount);
};

/* ========================================================================== */
/* MAIN                                                                       */
/* ========================================================================== */

const LegacyMain = ({
  isOwner = false,
  isViewer = false,
  isFree = false,
  loadedModelIds = [],
  onSimulation,
}) => {
  const dispatch =
    useDispatch();

  const [form] =
    Form.useForm();

  /* ------------------------------------------------------------------------ */
  /* REDUX                                                                    */
  /* ------------------------------------------------------------------------ */

  const plans =
    useSelector(
      (state) =>
        state.sequence.plans ||
        [],
    );

  const sequenceObjects =
    useSelector(
      (state) =>
        state.sequence
          .sequenceObjects ||
        [],
    );

  const projectId =
    useSelector(
      (state) =>
        state.sequence
          .projectId ||
        "",
    );

  const loading =
    useSelector(
      (state) =>
        state.sequence.pending,
    );

  const activeSimulationItem =
    useSelector(
      (state) =>
        state.sequence
          .activeSimulationItem,
    );

  /* ------------------------------------------------------------------------ */
  /* STATE                                                                    */
  /* ------------------------------------------------------------------------ */

  const [
    isEditFormOpen,
    setIsEditFormOpen,
  ] = useState(false);

  const [
    isCreateSubPlanOpen,
    setIsCreateSubPlanOpen,
  ] = useState(false);

  const [
    isCopySubPlanOpen,
    setIsCopySubPlanOpen,
  ] = useState(false);

  const [
    planName,
    setPlanName,
  ] = useState("");

  const [
    selectedPlan,
    setSelectedPlan,
  ] = useState(null);

  const [
    activePlanKeys,
    setActivePlanKeys,
  ] = useState([]);

  const [
    localPlans,
    setLocalPlans,
  ] = useState([]);

  /* ------------------------------------------------------------------------ */
  /* DND                                                                      */
  /* ------------------------------------------------------------------------ */

  const sensors =
    useSensors(
      useSensor(
        PointerSensor,
        {
          activationConstraint: {
            distance: 5,
          },
        },
      ),
    );

  /*
   * Keep local drag-and-drop order synchronized
   * with the latest Redux data.
   */
  useEffect(() => {
    const sortedPlans = [
      ...plans,
    ].sort(
      (
        first,
        second,
      ) => {
        const firstTime =
          new Date(
            first
              ?.sortDatetime ??
              first
                ?.sort_datetime ??
              0,
          ).getTime();

        const secondTime =
          new Date(
            second
              ?.sortDatetime ??
              second
                ?.sort_datetime ??
              0,
          ).getTime();

        return (
          firstTime -
          secondTime
        );
      },
    );

    setLocalPlans(
      sortedPlans,
    );
  }, [plans]);

  /*
   * Automatically expand the active plan
   * during simulation.
   */
  useEffect(() => {
    if (
      !localPlans.length
    ) {
      return;
    }

    if (
      !activeSimulationItem
        ?.planId
    ) {
      return;
    }

    const planKey =
      String(
        activeSimulationItem
          .planId,
      );

    const exists =
      localPlans.some(
        (plan) =>
          String(plan.id) ===
          planKey,
      );

    if (!exists) {
      return;
    }

    setActivePlanKeys(
      (previousKeys) => {
        const keys =
          previousKeys.map(
            String,
          );

        if (
          keys.includes(
            planKey,
          )
        ) {
          return keys;
        }

        return [
          ...keys,
          planKey,
        ];
      },
    );
  }, [
    localPlans,
    activeSimulationItem
      ?.planId,
  ]);

  /* ======================================================================== */
  /* REORDER PLAN                                                             */
  /* ======================================================================== */

  const handleDragEnd =
    useCallback(
      ({
        active,
        over,
      }) => {
        if (
          !isOwner ||
          !over
        ) {
          return;
        }

        const activeId =
          String(active.id);

        const overId =
          String(over.id);

        if (
          activeId ===
          overId
        ) {
          return;
        }

        const oldIndex =
          localPlans.findIndex(
            (plan) =>
              String(
                plan.id,
              ) ===
              activeId,
          );

        const newIndex =
          localPlans.findIndex(
            (plan) =>
              String(
                plan.id,
              ) ===
              overId,
          );

        if (
          oldIndex < 0 ||
          newIndex < 0
        ) {
          return;
        }

        const reorderedPlans =
          arrayMove(
            localPlans,
            oldIndex,
            newIndex,
          );

        /*
         * Rebalance sort_datetime.
         */
        const baseTime =
          Date.now();

        const updatedPlans =
          reorderedPlans.map(
            (
              plan,
              index,
            ) => ({
              ...plan,

              sortDatetime:
                new Date(
                  baseTime +
                    index *
                      1000,
                ).toISOString(),
            }),
          );

        /*
         * Optimistic update.
         */
        setLocalPlans(
          updatedPlans,
        );

        dispatch(
          UpdatePlansOrderRequest({
            plans:
              updatedPlans.map(
                (plan) => ({
                  id:
                    plan.id,

                  sortDatetime:
                    plan
                      .sortDatetime,
                }),
              ),
          }),
        );
      },
      [
        dispatch,
        isOwner,
        localPlans,
      ],
    );

  /* ======================================================================== */
  /* EDIT PLAN                                                                */
  /* ======================================================================== */

  const handleEdit =
    useCallback(
      (plan) => {
        if (!isOwner) {
          return;
        }

        setSelectedPlan(
          plan,
        );

        setPlanName(
          plan?.name || "",
        );

        form.setFieldsValue({
          planName:
            plan?.name || "",
        });

        setIsEditFormOpen(
          true,
        );
      },
      [
        form,
        isOwner,
      ],
    );

  /* ======================================================================== */
  /* ADD SUB PLAN                                                             */
  /* ======================================================================== */

  const handleAddSubPlan =
    useCallback(
      (plan) => {
        if (!isOwner) {
          return;
        }

        setSelectedPlan(
          plan,
        );

        setIsCreateSubPlanOpen(
          true,
        );
      },
      [isOwner],
    );

  /* ======================================================================== */
  /* COPY SUB PLAN                                                            */
  /* ======================================================================== */

  const handleCopySubPlan =
    useCallback(
      (plan) => {
        if (!isOwner) {
          return;
        }

        setSelectedPlan(
          plan,
        );

        setIsCopySubPlanOpen(
          true,
        );
      },
      [isOwner],
    );

  /* ======================================================================== */
  /* DELETE PLAN                                                              */
  /* ======================================================================== */

  const handleDelete =
    useCallback(
      (plan) => {
        if (
          !isOwner ||
          !plan?.id
        ) {
          return;
        }

        dispatch(
          DeletePlanRequest({
            planId:
              plan.id,
          }),
        );
      },
      [
        dispatch,
        isOwner,
      ],
    );

  /* ======================================================================== */
  /* MODIFY PLAN NAME                                                         */
  /* ======================================================================== */

  const handleModifyName =
    useCallback(
      async () => {
        try {
          if (
            !isOwner ||
            !selectedPlan?.id
          ) {
            return;
          }

          const values =
            await form
              .validateFields();

          const trimmedPlanName =
            values.planName.trim();

          dispatch(
            UpdatePlanRequest({
              id:
                selectedPlan.id,

              name:
                trimmedPlanName,
            }),
          );

          setIsEditFormOpen(
            false,
          );

          setSelectedPlan(
            null,
          );

          setPlanName("");

          form.resetFields();
        } catch (error) {
          if (
            !error?.errorFields
          ) {
            console.error(
              "Failed to update plan:",
              error,
            );

            message.error(
              error?.message ||
                "Unable to update the plan.",
            );
          }
        }
      },
      [
        dispatch,
        form,
        isOwner,
        selectedPlan,
      ],
    );

  const handleCloseEditModal =
    useCallback(() => {
      setIsEditFormOpen(
        false,
      );

      setSelectedPlan(
        null,
      );

      setPlanName("");

      form.resetFields();
    }, [form]);

  /* ======================================================================== */
  /* COLLAPSE                                                                 */
  /* ======================================================================== */

  const handlePlanCollapseChange =
    useCallback(
      (activeKeys) => {
        const keys =
          Array.isArray(
            activeKeys,
          )
            ? activeKeys.map(
                String,
              )
            : activeKeys
              ? [
                  String(
                    activeKeys,
                  ),
                ]
              : [];

        setActivePlanKeys(
          keys,
        );
      },
      [],
    );

  /* ======================================================================== */
  /* HIGHLIGHT ALL OBJECTS IN PLAN                                            */
  /* ======================================================================== */

  const handleHighlightObject =
    useCallback(
      async (plan) => {
        try {
          if (!plan?.id) {
            return;
          }

          const tcapi =
            await WorkspaceAPI.connect(
              window.parent,
            );

          const objects =
            sequenceObjects
              .filter(
                (group) =>
                  group &&
                  String(
                    group.planId,
                  ) ===
                    String(
                      plan.id,
                    ),
              )
              .flatMap(
                (group) =>
                  Array.isArray(
                    group.objects,
                  )
                    ? group.objects
                    : [],
              );

          if (
            !objects.length
          ) {
            await tcapi.viewer
              .setSelection(
                {
                  modelObjectIds:
                    [],
                },
                "set",
              );

            message.warning(
              "No objects were found in this plan.",
            );

            return;
          }

          const modelGroups =
            new Map();

          for (
            const object of
            objects
          ) {
            const modelId =
              object?.modelId;

            const runtimeId =
              Number(
                object
                  ?.runtimeId ??
                  object?.id,
              );

            if (
              modelId == null ||
              !Number.isFinite(
                runtimeId,
              )
            ) {
              continue;
            }

            const modelKey =
              String(modelId);

            if (
              !modelGroups.has(
                modelKey,
              )
            ) {
              modelGroups.set(
                modelKey,
                {
                  modelId,

                  objectRuntimeIds:
                    new Set(),
                },
              );
            }

            modelGroups
              .get(modelKey)
              .objectRuntimeIds
              .add(
                runtimeId,
              );
          }

          const modelObjectIds =
            [
              ...modelGroups.values(),
            ]
              .map(
                (group) => ({
                  modelId:
                    group.modelId,

                  objectRuntimeIds:
                    [
                      ...group
                        .objectRuntimeIds,
                    ],
                }),
              )
              .filter(
                (group) =>
                  group
                    .objectRuntimeIds
                    .length > 0,
              );

          if (
            !modelObjectIds.length
          ) {
            await tcapi.viewer
              .setSelection(
                {
                  modelObjectIds:
                    [],
                },
                "set",
              );

            message.warning(
              "The objects could not be resolved in the current model version.",
            );

            return;
          }

          await tcapi.viewer
            .setSelection(
              {
                modelObjectIds,
              },
              "set",
            );
        } catch (error) {
          console.error(
            "Failed to highlight plan objects:",
            error,
          );

          message.error(
            "Unable to highlight the plan objects.",
          );
        }
      },
      [sequenceObjects],
    );

  /* ======================================================================== */
  /* ASSIGN / MODIFY DATE - WHOLE PLAN                                        */
  /* ======================================================================== */

  const handleAssignPlanDate =
    useCallback(
      (
        selectedPlan,
        date,
        dateStep,
        considerWeekend = false,
      ) => {
        if (
          !isOwner ||
          !selectedPlan?.id
        ) {
          return;
        }

        const step =
          Number(
            dateStep,
          ) || 0;

        /*
         * Không chọn Date
         * và Step = 0
         *
         * => không thay đổi.
         */
        if (
          !date &&
          step === 0
        ) {
          return;
        }

        /*
         * ================================================================
         * LẤY TẤT CẢ SEQUENCE GROUP THUỘC PLAN
         * ================================================================
         *
         * Mỗi group thường tương ứng với một SubPlan.
         */
        const planGroups =
          sequenceObjects.filter(
            (group) =>
              String(
                group?.planId,
              ) ===
              String(
                selectedPlan.id,
              ),
          );

        if (
          !planGroups.length
        ) {
          message.info(
            "There are no objects in this Plan.",
          );

          return;
        }

        /*
         * ================================================================
         * GLOBAL COUNTER
         * ================================================================
         *
         * Counter KHÔNG reset khi chuyển SubPlan.
         *
         * Ví dụ:
         *
         * Date = 16-08
         * Step = 1
         *
         * SubPlan A
         *   A1 -> 16
         *   A2 -> 17
         *
         * SubPlan B
         *   B1 -> 18
         *   B2 -> 19
         */
        let dateCount = 0;

        let updatedCount =
          0;

        /*
         * ================================================================
         * UPDATE TỪNG SUBPLAN
         * ================================================================
         */
        for (
          const group of
          planGroups
        ) {
          const currentObjects =
            Array.isArray(
              group?.objects,
            )
              ? group.objects
              : [];

          if (
            !currentObjects.length
          ) {
            continue;
          }

          const updatedObjects =
            currentObjects.map(
              (object) => {
                let nextDate =
                  null;

                /*
                 * ========================================================
                 * ASSIGN DATE
                 * ========================================================
                 *
                 * Có Date:
                 *
                 * Step = 0
                 *
                 * tất cả objects cùng ngày.
                 *
                 * Step = 1
                 *
                 * object tiếp theo +1 day.
                 *
                 * Step = 2
                 *
                 * object tiếp theo +2 days.
                 */
                if (date) {
                  /*
                   * Assign by WORKING DAYS.
                   *
                   * If the selected date is Saturday/Sunday,
                   * the first object is shifted to the next Monday.
                   *
                   * The global dateCount is still shared across
                   * every SubPlan in this Plan.
                   */
                  nextDate =
                    addSequenceDays(
                      date,
                      dateCount,
                      considerWeekend,
                    );

                  dateCount +=
                    step;
                }

                /*
                 * ========================================================
                 * MODIFY EXISTING DATE
                 * ========================================================
                 *
                 * Không chọn Date:
                 *
                 * Step = 1
                 * => current date + 1
                 *
                 * Step = -1
                 * => current date - 1
                 */
                else {
                  const currentDate =
                    object
                      ?.assignedDate ||
                    object?.date;

                  /*
                   * Object chưa có date:
                   *
                   * giữ nguyên.
                   */
                  if (
                    !currentDate
                  ) {
                    return object;
                  }

                  const parsedDate =
                    parseDate(
                      currentDate,
                    );

                  if (
                    !parsedDate
                  ) {
                    return object;
                  }

                  /*
                   * Modify existing Assigned Date using working days.
                   * Weekend results are skipped automatically.
                   */
                  nextDate =
                    addSequenceDays(
                      parsedDate,
                      step,
                      considerWeekend,
                    );
                }

                if (
                  !nextDate ||
                  !nextDate.isValid()
                ) {
                  return object;
                }

                const formattedDate =
                  nextDate.format(
                    "YYYY-MM-DD",
                  );

                updatedCount +=
                  1;

                return {
                  ...object,

                  assignedDate:
                    formattedDate,

                  date:
                    formattedDate,
                };
              },
            );

          /*
           * ==============================================================
           * SAVE
           * ==============================================================
           *
           * SetObjectsRequest lưu theo từng SubPlan.
           *
           * Vì Plan có nhiều SubPlan nên dispatch từng group.
           */
          dispatch(
            SetObjectsRequest({
              projectId,

              planId:
                selectedPlan.id,

              subPlanId:
                group.subPlanId,

              objects:
                updatedObjects,
            }),
          );
        }

        if (
          updatedCount > 0
        ) {
          message.success(
            `${updatedCount} object(s) updated.`,
          );
        }
      },
      [
        dispatch,
        isOwner,
        sequenceObjects,
        projectId,
      ],
    );

  /* ======================================================================== */
  /* COLLAPSE ITEMS                                                           */
  /* ======================================================================== */

  const collapseItems =
    useMemo(
      () =>
        localPlans.map(
          (plan) => {
            /*
             * Tổng số Sequence Objects
             * thuộc Plan.
             */
            const objectCount =
              sequenceObjects
                .filter(
                  (group) =>
                    String(
                      group
                        ?.planId,
                    ) ===
                    String(
                      plan.id,
                    ),
                )
                .reduce(
                  (
                    total,
                    group,
                  ) =>
                    total +
                    (
                      Array.isArray(
                        group
                          ?.objects,
                      )
                        ? group
                            .objects
                            .length
                        : 0
                    ),
                  0,
                );

            return {
              key:
                String(
                  plan.id,
                ),

              label: (
                <SortableHeader
                  plan={
                    plan
                  }
                  objectCount={
                    objectCount
                  }
                  isOwner={
                    isOwner
                  }
                  isFree={
                    isFree
                  }

                  /*
                   * ======================================================
                   * PLAN DATE
                   * ======================================================
                   *
                   * SortableHeader sử dụng cùng layout:
                   *
                   * [DatePicker] [Step] [Edit]
                   *
                   * giống Sequence Objects và SubPlan.
                   */
                  onAssignDate={
                    isOwner
                      ? handleAssignPlanDate
                      : undefined
                  }

                  onEdit={
                    handleEdit
                  }

                  onDelete={
                    handleDelete
                  }

                  onAddSubPlan={
                    handleAddSubPlan
                  }

                  onCopySubPlan={
                    handleCopySubPlan
                  }

                  onHighlightObject={
                    handleHighlightObject
                  }

                  /*
                   * Always provide the callback
                   * so Run Simulation remains
                   * visible.
                   *
                   * SortableHeader disables it
                   * for Free.
                   */
                  onSimulation={(
                    selectedPlan,
                  ) => {
                    if (
                      isFree
                    ) {
                      return;
                    }

                    onSimulation?.(
                      selectedPlan,
                    );
                  }}
                />
              ),

              children: (
                <SubPlanCollapse
                  plan={
                    plan
                  }

                  activeSimulationItem={
                    activeSimulationItem
                  }

                  isOwner={
                    isOwner
                  }

                  isViewer={
                    isViewer
                  }

                  isFree={
                    isFree
                  }

                  readOnly={
                    !isOwner
                  }

                  loadedModelIds={
                    loadedModelIds
                  }

                  onSimulation={(
                    request,
                  ) => {
                    if (
                      isFree
                    ) {
                      return;
                    }

                    onSimulation?.(
                      request,
                    );
                  }}
                />
              ),
            };
          },
        ),
      [
        localPlans,

        sequenceObjects,

        activeSimulationItem,

        isOwner,

        isViewer,

        isFree,

        loadedModelIds,

        onSimulation,

        handleEdit,

        handleDelete,

        handleAddSubPlan,

        handleCopySubPlan,

        handleHighlightObject,

        handleAssignPlanDate,
      ],
    );

  /* ======================================================================== */
  /* UI                                                                       */
  /* ======================================================================== */

  return (
    <>
      {isOwner && (
        <>
          <CopySubPlanModal
            selectedPlan={
              selectedPlan
            }

            open={
              isCopySubPlanOpen
            }

            onCancel={() => {
              setIsCopySubPlanOpen(
                false,
              );

              setSelectedPlan(
                null,
              );
            }}
          />

          <SubPlanModal
            title="Create Sub Plan"

            buttonName="Create"

            plan={
              selectedPlan
            }

            open={
              isCreateSubPlanOpen
            }

            onCancel={() => {
              setIsCreateSubPlanOpen(
                false,
              );

              setSelectedPlan(
                null,
              );
            }}
          />
        </>
      )}

      {/* ================================================================ */}
      {/* EDIT PLAN NAME                                                   */}
      {/* ================================================================ */}

      <Modal
        title="Edit Plan Name"

        open={
          isOwner &&
          isEditFormOpen
        }

        footer={
          null
        }

        onCancel={
          handleCloseEditModal
        }

        destroyOnHidden
      >
        <Form
          form={
            form
          }

          autoComplete="off"

          onFinish={
            handleModifyName
          }
        >
          <Form.Item
            name="planName"

            rules={[
              {
                required:
                  true,

                whitespace:
                  true,

                message:
                  "Please enter the plan name.",
              },
            ]}
          >
            <Input
              placeholder="Plan Name"

              value={
                planName
              }

              onChange={(
                event,
              ) =>
                setPlanName(
                  event
                    .target
                    .value,
                )
              }
            />
          </Form.Item>

          <Form.Item
            style={{
              marginBottom:
                0,
            }}
          >
            <Button
              type="primary"

              htmlType="submit"

              disabled={
                !planName.trim()
              }
            >
              Modify
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* ================================================================ */}
      {/* PLAN COLLAPSE                                                    */}
      {/* ================================================================ */}

      <Spin
        spinning={
          loading
        }
      >
        <DndContext
          sensors={
            isOwner
              ? sensors
              : []
          }

          collisionDetection={
            closestCenter
          }

          onDragEnd={
            handleDragEnd
          }
        >
          <SortableContext
            items={
              localPlans.map(
                (plan) =>
                  String(
                    plan.id,
                  ),
              )
            }

            strategy={
              verticalListSortingStrategy
            }
          >
            <Collapse
              activeKey={
                activePlanKeys
              }

              /*
               * Only the arrow icon can expand/collapse the Plan.
               * Clicking the rest of the header does not toggle it.
               */
              collapsible="icon"

              size="small"

              items={
                collapseItems
              }

              onChange={
                handlePlanCollapseChange
              }

              style={{
                borderRadius:
                  0,
              }}

              styles={{
                header: {
                  padding:
                    "4px 8px",

                  alignItems:
                    "center",
                },

                body: {
                  padding:
                    8,
                },
              }}
            />
          </SortableContext>
        </DndContext>
      </Spin>
    </>
  );
};

const Main = (props) => {
  const { onDataChange } = props;
  const projectId = useSelector((state) => state.sequence.projectId || "");
  const activeSimulationItem = useSelector(
    (state) => state.sequence.activeSimulationItem || null,
  );

  const [nodeMode, setNodeMode] = useState(false);
  const [nodeModeChecked, setNodeModeChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkNodes = async () => {
      if (!projectId) {
        setNodeMode(false);
        setNodeModeChecked(true);
        onDataChange?.(null);
        return;
      }

      try {
        const nodes = await getNodesByProject(projectId);
        if (!cancelled) {
          /*
           * The existence of rows must NOT determine whether the
           * project uses the Node hierarchy. The `nodes` table is the
           * hierarchy source even when it is currently empty.
           *
           * Previously an empty nodes table forced LegacyMain, which
           * meant TopMenu created new Plans in `plans` instead of
           * creating root Nodes in `nodes`.
           */
          const nodeTableAvailable = Array.isArray(nodes);

          setNodeMode(nodeTableAvailable);
          setNodeModeChecked(true);

          if (nodeTableAvailable) {
            /*
             * Tell App/TopMenu immediately that Create Plan must use
             * the Node path, even before NodeSequenceMain finishes
             * loading its complete hierarchy.
             */
            onDataChange?.({
              nodeMode: true,
            });
          }
        }
      } catch (error) {
        console.error("Failed to detect node hierarchy:", error);
        if (!cancelled) {
          // Never break V1 because the new nodes table is unavailable.
          setNodeMode(false);
          setNodeModeChecked(true);
          onDataChange?.(null);
        }
      }
    };

    setNodeModeChecked(false);
    checkNodes();

    return () => {
      cancelled = true;
    };
  }, [projectId, onDataChange]);

  if (!nodeModeChecked) {
    return <Spin size="small" />;
  }

  if (nodeMode) {
    return (
      <NodeSequenceMain
        projectId={projectId}
        activeSimulationItem={activeSimulationItem}
        {...props}
      />
    );
  }

  return <LegacyMain {...props} />;
};

export default React.memo(Main);