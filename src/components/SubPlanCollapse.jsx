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
  UpdateSequenceObjectSortDatesRequest,
} from "../store/sequence/action";

import SubPlanModal from "./SubPlanModal";
import SequenceObjectCollapse from "./SequenceObjectCollapse";
import { createUtcSortDate, getMovedItemSortDatetime } from "../utils/sortDate";

const math = require("mathjs");

const normalizeRgbColor = (color) => {
  if (!color) {
    return null;
  }

  if (typeof color === "string") {
    const normalized = color
      .trim()
      .replace(/^#/, "");

    if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
      return {
        r: Number.parseInt(
          normalized[0] + normalized[0],
          16,
        ),
        g: Number.parseInt(
          normalized[1] + normalized[1],
          16,
        ),
        b: Number.parseInt(
          normalized[2] + normalized[2],
          16,
        ),
      };
    }

    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
      return {
        r: Number.parseInt(
          normalized.slice(0, 2),
          16,
        ),
        g: Number.parseInt(
          normalized.slice(2, 4),
          16,
        ),
        b: Number.parseInt(
          normalized.slice(4, 6),
          16,
        ),
      };
    }

    return null;
  }

  if (typeof color === "object") {
    const r = Number(color.r);
    const g = Number(color.g);
    const b = Number(color.b);

    if (
      Number.isFinite(r) &&
      Number.isFinite(g) &&
      Number.isFinite(b)
    ) {
      return {
        r: Math.max(0, Math.min(255, r)),
        g: Math.max(0, Math.min(255, g)),
        b: Math.max(0, Math.min(255, b)),
      };
    }
  }

  return null;
};

const getRgbColor = (color) => {
  const rgb = normalizeRgbColor(color);

  if (!rgb) {
    return undefined;
  }

  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
};

const getExternalId = (object) =>
  object?.externalId ??
  object?.external_id ??
  object?.objectId ??
  null;

const getRuntimeId = (object) =>
  object?.runtimeId ??
  object?.objectRuntimeId ??
  null;

const getObjectKey = (object) =>
  String(
    object?.dbId ??
      getExternalId(object) ??
      "",
  );

const SubPlanCollapse = ({
  plan,
  activeSimulationItem,
  isOwner = false,
  readOnly = false,
  loadedModelIds = [],
}) => {
  const dispatch = useDispatch();
  const { message } = App.useApp();

  const canEdit = isOwner === true && readOnly !== true;

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
    if (!canEdit) {
      return;
    }

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
    if (!canEdit) {
      return;
    }

    setSelectedSubPlan(subPlan);
    setIsEditFormOpen(true);
  };

  const handleAssignObject = async (subPlan) => {
    if (!canEdit) {
      return;
    }

    try {
      const tcapi =
        await WorkspaceAPI.connect(
          window.parent,
        );

      const selections =
        await tcapi.viewer.getSelection();

      if (!selections?.length) {
        message.info(
          "Please select at least one object.",
        );

        return;
      }

      tcapi.viewer.activateTool(
        "pointMarkup",
      );

      const onMessage = async (event) => {
        if (
          event.data.event !==
          "viewer.onMarkupChanged"
        ) {
          return;
        }

        window.removeEventListener(
          "message",
          onMessage,
        );

        try {
          const startPoint =
            event.data?.data?.data
              ?.markup?.start;

          if (!startPoint) {
            return;
          }

          const refPoint = [
            Number(
              startPoint.positionX,
            ),
            Number(
              startPoint.positionY,
            ),
            Number(
              startPoint.positionZ,
            ),
          ];

          const existingExternalIds =
            new Set();

          sequenceObjects.forEach(
            (group) => {
              (
                group?.objects || []
              ).forEach((object) => {
                const externalId =
                  getExternalId(
                    object,
                  );

                if (
                  externalId != null
                ) {
                  existingExternalIds.add(
                    String(
                      externalId,
                    ),
                  );
                }
              });
            },
          );

          const newExternalIds =
            new Set();

          const newObjects = [];

          let duplicateCount = 0;

          await tcapi.viewer.activateTool(
            "selection",
          );

          for (
            const selection of
            selections
          ) {
            const runtimeIds =
              selection.objectRuntimeIds ||
              [];

            if (!runtimeIds.length) {
              continue;
            }

            const [
              objectIds,
              boundingBoxes,
              propertyItems,
            ] = await Promise.all([
              tcapi.viewer.convertToObjectIds(
                selection.modelId,
                runtimeIds,
              ),

              tcapi.viewer.getObjectBoundingBoxes(
                selection.modelId,
                runtimeIds,
              ),

              tcapi.viewer.getObjectProperties(
                selection.modelId,
                runtimeIds,
              ),
            ]);

            for (
              let index = 0;
              index < runtimeIds.length;
              index += 1
            ) {
              const runtimeId =
                runtimeIds[index];

              const externalId =
                objectIds?.[index];

              if (
                externalId == null
              ) {
                continue;
              }

              const externalKey =
                String(externalId);

              if (
                existingExternalIds.has(
                  externalKey,
                ) ||
                newExternalIds.has(
                  externalKey,
                )
              ) {
                duplicateCount += 1;
                continue;
              }

              newExternalIds.add(
                externalKey,
              );

              const box =
                boundingBoxes?.[index];

              const propertyItem =
                propertyItems?.[index];

              const properties =
                propertyItem?.properties ||
                [];

              let asmName =
                propertyItem?.product
                  ?.name || "";

              let asmPos = "";
              let positionCode = "";
              let weight = 0;
              let asmLength = 0;

              let cogX = null;
              let cogY = null;
              let cogZ = null;

              for (
                const property of
                properties
              ) {
                for (
                  const asmProperty of
                  property.properties ||
                  []
                ) {
                  const name =
                    String(
                      asmProperty.name ||
                        "",
                    ).trim();

                  const upperName =
                    name.toUpperCase();

                  const value =
                    asmProperty.value;

                  if (
                    !asmPos &&
                    (
                      name ===
                        "Assembly/Cast unit Mark" ||
                      upperName ===
                        "ASSEMBLY_POS"
                    )
                  ) {
                    asmPos = String(
                      value || "",
                    )
                      .replace(
                        "(?)",
                        "",
                      )
                      .trim();

                    continue;
                  }

                  if (
                    !positionCode &&
                    (
                      name ===
                        "Assembly/Cast unit position code" ||
                      upperName ===
                        "ASSEMBLY_POSITION_CODE"
                    )
                  ) {
                    positionCode =
                      String(
                        value || "",
                      ).trim();

                    continue;
                  }

                  if (
                    !weight &&
                    upperName.includes(
                      "WEIGHT",
                    ) &&
                    value != null
                  ) {
                    weight =
                      Number(value);

                    continue;
                  }

                  if (
                    !asmName &&
                    upperName.includes(
                      "NAME",
                    ) &&
                    value != null
                  ) {
                    asmName =
                      String(
                        value,
                      ).trim();

                    continue;
                  }

                  if (
                    !asmLength &&
                    upperName.includes(
                      "LENGTH",
                    ) &&
                    value != null
                  ) {
                    asmLength =
                      Number(
                        value,
                      ).toFixed(0);

                    continue;
                  }

                  if (
                    cogX === null &&
                    (
                      upperName.includes(
                        "GRAVITY X",
                      ) ||
                      upperName.includes(
                        "GRAVITYX",
                      ) ||
                      upperName.includes(
                        "OX",
                      )
                    )
                  ) {
                    cogX =
                      Number(
                        value,
                      ).toFixed(0);

                    continue;
                  }

                  if (
                    cogY === null &&
                    (
                      upperName.includes(
                        "GRAVITY Y",
                      ) ||
                      upperName.includes(
                        "GRAVITYY",
                      ) ||
                      upperName.includes(
                        "OY",
                      )
                    )
                  ) {
                    cogY =
                      Number(
                        value,
                      ).toFixed(0);

                    continue;
                  }

                  if (
                    cogZ === null &&
                    (
                      upperName.includes(
                        "GRAVITY Z",
                      ) ||
                      upperName.includes(
                        "GRAVITYZ",
                      ) ||
                      upperName.includes(
                        "OZ",
                      )
                    )
                  ) {
                    cogZ =
                      Number(
                        value,
                      ).toFixed(0);
                  }
                }
              }

              let center = [
                0,
                0,
                0,
              ];

              if (box?.boundingBox) {
                center = math.divide(
                  math.add(
                    [
                      Number(
                        1000 *
                          box.boundingBox
                            .min.x,
                      ).toFixed(0),
                      Number(
                        1000 *
                          box.boundingBox
                            .min.y,
                      ).toFixed(0),
                      Number(
                        1000 *
                          box.boundingBox
                            .min.z,
                      ).toFixed(0),
                    ],
                    [
                      Number(
                        1000 *
                          box.boundingBox
                            .max.x,
                      ).toFixed(0),
                      Number(
                        1000 *
                          box.boundingBox
                            .max.y,
                      ).toFixed(0),
                      Number(
                        1000 *
                          box.boundingBox
                            .max.z,
                      ).toFixed(0),
                    ],
                  ),
                  2,
                );
              }

              const distance =
                math.distance(
                  refPoint,
                  center,
                );

              newObjects.push({
                externalId,
                modelId:
                  selection.modelId,
                runtimeId,

                /*
                 * Existing UI expects id to be
                 * the current Runtime ID.
                 */
                id: runtimeId,

                planId:
                  plan.id,

                subPlanId:
                  subPlan.id,

                asmPos,

                assignedDate:
                  dayjs().format(
                    "YYYY-MM-DD",
                  ),

                date:
                  dayjs().format(
                    "YYYY-MM-DD",
                  ),

                positionCode,

                cog:
                  cogX !== null &&
                  cogY !== null &&
                  cogZ !== null
                    ? [
                        cogX,
                        cogY,
                        cogZ,
                      ]
                    : null,

                weight,
                length:
                  asmLength,
                name:
                  asmName,

                distance:
                  math.round(
                    distance,
                  ),

                center,

                objectAvailable:
                  true,
              });
            }
          }

          await tcapi.markup.removeMarkups(
            undefined,
          );

          if (
            duplicateCount > 0
          ) {
            message.warning(
              `${duplicateCount} object(s) already exist in the sequence.`,
            );
          }

          if (!newObjects.length) {
            return;
          }

          newObjects.sort(
            (first, second) =>
              Number(
                first.distance,
              ) -
              Number(
                second.distance,
              ),
          );

          const existingObjects =
            sequenceObjects.find(
              (group) =>
                String(
                  group?.subPlanId,
                ) ===
                String(
                  subPlan.id,
                ),
            )?.objects || [];

          dispatch(
            SetObjectsRequest({
              projectId,
              planId:
                plan.id,

              subPlanId:
                subPlan.id,

              objects: [
                ...existingObjects,
                ...newObjects,
              ],
            }),
          );
        } catch (error) {
          console.error(
            "Assign object failed:",
            error,
          );

          message.error(
            "Assign object failed.",
          );
        }
      };

      window.addEventListener(
        "message",
        onMessage,
      );
    } catch (error) {
      console.error(
        "Start assign object failed:",
        error,
      );

      message.error(
        "Cannot start assigning objects.",
      );
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
    if (!canEdit) {
      return;
    }

    try {
      const tcapi =
        await WorkspaceAPI.connect(
          window.parent,
        );

      const selections =
        await tcapi.viewer.getSelection();

      if (!selections?.length) {
        message.info(
          "Please select at least one object.",
        );

        return;
      }

      const existingExternalIds =
        new Set();

      sequenceObjects.forEach(
        (group) => {
          (
            group?.objects || []
          ).forEach((object) => {
            const externalId =
              getExternalId(
                object,
              );

            if (
              externalId != null
            ) {
              existingExternalIds.add(
                String(
                  externalId,
                ),
              );
            }
          });
        },
      );

      const newExternalIds =
        new Set();

      const newObjects = [];

      let duplicateCount = 0;

      for (
        const selection of
        selections
      ) {
        const runtimeIds =
          selection.objectRuntimeIds ||
          [];

        if (!runtimeIds.length) {
          continue;
        }

        const [
          objectIds,
          propertyItems,
        ] = await Promise.all([
          tcapi.viewer.convertToObjectIds(
            selection.modelId,
            runtimeIds,
          ),

          tcapi.viewer.getObjectProperties(
            selection.modelId,
            runtimeIds,
          ),
        ]);

        for (
          let index = 0;
          index < runtimeIds.length;
          index += 1
        ) {
          const runtimeId =
            runtimeIds[index];

          const externalId =
            objectIds?.[index];

          if (
            externalId == null
          ) {
            continue;
          }

          const externalKey =
            String(externalId);

          if (
            existingExternalIds.has(
              externalKey,
            ) ||
            newExternalIds.has(
              externalKey,
            )
          ) {
            duplicateCount += 1;
            continue;
          }

          newExternalIds.add(
            externalKey,
          );

          const propertyItem =
            propertyItems?.[index];

          const properties =
            propertyItem?.properties ||
            [];

          let asmName =
            propertyItem?.product
              ?.name || "";

          let asmPos = "";
          let positionCode = "";
          let weight = 0;
          let asmLength = 0;

          let cogX = null;
          let cogY = null;
          let cogZ = null;

          for (
            const property of
            properties
          ) {
            for (
              const asmProperty of
              property.properties ||
              []
            ) {
              const name =
                String(
                  asmProperty.name ||
                    "",
                ).trim();

              const upperName =
                name.toUpperCase();

              const value =
                asmProperty.value;

              if (
                !asmPos &&
                (
                  name ===
                    "Assembly/Cast unit Mark" ||
                  upperName ===
                    "ASSEMBLY_POS"
                )
              ) {
                asmPos = String(
                  value || "",
                )
                  .replace(
                    "(?)",
                    "",
                  )
                  .trim();

                continue;
              }

              if (
                !positionCode &&
                (
                  name ===
                    "Assembly/Cast unit position code" ||
                  upperName ===
                    "ASSEMBLY_POSITION_CODE"
                )
              ) {
                positionCode =
                  String(
                    value || "",
                  ).trim();

                continue;
              }

              if (
                !weight &&
                upperName.includes(
                  "WEIGHT",
                ) &&
                value != null
              ) {
                weight =
                  Number(value);

                continue;
              }

              if (
                !asmName &&
                upperName.includes(
                  "NAME",
                ) &&
                value != null
              ) {
                asmName =
                  String(
                    value,
                  ).trim();

                continue;
              }

              if (
                !asmLength &&
                upperName.includes(
                  "LENGTH",
                ) &&
                value != null
              ) {
                asmLength =
                  Number(
                    value,
                  ).toFixed(0);

                continue;
              }

              if (
                cogX === null &&
                (
                  upperName.includes(
                    "GRAVITY X",
                  ) ||
                  upperName.includes(
                    "GRAVITYX",
                  ) ||
                  upperName.includes(
                    "OX",
                  )
                )
              ) {
                cogX =
                  Number(
                    value,
                  ).toFixed(0);

                continue;
              }

              if (
                cogY === null &&
                (
                  upperName.includes(
                    "GRAVITY Y",
                  ) ||
                  upperName.includes(
                    "GRAVITYY",
                  ) ||
                  upperName.includes(
                    "OY",
                  )
                )
              ) {
                cogY =
                  Number(
                    value,
                  ).toFixed(0);

                continue;
              }

              if (
                cogZ === null &&
                (
                  upperName.includes(
                    "GRAVITY Z",
                  ) ||
                  upperName.includes(
                    "GRAVITYZ",
                  ) ||
                  upperName.includes(
                    "OZ",
                  )
                )
              ) {
                cogZ =
                  Number(
                    value,
                  ).toFixed(0);
              }
            }
          }

          newObjects.push({
            externalId,

            modelId:
              selection.modelId,

            runtimeId,

            id:
              runtimeId,

            planId:
              plan.id,

            subPlanId:
              subPlan.id,

            asmPos,

            assignedDate:
              dayjs().format(
                "YYYY-MM-DD",
              ),

            date:
              dayjs().format(
                "YYYY-MM-DD",
              ),

            positionCode,

            cog:
              cogX !== null &&
              cogY !== null &&
              cogZ !== null
                ? [
                    cogX,
                    cogY,
                    cogZ,
                  ]
                : null,

            weight,
            length:
              asmLength,

            name:
              asmName,

            distance: 0,

            center: [
              0,
              0,
              0,
            ],

            objectAvailable:
              true,
          });
        }
      }

      if (
        duplicateCount > 0
      ) {
        message.warning(
          `${duplicateCount} object(s) already exist in the sequence.`,
        );
      }

      if (!newObjects.length) {
        return;
      }

      const existingObjects =
        sequenceObjects.find(
          (group) =>
            String(
              group?.subPlanId,
            ) ===
            String(
              subPlan.id,
            ),
        )?.objects || [];

      dispatch(
        SetObjectsRequest({
          projectId,

          planId:
            plan.id,

          subPlanId:
            subPlan.id,

          objects: [
            ...existingObjects,
            ...newObjects,
          ],
        }),
      );
    } catch (error) {
      console.error(
        "Auto assign failed:",
        error,
      );

      message.error(
        "Auto assign failed.",
      );
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
      const tcapi =
        await WorkspaceAPI.connect(
          window.parent,
        );

      const subPlanId =
        String(subPlan.id);

      const items = [];

      for (
        const group of
        sequenceObjects
      ) {
        const groupSubPlanId =
          String(
            group?.subPlanId ??
              "",
          );

        for (
          const object of
          group?.objects || []
        ) {
          const objectSubPlanId =
            String(
              object?.subPlanId ??
                groupSubPlanId,
            );

          if (
            objectSubPlanId !==
            subPlanId
          ) {
            continue;
          }

          const modelId =
            object?.modelId;

          const runtimeId =
            getRuntimeId(
              object,
            );

          const parsedDate =
            parseDate(
              object?.assignedDate ||
                object?.date,
            );

          if (
            modelId == null ||
            runtimeId == null ||
            !parsedDate ||
            object?.objectAvailable ===
              false
          ) {
            continue;
          }

          items.push({
            modelId,
            runtimeId,

            externalId:
              getExternalId(
                object,
              ),

            simulationTime:
              parsedDate.valueOf(),

            camera:
              object?.camera,
          });
        }
      }

      if (!items.length) {
        message.warning(
          "No available objects found for simulation.",
        );

        return;
      }

      items.sort(
        (first, second) =>
          first.simulationTime -
          second.simulationTime,
      );

      const color =
        normalizeRgbColor(
          subPlan.color,
        );

      const accumulatedModelMap =
        new Map();

      for (
        let index = 0;
        index < items.length;
        index += 1
      ) {
        const item =
          items[index];

        const modelKey =
          String(
            item.modelId,
          );

        if (
          !accumulatedModelMap.has(
            modelKey,
          )
        ) {
          accumulatedModelMap.set(
            modelKey,
            {
              modelId:
                item.modelId,

              entityIds:
                new Set(),
            },
          );
        }

        accumulatedModelMap
          .get(modelKey)
          .entityIds.add(
            item.runtimeId,
          );

        const accumulatedObjects = [
          ...accumulatedModelMap.values(),
        ].map((group) => ({
          modelId:
            group.modelId,

          entityIds: [
            ...group.entityIds,
          ],
        }));

        await tcapi.viewer.isolateEntities(
          accumulatedObjects,
        );

        if (color) {
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
              color,
              visible: true,
              opacity: 1,
            },
          );
        }

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

        if (item.camera) {
          await tcapi.viewer.setCamera(
            item.camera,
            {
              animationTime:
                1000,
            },
          );
        }

        if (
          index <
          items.length - 1
        ) {
          await sleep(200);
        }
      }
    } catch (error) {
      console.error(
        "handleSimulation error:",
        error,
      );

      message.error(
        "Simulation failed.",
      );
    }
  };

  const handleSortByDate = (subPlan) => {
    if (!canEdit) {
      return;
    }

    if (!projectId) {
      message.error("Trimble project ID is required.");

      return;
    }

    if (!subPlan?.id) {
      return;
    }

    const currentGroup = sequenceObjects.find(
      (group) => group && String(group.subPlanId) === String(subPlan.id),
    );

    const objects = Array.isArray(currentGroup?.objects)
      ? currentGroup.objects
      : [];

    if (objects.length < 2) {
      message.info("There are not enough objects to sort.");

      return;
    }

    const originalIndexMap = new Map(
      objects.map((object, index) => [getObjectKey(object), index]),
    );

    const sortedObjects = [...objects].sort((first, second) => {
      const firstDateValue = first?.assignedDate || first?.date || null;

      const secondDateValue = second?.assignedDate || second?.date || null;

      const firstDate = firstDateValue ? parseDate(firstDateValue) : null;

      const secondDate = secondDateValue ? parseDate(secondDateValue) : null;

      const firstValid = firstDate?.isValid() === true;

      const secondValid = secondDate?.isValid() === true;

      if (!firstValid && !secondValid) {
        return (
          (originalIndexMap.get(getObjectKey(first)) ?? 0) -
          (originalIndexMap.get(getObjectKey(second)) ?? 0)
        );
      }

      if (!firstValid) {
        return 1;
      }

      if (!secondValid) {
        return -1;
      }

      const dateDifference = firstDate.valueOf() - secondDate.valueOf();

      if (dateDifference !== 0) {
        return dateDifference;
      }

      return (
        (originalIndexMap.get(getObjectKey(first)) ?? 0) -
        (originalIndexMap.get(getObjectKey(second)) ?? 0)
      );
    });

    const baseDate = new Date();

    const updates = sortedObjects.map((object, index) => ({
      dbId: object?.dbId ?? object?.db_id ?? null,

      subPlanId: subPlan.id,

      externalId:
        getExternalId(
          object,
        ),

      sortDatetime: createUtcSortDate(baseDate, index),
    }));

    const invalidObject = updates.find(
      (object) =>
        !object.dbId &&
        object.externalId == null,
    );

    if (invalidObject) {
      message.error(
        "One or more objects are missing stable database references.",
      );

      return;
    }

    dispatch(
      UpdateSequenceObjectSortDatesRequest({
        projectId: String(projectId),

        planId: plan.id,

        subPlanId: subPlan.id,

        objects: updates,

        orderedObjects: sortedObjects.map((object, index) => ({
          ...object,

          sortDatetime: updates[index].sortDatetime,
        })),
      }),
    );
  };

  const handleHighlightObject = async (subPlan) => {
    try {
      if (!subPlan?.id) {
        return;
      }

      const tcapi =
        await WorkspaceAPI.connect(
          window.parent,
        );

      const currentGroup =
        sequenceObjects.find(
          (group) =>
            String(
              group?.subPlanId,
            ) ===
            String(
              subPlan.id,
            ),
        );

      const runtimeGroups =
        new Map();

      for (
        const object of
        currentGroup?.objects || []
      ) {
        const modelId =
          object?.modelId;

        const runtimeId =
          getRuntimeId(
            object,
          );

        if (
          modelId == null ||
          runtimeId == null ||
          object?.objectAvailable ===
            false
        ) {
          continue;
        }

        const modelKey =
          String(
            modelId,
          );

        if (
          !runtimeGroups.has(
            modelKey,
          )
        ) {
          runtimeGroups.set(
            modelKey,
            {
              modelId,

              runtimeIds:
                new Set(),
            },
          );
        }

        runtimeGroups
          .get(modelKey)
          .runtimeIds.add(
            runtimeId,
          );
      }

      const modelObjectIds = [
        ...runtimeGroups.values(),
      ]
        .map((group) => ({
          modelId:
            group.modelId,

          objectRuntimeIds: [
            ...group.runtimeIds,
          ],
        }))
        .filter(
          (group) =>
            group.objectRuntimeIds
              .length > 0,
        );

      await tcapi.viewer.setSelection(
        {
          modelObjectIds,
        },
        "set",
      );

      if (!modelObjectIds.length) {
        message.info(
          "No loaded objects are available for highlighting.",
        );
      }
    } catch (error) {
      console.error(
        "Failed to highlight objects:",
        error,
      );

      message.error(
        "Failed to highlight objects.",
      );
    }
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

  const items = currentSubPlans.map((subPlan) => {
    const currentGroup = sequenceObjects.find(
      (group) => group && String(group.subPlanId) === String(subPlan.id),
    );

    const objectCount =
      Array.isArray(
        currentGroup?.objects,
      )
        ? currentGroup.objects.filter(
            (object) =>
              object?.objectAvailable !==
              false,
          ).length
        : 0;

    return {
      key: String(subPlan.id),

      label: (
        <SortableHeader
          plan={subPlan}
          objectCount={objectCount}
          isOwner={canEdit}
          onEdit={canEdit ? () => handleEdit(subPlan) : undefined}
          onDelete={
            canEdit
              ? (item) => {
                  if (!item?.id) {
                    return;
                  }

                  dispatch(
                    DeleteSubPlanRequest({
                      planId: plan.id,
                      subPlanId: item.id,
                    }),
                  );
                }
              : undefined
          }
          onAssignObject={
            canEdit ? () => handleAssignObject(subPlan) : undefined
          }
          onAutoAssign={canEdit ? () => handleAutoAssign(subPlan) : undefined}
          onSimulation={() => handleSimulation(subPlan)}
          onSortByDate={canEdit ? () => handleSortByDate(subPlan) : undefined}
          onHighlightObject={() => handleHighlightObject(subPlan)}
        />
      ),

      children: (
        <SequenceObjectCollapse
          subPlan={subPlan}
          activeSimulationItem={activeSimulationItem}
          displayIndexMap={displayIndexMap}
          isOwner={canEdit}
          loadedModelIds={loadedModelIds}
        />
      ),

      style: {
        background: getRgbColor(subPlan.color),

        borderRadius: 0,
        marginBottom: 4,
      },
    };
  });

  if (!currentSubPlans.length) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Sub Plan" />
    );
  }

  return (
    <>
      {canEdit && (
        <SubPlanModal
          plan={selectedSubPlan}
          title="Edit Sub Plan"
          open={isEditFormOpen}
          onCancel={() => {
            setIsEditFormOpen(false);
            setSelectedSubPlan(null);
          }}
          buttonName="Modify"
          isEditing
        />
      )}

      <Spin spinning={loading}>
        <DndContext
          sensors={canEdit ? sensors : []}
          collisionDetection={closestCenter}
          onDragEnd={canEdit ? handleDragEnd : undefined}
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
