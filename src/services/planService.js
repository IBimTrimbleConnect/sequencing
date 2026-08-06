import { supabase } from "./supabase";
import { createUtcSortDate } from "../utils/sortDate";

const PLAN_COLUMNS = `
  id,
  trimble_project_id,
  name,
  color,
  sort_datetime,
  created_at,
  updated_at
`;

function mapPlan(row) {
  return {
    id: row.id,
    trimbleProjectId: row.trimble_project_id,
    name: row.name,
    color: row.color,
    sortDatetime: row.sort_datetime,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getPlansByProject(trimbleProjectId) {
  if (!trimbleProjectId) {
    throw new Error("Trimble project ID is required.");
  }

  const { data, error } = await supabase
    .from("plans")
    .select(PLAN_COLUMNS)
    .eq("trimble_project_id", String(trimbleProjectId))
    .order("sort_datetime", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data || []).map(mapPlan);
}

export async function createPlan({
  trimbleProjectId,
  name,
  color = null,
  sortDatetime = null,
}) {
  if (!trimbleProjectId) {
    throw new Error("Trimble project ID is required.");
  }

  if (!name?.trim()) {
    throw new Error("Plan name is required.");
  }

  const { data, error } = await supabase
    .from("plans")
    .insert({
      trimble_project_id: String(trimbleProjectId),
      name: name.trim(),
      color,
      sort_datetime: sortDatetime || new Date().toISOString(),
    })
    .select(PLAN_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return mapPlan(data);
}

export async function createPlansBulk({ trimbleProjectId, plans }) {
  if (!trimbleProjectId) {
    throw new Error("Trimble project ID is required.");
  }

  if (!Array.isArray(plans) || plans.length === 0) {
    throw new Error("At least one Plan is required.");
  }

  const baseDate = new Date();

  const rows = plans.map((plan, index) => {
    const name = String(plan?.name || "").trim();

    if (!name) {
      throw new Error(`Plan name is required at index ${index}.`);
    }

    return {
      trimble_project_id: String(trimbleProjectId),

      name,

      color: plan?.color ?? null,

      sort_datetime:
        plan?.sortDatetime ??
        plan?.sort_datetime ??
        createUtcSortDate(baseDate, index),
    };
  });

  const { data, error } = await supabase
    .from("plans")
    .insert(rows)
    .select(PLAN_COLUMNS);

  if (error) {
    throw error;
  }

  return (data || [])
    .map(mapPlan)
    .sort(
      (first, second) =>
        new Date(first.sortDatetime).getTime() -
        new Date(second.sortDatetime).getTime(),
    );
}

export async function updatePlan({ id, name, color, sortDatetime }) {
  if (!id) {
    throw new Error("Plan ID is required.");
  }

  const updates = {};

  if (name !== undefined) {
    const normalizedName = String(name || "").trim();

    if (!normalizedName) {
      throw new Error("Plan name cannot be empty.");
    }

    updates.name = normalizedName;
  }

  if (color !== undefined) {
    updates.color = color;
  }

  if (sortDatetime !== undefined) {
    const date = new Date(sortDatetime);

    if (Number.isNaN(date.getTime())) {
      throw new Error("Invalid Plan sort datetime.");
    }

    updates.sort_datetime = date.toISOString();
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("No Plan changes were provided.");
  }

  const { data, error } = await supabase
    .from("plans")
    .update(updates)
    .eq("id", id)
    .select(PLAN_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return mapPlan(data);
}

export async function deletePlan(id) {
  if (!id) {
    throw new Error("Plan ID is required.");
  }

  const { error } = await supabase.from("plans").delete().eq("id", id);

  if (error) {
    throw error;
  }

  return id;
}
