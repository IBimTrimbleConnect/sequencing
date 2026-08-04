import { supabase } from "./supabase";

const SUB_PLAN_COLUMNS = `
  id,
  plan_id,
  trimble_project_id,
  name,
  color,
  sort_datetime,
  created_at,
  updated_at
`;

function mapSubPlan(row) {
  return {
    id: row.id,
    planId: row.plan_id,
    trimbleProjectId:
      row.trimble_project_id,
    name: row.name,
    color: row.color,
    sortDatetime:
      row.sort_datetime,
    createdAt:
      row.created_at,
    updatedAt:
      row.updated_at,
  };
}

function createSortDatetime(
  baseTime,
  index,
) {
  return new Date(
    baseTime + index,
  ).toISOString();
}

/**
 * Copy SubPlans only.
 *
 * This function creates new SubPlan records
 * under the target Plan.
 *
 * It does not copy sequence objects.
 */
export async function copySubPlans({
  trimbleProjectId,
  targetPlanId,
  sourceSubPlans,
}) {
  if (!trimbleProjectId) {
    throw new Error(
      "Trimble project ID is required.",
    );
  }

  if (!targetPlanId) {
    throw new Error(
      "Target Plan ID is required.",
    );
  }

  if (!Array.isArray(sourceSubPlans)) {
    throw new Error(
      "Source SubPlans must be an array.",
    );
  }

  if (sourceSubPlans.length === 0) {
    return [];
  }

  const baseTime = Date.now();

  const rows = sourceSubPlans.map(
    (subPlan, index) => {
      const name = String(
        subPlan?.name || "",
      ).trim();

      if (!name) {
        throw new Error(
          `SubPlan name is required at index ${index}.`,
        );
      }

      return {
        trimble_project_id:
          String(trimbleProjectId),

        plan_id:
          targetPlanId,

        name,

        color:
          subPlan.color || null,

        /*
         * Do not reuse source sort_datetime.
         * New records must receive a new order.
         */
        sort_datetime:
          createSortDatetime(
            baseTime,
            index,
          ),
      };
    },
  );

  const { data, error } =
    await supabase
      .from("sub_plans")
      .insert(rows)
      .select(SUB_PLAN_COLUMNS);

  if (error) {
    throw error;
  }

  return (data || [])
    .map(mapSubPlan)
    .sort(
      (first, second) =>
        String(
          first.sortDatetime || "",
        ).localeCompare(
          String(
            second.sortDatetime || "",
          ),
        ),
    );
}