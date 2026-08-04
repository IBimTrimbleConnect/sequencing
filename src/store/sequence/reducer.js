import * as type from "./actionTypes";

const initialState = {
  projectId: "",
  projectName: "",

  currentUser: null,
  userRole: "",
  isOwner: false,

  plans: [],
  subPlans: [],
  sequenceObjects: [],

  pending: false,
  error: null,
};

const reducers = (state = initialState, action) => {
  switch (action.type) {
    case type.CREATE_PLAN_REQUEST:
    case type.UPDATE_PLAN_REQUEST:
    case type.GET_PLAN_REQUEST:
    case type.DELETE_PLAN_REQUEST:
    case type.CREATE_SUBPLAN_REQUEST:
    case type.UPDATE_SUBPLAN_REQUEST:
    case type.GET_SUBPLAN_REQUEST:
    case type.DELETE_SUBPLAN_REQUEST:
    case type.GET_SOURCE_SEQUENCE_REQUEST:
    case type.UPDATE_COMMENT_REQUEST:
    case type.SET_OBJECTS_REQUEST:
    case type.UPLOAD_TEMPLATE_REQUEST:
    case type.SELECT_OBJECTS_REQUEST:
    case type.COPY_SUBPLANS_REQUEST:
      return {
        ...state,
        pending: true,
        error: null,
      };
    case type.CREATE_PLAN_SUCCESS: {
      const newPlan = action.payload?.newPlan;

      if (!newPlan) {
        return {
          ...state,
          pending: false,
        };
      }

      return {
        ...state,
        pending: false,
        error: null,
        plans: [...state.plans, newPlan],
      };
    }

    case type.GET_PLAN_SUCCESS:
      return {
        ...state,
        pending: false,
        error: null,

        projectId: action.payload?.projectId ?? state.projectId,

        projectName: action.payload?.projectName ?? state.projectName,

        currentUser: action.payload?.currentUser ?? state.currentUser,

        userRole: action.payload?.currentUser?.role ?? state.userRole,

        isOwner: action.payload?.currentUser?.isOwner ?? false,

        plans: action.payload?.plans || [],

        subPlans: action.payload?.subPlans || [],

        sequenceObjects: action.payload?.sequenceObjects || [],
      };

    case type.UPDATE_PLAN_SUCCESS: {
      const updatedPlan = action.payload?.updatedPlan;

      if (!updatedPlan) {
        return {
          ...state,
          pending: false,
          error: null,
        };
      }

      const updatedPlans = state.plans
        .map((plan) =>
          String(plan.id) === String(updatedPlan.id)
            ? {
                ...plan,
                ...updatedPlan,
              }
            : plan,
        )
        .sort((a, b) => {
          const timeA = new Date(a.sortDatetime || 0).getTime();

          const timeB = new Date(b.sortDatetime || 0).getTime();

          return timeA - timeB;
        });

      return {
        ...state,
        pending: false,
        error: null,
        plans: updatedPlans,
      };
    }

    case type.DELETE_PLAN_SUCCESS: {
      const deletedPlanId = action.payload?.deletedPlanId;

      return {
        ...state,
        pending: false,
        error: null,

        plans: state.plans.filter(
          (plan) => String(plan.id) !== String(deletedPlanId),
        ),

        subPlans: state.subPlans.filter(
          (subPlan) => String(subPlan.planId) !== String(deletedPlanId),
        ),

        sequenceObjects: state.sequenceObjects.filter(
          (group) => String(group.planId) !== String(deletedPlanId),
        ),

        selectedObjects: [],
        selectedGroup: null,
      };
    }

    case type.CREATE_SUBPLAN_SUCCESS: {
      const newSubPlan = action.payload?.newSubPlan;

      if (!newSubPlan) {
        return {
          ...state,
          pending: false,
          error: null,
        };
      }

      return {
        ...state,
        pending: false,
        error: null,

        subPlans: [...state.subPlans, newSubPlan],

        sequenceObjects: [
          ...state.sequenceObjects,
          {
            planId: newSubPlan.planId,
            subPlanId: newSubPlan.id,
            objects: [],
          },
        ],
      };
    }

    case type.UPDATE_SUBPLAN_SUCCESS: {
      const updatedSubPlan = action.payload?.updatedSubPlan;

      if (!updatedSubPlan) {
        return {
          ...state,
          pending: false,
          error: null,
        };
      }

      const updatedSubPlans = state.subPlans
        .map((subPlan) =>
          String(subPlan.id) === String(updatedSubPlan.id)
            ? {
                ...subPlan,
                ...updatedSubPlan,
              }
            : subPlan,
        )
        .sort((a, b) => {
          /*
           * Không trộn thứ tự SubPlan của các Plan khác nhau.
           */
          if (String(a.planId) !== String(b.planId)) {
            return 0;
          }

          const timeA = new Date(a.sortDatetime || 0).getTime();

          const timeB = new Date(b.sortDatetime || 0).getTime();

          return timeA - timeB;
        });

      return {
        ...state,
        pending: false,
        error: null,
        subPlans: updatedSubPlans,

        sequenceObjects: state.sequenceObjects.map((group) =>
          String(group.subPlanId) === String(updatedSubPlan.id)
            ? {
                ...group,
                planId: updatedSubPlan.planId ?? group.planId,
              }
            : group,
        ),
      };
    }

    case type.GET_SUBPLAN_SUCCESS: {
      const incomingSubPlans = Array.isArray(action.payload?.subPlans)
        ? action.payload.subPlans
        : [];

      const incomingSequenceObjects = Array.isArray(
        action.payload?.sequenceObjects,
      )
        ? action.payload.sequenceObjects
        : [];

      const updatedSubPlans = [
        ...new Map(
          [...state.subPlans, ...incomingSubPlans]
            .filter(Boolean)
            .map((subPlan) => [String(subPlan.id), subPlan]),
        ).values(),
      ];

      const updatedSequenceObjects = [
        ...new Map(
          [...state.sequenceObjects, ...incomingSequenceObjects]
            .filter(Boolean)
            .map((group) => [String(group.subPlanId), group]),
        ).values(),
      ];

      return {
        ...state,
        pending: false,
        error: null,

        subPlans: updatedSubPlans,
        sequenceObjects: updatedSequenceObjects,

        selectedObjects: [],
        selectedGroup: null,
      };
    }

    case type.DELETE_SUBPLAN_SUCCESS: {
      const deletedSubPlanId = action.payload?.deletedSubPlanId;

      return {
        ...state,
        pending: false,
        error: null,

        subPlans: state.subPlans.filter(
          (subPlan) => String(subPlan.id) !== String(deletedSubPlanId),
        ),

        sequenceObjects: state.sequenceObjects.filter(
          (group) => String(group.subPlanId) !== String(deletedSubPlanId),
        ),

        selectedObjects: [],
        selectedGroup: null,
      };
    }

    case type.COPY_SUBPLANS_SUCCESS: {
      const copiedSubPlans = Array.isArray(action.payload?.subPlans)
        ? action.payload.subPlans
        : [];

      return {
        ...state,
        pending: false,
        error: null,

        subPlans: [...state.subPlans, ...copiedSubPlans].sort((first, second) =>
          String(first.sortDatetime || "").localeCompare(
            String(second.sortDatetime || ""),
          ),
        ),

        /*
         * Create an empty sequence-object group
         * for each newly copied SubPlan.
         */
        sequenceObjects: [
          ...state.sequenceObjects,

          ...copiedSubPlans.map((subPlan) => ({
            planId: subPlan.planId,

            subPlanId: subPlan.id,

            objects: [],
          })),
        ],
      };
    }

    case type.SET_OBJECTS_SUCCESS: {
      const subPlanId = action.payload?.subPlanId;

      const newObjects = Array.isArray(action.payload?.objects)
        ? action.payload.objects
        : [];

      const existingGroup = state.sequenceObjects.some(
        (group) => String(group?.subPlanId) === String(subPlanId),
      );

      const sequenceObjects = existingGroup
        ? state.sequenceObjects.map((group) =>
            String(group?.subPlanId) === String(subPlanId)
              ? {
                  ...group,
                  planId: action.payload?.planId ?? group.planId,
                  objects: newObjects,
                }
              : group,
          )
        : [
            ...state.sequenceObjects,
            {
              planId: action.payload?.planId ?? null,
              subPlanId,
              objects: newObjects,
            },
          ];

      return {
        ...state,
        pending: false,
        error: null,
        sequenceObjects,
      };
    }

    case type.SELECT_OBJECTS_SUCCESS:
      return {
        ...state,
        pending: false,
        error: null,

        selectedObjects: Array.isArray(action.payload?.objects)
          ? action.payload.objects
          : [],

        selectedGroup:
          action.payload?.subPlanId ?? action.payload?.folderId ?? null,
      };

    case type.UPDATE_SEQUENCE_OBJECT_SORT_DATES_SUCCESS: {
      const subPlanId = action.payload?.subPlanId;

      const updatedObjects = action.payload?.objects || [];

      const updatedMap = new Map(
        updatedObjects.map((object) => [String(object.dbId), object]),
      );

      return {
        ...state,
        pending: false,
        error: null,

        sequenceObjects: state.sequenceObjects.map((group) => {
          if (String(group.subPlanId) !== String(subPlanId)) {
            return group;
          }

          const objects = group.objects
            .map((object) => {
              const updated = updatedMap.get(String(object.dbId));

              return updated
                ? {
                    ...object,
                    sortDatetime: updated.sortDatetime,
                  }
                : object;
            })
            .sort(
              (a, b) =>
                new Date(a.sortDatetime || 0).getTime() -
                new Date(b.sortDatetime || 0).getTime(),
            );

          return {
            ...group,
            objects,
          };
        }),
      };
    }

    case type.UPDATE_SEQUENCE_OBJECT_FIELDS_REQUEST:
      return {
        ...state,
        pending: true,
        error: null,
      };

    case type.UPDATE_SEQUENCE_OBJECT_FIELDS_SUCCESS: {
      const subPlanId = action.payload?.subPlanId;

      const updatedObjects = Array.isArray(action.payload?.objects)
        ? action.payload.objects
        : [];

      const getStableKey = (object) => {
        const modelExternalId =
          object?.modelExternalId ??
          object?.model_external_id ??
          object?.modelId;

        const externalId =
          object?.externalId ?? object?.external_id ?? object?.id;

        return `${String(modelExternalId)}::${String(externalId)}`;
      };

      const updatedByDbId = new Map(
        updatedObjects
          .filter((object) => object?.dbId)
          .map((object) => [String(object.dbId), object]),
      );

      const updatedByStableKey = new Map(
        updatedObjects.map((object) => [getStableKey(object), object]),
      );

      return {
        ...state,
        pending: false,
        error: null,

        sequenceObjects: state.sequenceObjects.map((group) => {
          if (String(group.subPlanId) !== String(subPlanId)) {
            return group;
          }

          return {
            ...group,
            objects: (group.objects || []).map((object) => {
              const updated =
                (object?.dbId
                  ? updatedByDbId.get(String(object.dbId))
                  : null) ?? updatedByStableKey.get(getStableKey(object));

              if (!updated) {
                return object;
              }

              return {
                ...object,
                assignedDate: updated.assignedDate ?? object.assignedDate,
                date: updated.assignedDate ?? object.date,
                camera: updated.camera ?? object.camera,
              };
            }),
          };
        }),
      };
    }

    case type.UPDATE_SEQUENCE_OBJECT_FIELDS_FAILURE:
      return {
        ...state,
        pending: false,
        error:
          action.payload ||
          action.error ||
          "Failed to update sequence object fields.",
      };

    case type.SET_ACTIVE_SIMULATION_ITEM:
      return {
        ...state,
        activeSimulationItem: action.payload ?? null,
      };

    case type.SET_SIMULATION_DATE_RANGE:
      return {
        ...state,
        startDate: action.payload?.startDate ?? null,
        endDate: action.payload?.endDate ?? null,
      };

    case type.GET_SOURCE_SEQUENCE_SUCCESS:
      return {
        ...state,
        pending: false,
        error: null,

        sequencesToBeCopied: Array.isArray(action.payload?.sequences)
          ? action.payload.sequences
          : [],
      };

    /*
     * Temporary compatibility with older code.
     * Remove after UPDATE_COMMENT actions are no longer used.
     */
    case type.UPDATE_COMMENT_SUCCESS:
      return {
        ...state,
        pending: false,
        error: null,

        plans: Array.isArray(action.payload?.plans)
          ? action.payload.plans
          : state.plans,

        subPlans: Array.isArray(action.payload?.subPlans)
          ? action.payload.subPlans
          : state.subPlans,

        sequenceObjects: Array.isArray(action.payload?.sequenceObjects)
          ? action.payload.sequenceObjects
          : state.sequenceObjects,
      };

    case type.UPLOAD_TEMPLATE_SUCCESS:
      return {
        ...state,
        pending: false,
        error: null,
        templateFile: action.payload?.templateFile ?? null,
      };

    case type.CREATE_PLAN_FAILURE:
    case type.UPDATE_PLAN_FAILURE:
    case type.GET_PLAN_FAILURE:
    case type.DELETE_PLAN_FAILURE:
    case type.CREATE_SUBPLAN_FAILURE:
    case type.UPDATE_SUBPLAN_FAILURE:
    case type.GET_SUBPLAN_FAILURE:
    case type.DELETE_SUBPLAN_FAILURE:
    case type.GET_SOURCE_SEQUENCE_FAILURE:
    case type.UPDATE_COMMENT_FAILURE:
    case type.SET_OBJECTS_FAILURE:
    case type.UPLOAD_TEMPLATE_FAILURE:
    case type.SELECT_OBJECTS_FAILURE:
    case type.COPY_SUBPLANS_FAILURE:
      return {
        ...state,
        pending: false,
        error:
          action.payload || action.error || "An unexpected error occurred.",
      };

    default:
      return state;
  }
};

export default reducers;
