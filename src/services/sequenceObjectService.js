import { supabase } from "./supabase";
import { createUtcSortDate } from "../utils/sortDate";

const OBJECT_COLUMNS = `
  id,
  trimble_project_id,
  sub_plan_id,
  model_external_id,
  external_id,
  assigned_date,
  sort_datetime,
  camera,
  created_at,
  updated_at
`;

function mapSequenceObject(row) {
  return {
    dbId: row.id,

    trimbleProjectId:
      row.trimble_project_id,

    subPlanId:
      row.sub_plan_id,

    modelExternalId:
      row.model_external_id,

    externalId:
      row.external_id,

    assignedDate:
      row.assigned_date,

    date:
      row.assigned_date,

    sortDatetime:
      row.sort_datetime,

    camera:
      row.camera ?? null,

    /*
     * Runtime values are resolved later
     * from Trimble Connect.
     */
    modelId: null,
    runtimeId: null,

    /*
     * Keep the stable Trimble object ID.
     */
    id:
      row.external_id ?? null,

    asmPos: null,
    asmName: null,
    mainProfile: null,
    positionCode: null,
    length: null,
    weight: null,

    objectAvailable: false,

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at,
  };
}

function getStableObjectReference(
  object,
) {
  return {
    dbId:
      object?.dbId ??
      object?.db_id ??
      null,

    subPlanId:
      object?.subPlanId ??
      object?.sub_plan_id ??
      null,

    modelExternalId:
      object?.modelExternalId ??
      object?.model_external_id ??
      object?.modelId ??
      null,

    externalId:
      object?.externalId ??
      object?.external_id ??
      object?.objectId ??
      object?.id ??
      null,
  };
}

function applyObjectReference(
  query,
  object,
) {
  const reference =
    getStableObjectReference(
      object,
    );

  if (reference.dbId) {
    return query.eq(
      "id",
      reference.dbId,
    );
  }

  if (
    !reference.modelExternalId ||
    !reference.externalId
  ) {
    throw new Error(
      "Sequence object database ID or stable external IDs are required.",
    );
  }

  /*
   * sub_plan_id is important because the same
   * Trimble object may exist in different SubPlans.
   */
  if (reference.subPlanId) {
    query = query.eq(
      "sub_plan_id",
      reference.subPlanId,
    );
  }

  return query
    .eq(
      "model_external_id",
      String(
        reference.modelExternalId,
      ),
    )
    .eq(
      "external_id",
      String(
        reference.externalId,
      ),
    );
}

function normalizeObjectRow({
  trimbleProjectId,
  subPlanId,
  object,
  sortDatetime,
}) {
  const reference =
    getStableObjectReference(
      object,
    );

  if (!reference.modelExternalId) {
    throw new Error(
      "Model external ID is required.",
    );
  }

  if (!reference.externalId) {
    throw new Error(
      "Object external ID is required.",
    );
  }

  return {
    trimble_project_id:
      String(trimbleProjectId),

    sub_plan_id:
      subPlanId,

    model_external_id:
      String(
        reference.modelExternalId,
      ),

    external_id:
      String(
        reference.externalId,
      ),

    assigned_date:
      object?.assignedDate ??
      object?.assigned_date ??
      object?.date ??
      null,

    sort_datetime:
      object?.sortDatetime ??
      object?.sort_datetime ??
      sortDatetime,

    camera:
      object?.camera ?? null,
  };
}

export async function getSequenceObjectsByProject(
  trimbleProjectId,
) {
  if (!trimbleProjectId) {
    throw new Error(
      "Trimble project ID is required.",
    );
  }

  const { data, error } =
    await supabase
      .from("sequence_objects")
      .select(OBJECT_COLUMNS)
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

  return (data || []).map(
    mapSequenceObject,
  );
}

export async function getSequenceObjectsBySubPlan(
  subPlanId,
) {
  if (!subPlanId) {
    throw new Error(
      "SubPlan ID is required.",
    );
  }

  const { data, error } =
    await supabase
      .from("sequence_objects")
      .select(OBJECT_COLUMNS)
      .eq(
        "sub_plan_id",
        subPlanId,
      )
      .order("sort_datetime", {
        ascending: true,
        nullsFirst: false,
      });

  if (error) {
    throw error;
  }

  return (data || []).map(
    mapSequenceObject,
  );
}

/**
 * Replace all objects belonging to one SubPlan.
 *
 * This method persists:
 * - assigned_date
 * - sort_datetime
 * - camera
 */
export async function replaceSequenceObjectsForSubPlan({
  trimbleProjectId,
  subPlanId,
  objects,
}) {
  if (!trimbleProjectId) {
    throw new Error(
      "Trimble project ID is required.",
    );
  }

  if (!subPlanId) {
    throw new Error(
      "SubPlan ID is required.",
    );
  }

  if (!Array.isArray(objects)) {
    throw new Error(
      "Objects must be an array.",
    );
  }

  const { error: deleteError } =
    await supabase
      .from("sequence_objects")
      .delete()
      .eq(
        "sub_plan_id",
        subPlanId,
      );

  if (deleteError) {
    throw deleteError;
  }

  if (objects.length === 0) {
    return [];
  }

  const baseDate = new Date();

  const rows = objects.map(
    (object, index) =>
      normalizeObjectRow({
        trimbleProjectId,
        subPlanId,
        object,

        sortDatetime:
          createUtcSortDate(
            baseDate,
            index,
          ),
      }),
  );

  const { data, error } =
    await supabase
      .from("sequence_objects")
      .insert(rows)
      .select(OBJECT_COLUMNS);

  if (error) {
    throw error;
  }

  return (data || [])
    .map(mapSequenceObject)
    .sort((first, second) =>
      String(
        first.sortDatetime || "",
      ).localeCompare(
        String(
          second.sortDatetime || "",
        ),
      ),
    );
}

/**
 * Copy sequence objects from source SubPlans
 * to newly created target SubPlans.
 */
export async function copySequenceObjectsToSubPlans({
  trimbleProjectId,
  mappings,
}) {
  if (!trimbleProjectId) {
    throw new Error(
      "Trimble project ID is required.",
    );
  }

  if (!Array.isArray(mappings)) {
    throw new Error(
      "Mappings must be an array.",
    );
  }

  if (mappings.length === 0) {
    return [];
  }

  const rowsToInsert = [];
  const baseDate = new Date();

  let globalIndex = 0;

  for (const mapping of mappings) {
    if (
      !mapping?.sourceSubPlanId ||
      !mapping?.targetSubPlanId
    ) {
      continue;
    }

    const sourceObjects =
      await getSequenceObjectsBySubPlan(
        mapping.sourceSubPlanId,
      );

    for (const object of sourceObjects) {
      rowsToInsert.push({
        trimble_project_id:
          String(trimbleProjectId),

        sub_plan_id:
          mapping.targetSubPlanId,

        model_external_id:
          String(
            object.modelExternalId,
          ),

        external_id:
          String(
            object.externalId,
          ),

        assigned_date:
          object.assignedDate ??
          null,

        sort_datetime:
          createUtcSortDate(
            baseDate,
            globalIndex,
          ),

        camera:
          object.camera ?? null,
      });

      globalIndex += 1;
    }
  }

  if (rowsToInsert.length === 0) {
    return [];
  }

  const { data, error } =
    await supabase
      .from("sequence_objects")
      .insert(rowsToInsert)
      .select(OBJECT_COLUMNS);

  if (error) {
    throw error;
  }

  return (data || [])
    .map(mapSequenceObject)
    .sort((first, second) =>
      String(
        first.sortDatetime || "",
      ).localeCompare(
        String(
          second.sortDatetime || "",
        ),
      ),
    );
}

export async function updateSequenceObjectSortDates(
  objects,
) {
  if (!Array.isArray(objects)) {
    throw new Error(
      "Sequence objects must be an array.",
    );
  }

  if (objects.length === 0) {
    return [];
  }

  const updatedObjects = [];

  for (const object of objects) {
    const date = new Date(
      object?.sortDatetime,
    );

    if (
      Number.isNaN(
        date.getTime(),
      )
    ) {
      throw new Error(
        "Invalid sequence object sort datetime.",
      );
    }

    let query = supabase
      .from("sequence_objects")
      .update({
        sort_datetime:
          date.toISOString(),
      });

    query = applyObjectReference(
      query,
      object,
    );

    const { data, error } =
      await query
        .select(OBJECT_COLUMNS)
        .single();

    if (error) {
      throw error;
    }

    updatedObjects.push({
      ...mapSequenceObject(data),

      /*
       * Helps the reducer preserve the exact
       * datetime requested by the UI.
       */
      requestedSortDatetime:
        date.toISOString(),
    });
  }

  return updatedObjects;
}

export async function updateSequenceObjectFields(
  objects,
) {
  if (!Array.isArray(objects)) {
    throw new Error(
      "Sequence objects must be an array.",
    );
  }

  if (objects.length === 0) {
    return [];
  }

  const updatedObjects = [];

  for (const object of objects) {
    const changes =
      object?.changes || {};

    const updates = {};

    if (
      Object.prototype.hasOwnProperty.call(
        changes,
        "assignedDate",
      )
    ) {
      updates.assigned_date =
        changes.assignedDate || null;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        changes,
        "camera",
      )
    ) {
      /*
       * Add / Change Camera:
       * updates.camera = camera object
       *
       * Delete Camera:
       * updates.camera = null
       */
      updates.camera =
        changes.camera ?? null;
    }

    if (
      !Object.keys(updates).length
    ) {
      continue;
    }

    let query = supabase
      .from("sequence_objects")
      .update(updates);

    query = applyObjectReference(
      query,
      object,
    );

    const { data, error } =
      await query
        .select(OBJECT_COLUMNS)
        .single();

    if (error) {
      throw error;
    }

    updatedObjects.push({
      ...mapSequenceObject(data),

      /*
       * Required by reducer, especially when
       * camera is intentionally set to null.
       */
      requestedChanges:
        changes,
    });
  }

  return updatedObjects;
}