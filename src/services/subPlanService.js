import { supabase } from "./supabase";
import { createUtcSortDate } from "../utils/sortDate";

function mapSubPlan(row) {
  return {
    id: row.id,
    planId: row.plan_id,
    trimbleProjectId: row.trimble_project_id,
    name: row.name,
    color: row.color,
    sortDatetime: row.sort_datetime,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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

function validateRgbColor(color) {
  if (color == null) {
    return null;
  }

  const source = color?.rgb ?? color;

  const r = Number(source?.r);
  const g = Number(source?.g);
  const b = Number(source?.b);

  if (
    !Number.isFinite(r) ||
    !Number.isFinite(g) ||
    !Number.isFinite(b)
  ) {
    throw new Error(
      "SubPlan color must be a valid RGB object.",
    );
  }

  return {
    r: Math.max(0, Math.min(255, r)),
    g: Math.max(0, Math.min(255, g)),
    b: Math.max(0, Math.min(255, b)),
  };
}

export async function getSubPlansByProject(
  trimbleProjectId,
) {
  if (!trimbleProjectId) {
    throw new Error(
      "Trimble project ID is required.",
    );
  }

  const { data, error } = await supabase
    .from("sub_plans")
    .select(SUB_PLAN_COLUMNS)
    .eq(
      "trimble_project_id",
      String(trimbleProjectId),
    )
    .order("sort_datetime", {
      ascending: true,
      nullsFirst: false,
    });

  if (error) {
    throw error;
  }

  return (data || []).map(mapSubPlan);
}

export async function getSubPlansByPlan(
  planId,
) {
  if (!planId) {
    throw new Error("Plan ID is required.");
  }

  const { data, error } = await supabase
    .from("sub_plans")
    .select(SUB_PLAN_COLUMNS)
    .eq("plan_id", planId)
    .order("sort_datetime", {
      ascending: true,
      nullsFirst: false,
    });

  if (error) {
    throw error;
  }

  return (data || []).map(mapSubPlan);
}

export async function createSubPlan({
  trimbleProjectId,
  planId,
  name,
  color = null,
  sortDatetime = null,
}) {
  if (!trimbleProjectId) {
    throw new Error(
      "Trimble project ID is required.",
    );
  }

  if (!planId) {
    throw new Error("Plan ID is required.");
  }

  const normalizedName = String(
    name || "",
  ).trim();

  if (!normalizedName) {
    throw new Error(
      "SubPlan name is required.",
    );
  }

  const normalizedColor =
    validateRgbColor(color);

  const { data, error } = await supabase
    .from("sub_plans")
    .insert({
      trimble_project_id: String(
        trimbleProjectId,
      ),
      plan_id: planId,
      name: normalizedName,
      color: normalizedColor,
      sort_datetime:
        sortDatetime ||
        createUtcSortDate(),
    })
    .select(SUB_PLAN_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return mapSubPlan(data);
}

export async function createSubPlans({
  trimbleProjectId,
  planId,
  subPlans,
}) {
  if (!trimbleProjectId) {
    throw new Error(
      "Trimble project ID is required.",
    );
  }

  if (!planId) {
    throw new Error("Plan ID is required.");
  }

  if (!Array.isArray(subPlans)) {
    throw new Error(
      "SubPlans must be an array.",
    );
  }

  if (subPlans.length === 0) {
    return [];
  }

  const baseDate = new Date();

  const rows = subPlans.map(
    (subPlan, index) => {
      const normalizedName = String(
        subPlan?.name || "",
      ).trim();

      if (!normalizedName) {
        throw new Error(
          `SubPlan name is required at index ${index}.`,
        );
      }

      return {
        trimble_project_id: String(
          trimbleProjectId,
        ),
        plan_id: planId,
        name: normalizedName,
        color: validateRgbColor(
          subPlan.color,
        ),
        sort_datetime:
          subPlan.sortDatetime ||
          subPlan.sort_datetime ||
          createUtcSortDate(
            baseDate,
            index,
          ),
      };
    },
  );

  const { data, error } = await supabase
    .from("sub_plans")
    .insert(rows)
    .select(SUB_PLAN_COLUMNS);

  if (error) {
    throw error;
  }

  return (data || [])
    .map(mapSubPlan)
    .sort(
      (a, b) =>
        new Date(a.sortDatetime).getTime() -
        new Date(b.sortDatetime).getTime(),
    );
}

export async function updateSubPlan({
  id,
  name,
  color,
  sortDatetime,
}) {
  if (!id) {
    throw new Error("SubPlan ID is required.");
  }

  const updates = {};

  if (name !== undefined) {
    const normalizedName = String(name || "").trim();

    if (!normalizedName) {
      throw new Error("SubPlan name cannot be empty.");
    }

    updates.name = normalizedName;
  }

  if (color !== undefined) {
    updates.color = validateRgbColor(color);
  }

  if (sortDatetime !== undefined) {
    const date = new Date(sortDatetime);

    if (Number.isNaN(date.getTime())) {
      throw new Error("Invalid SubPlan sort datetime.");
    }

    updates.sort_datetime = date.toISOString();
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("No SubPlan changes were provided.");
  }

  console.log("Updating SubPlan:", {
    id,
    updates,
  });

  const { data, error } = await supabase
    .from("sub_plans")
    .update(updates)
    .eq("id", id)
    .select(SUB_PLAN_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  console.log("Updated SubPlan:", data);

  return mapSubPlan(data);
}

export async function updateSubPlanSortDates(
  subPlans,
) {
  if (!Array.isArray(subPlans)) {
    throw new Error(
      "SubPlans must be an array.",
    );
  }

  if (subPlans.length === 0) {
    return [];
  }

  const baseDate = new Date();
  const updatedSubPlans = [];

  for (
    let index = 0;
    index < subPlans.length;
    index += 1
  ) {
    const subPlan = subPlans[index];

    if (!subPlan?.id) {
      throw new Error(
        `SubPlan ID is required at index ${index}.`,
      );
    }

    const updated = await updateSubPlan({
      id: subPlan.id,
      sortDatetime:
        createUtcSortDate(
          baseDate,
          index,
        ),
    });

    updatedSubPlans.push(updated);
  }

  return updatedSubPlans;
}

export async function deleteSubPlan(
  id,
) {
  if (!id) {
    throw new Error(
      "SubPlan ID is required.",
    );
  }

  const { error } = await supabase
    .from("sub_plans")
    .delete()
    .eq("id", id);

  if (error) {
    throw error;
  }

  return id;
}