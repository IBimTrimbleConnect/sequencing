import {
  supabase,
} from "./supabase";

import {
  createUtcSortDate,
} from "../utils/sortDate";

function mapSequenceObject(row) {
  return {
    dbId:
      row.id,

    trimbleProjectId:
      row.trimble_project_id,

    subPlanId:
      row.sub_plan_id,

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
     * Runtime-only fields.
     */
    modelId: null,
    runtimeId: null,
    id: null,

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

const OBJECT_COLUMNS = `
  id,
  trimble_project_id,
  sub_plan_id,
  external_id,
  assigned_date,
  sort_datetime,
  camera,
  created_at,
  updated_at
`;

const normalizeExternalId = (
  object,
) => {
  const externalId =
    object?.externalId ??
    object?.external_id ??
    object?.objectId;

  if (
    externalId == null ||
    externalId === ""
  ) {
    throw new Error(
      "Object external ID is required.",
    );
  }

  return String(externalId);
};

function normalizeObjectRow({
  trimbleProjectId,
  subPlanId,
  object,
  sortDatetime,
}) {
  return {
    trimble_project_id:
      String(trimbleProjectId),

    sub_plan_id:
      subPlanId,

    external_id:
      normalizeExternalId(
        object,
      ),

    assigned_date:
      object.assignedDate ??
      object.assigned_date ??
      object.date ??
      null,

    sort_datetime:
      object.sortDatetime ??
      object.sort_datetime ??
      sortDatetime,

    camera:
      object.camera ??
      null,
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

  const {
    data,
    error,
  } = await supabase
    .from(
      "sequence_objects",
    )
    .select(
      OBJECT_COLUMNS,
    )
    .eq(
      "trimble_project_id",
      String(
        trimbleProjectId,
      ),
    )
    .order(
      "sort_datetime",
      {
        ascending: true,
        nullsFirst: false,
      },
    );

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

  const {
    data,
    error,
  } = await supabase
    .from(
      "sequence_objects",
    )
    .select(
      OBJECT_COLUMNS,
    )
    .eq(
      "sub_plan_id",
      subPlanId,
    )
    .order(
      "sort_datetime",
      {
        ascending: true,
        nullsFirst: false,
      },
    );

  if (error) {
    throw error;
  }

  return (data || []).map(
    mapSequenceObject,
  );
}

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

  const {
    error: deleteError,
  } = await supabase
    .from(
      "sequence_objects",
    )
    .delete()
    .eq(
      "sub_plan_id",
      subPlanId,
    );

  if (deleteError) {
    throw deleteError;
  }

  if (!objects.length) {
    return [];
  }

  const baseDate =
    new Date();

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

  const {
    data,
    error,
  } = await supabase
    .from(
      "sequence_objects",
    )
    .insert(rows)
    .select(
      OBJECT_COLUMNS,
    );

  if (error) {
    throw error;
  }

  return (data || [])
    .map(
      mapSequenceObject,
    )
    .sort(
      (first, second) =>
        new Date(
          first.sortDatetime,
        ).getTime() -
        new Date(
          second.sortDatetime,
        ).getTime(),
    );
}

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

  const rowsToInsert = [];
  const baseDate =
    new Date();

  let globalIndex = 0;

  for (const mapping of mappings) {
    const sourceObjects =
      await getSequenceObjectsBySubPlan(
        mapping.sourceSubPlanId,
      );

    for (
      const object of
      sourceObjects
    ) {
      rowsToInsert.push({
        trimble_project_id:
          String(
            trimbleProjectId,
          ),

        sub_plan_id:
          mapping.targetSubPlanId,

        external_id:
          object.externalId,

        assigned_date:
          object.assignedDate,

        sort_datetime:
          createUtcSortDate(
            baseDate,
            globalIndex,
          ),

        camera:
          object.camera ??
          null,
      });

      globalIndex += 1;
    }
  }

  if (!rowsToInsert.length) {
    return [];
  }

  const {
    data,
    error,
  } = await supabase
    .from(
      "sequence_objects",
    )
    .insert(
      rowsToInsert,
    )
    .select(
      OBJECT_COLUMNS,
    );

  if (error) {
    throw error;
  }

  return (data || [])
    .map(
      mapSequenceObject,
    )
    .sort(
      (first, second) =>
        new Date(
          first.sortDatetime,
        ).getTime() -
        new Date(
          second.sortDatetime,
        ).getTime(),
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

  if (!objects.length) {
    return [];
  }

  const updatedObjects = [];

  for (const object of objects) {
    const date =
      new Date(
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

    let query =
      supabase
        .from(
          "sequence_objects",
        )
        .update({
          sort_datetime:
            date.toISOString(),
        });

    if (object?.dbId) {
      query = query.eq(
        "id",
        object.dbId,
      );
    } else {
      query = query.eq(
        "external_id",
        normalizeExternalId(
          object,
        ),
      );

      if (object?.subPlanId) {
        query = query.eq(
          "sub_plan_id",
          object.subPlanId,
        );
      }
    }

    const {
      data,
      error,
    } = await query
      .select(
        OBJECT_COLUMNS,
      )
      .single();

    if (error) {
      throw error;
    }

    updatedObjects.push(
      mapSequenceObject(
        data,
      ),
    );
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

  if (!objects.length) {
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
        changes.assignedDate ||
        null;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        changes,
        "camera",
      )
    ) {
      updates.camera =
        changes.camera ??
        null;
    }

    if (!Object.keys(updates).length) {
      continue;
    }

    let query =
      supabase
        .from(
          "sequence_objects",
        )
        .update(
          updates,
        );

    if (object?.dbId) {
      query = query.eq(
        "id",
        object.dbId,
      );
    } else {
      query = query.eq(
        "external_id",
        normalizeExternalId(
          object,
        ),
      );

      if (object?.subPlanId) {
        query = query.eq(
          "sub_plan_id",
          object.subPlanId,
        );
      }
    }

    const {
      data,
      error,
    } = await query
      .select(
        OBJECT_COLUMNS,
      )
      .single();

    if (error) {
      throw error;
    }

    updatedObjects.push(
      mapSequenceObject(
        data,
      ),
    );
  }

  return updatedObjects;
}
