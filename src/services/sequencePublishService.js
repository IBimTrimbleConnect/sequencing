import { supabase } from "./supabase";

export const createDraftId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const safeJsonValue = (value, seen = new WeakSet()) => {
  if (typeof value === "bigint") return value.toString();
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => safeJsonValue(item, seen));
  }

  const result = {};
  Object.keys(value).forEach((key) => {
    const normalized = safeJsonValue(value[key], seen);
    if (normalized !== undefined) result[key] = normalized;
  });
  return result;
};

const normalizeColor = (color) => {
  if (color == null || color === "") return null;
  if (typeof color === "string") return color;
  const source = color?.rgb ?? color;
  const r = Number(source?.r);
  const g = Number(source?.g);
  const b = Number(source?.b);
  return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
    ? `rgb(${r}, ${g}, ${b})`
    : null;
};

const nodeRow = (node, projectId) => ({
  id: String(node.id),
  trimble_project_id: String(projectId),
  parent_id: node?.parentId ?? node?.parent_id ?? null,
  node_type: node?.nodeType ?? node?.node_type ?? "Folder",
  name: String(node?.name || "").trim(),
  color: normalizeColor(node?.color),
  sort_order: Number(node?.sortOrder ?? node?.sort_order ?? 0),
});

const objectRow = (object, nodeId, projectId) => ({
  id: String(object?.dbId ?? createDraftId()),
  trimble_project_id: String(projectId),
  sub_plan_id: null,
  node_id: String(nodeId),
  external_id: String(
    object?.externalId ?? object?.external_id ?? object?.objectId ?? "",
  ),
  assigned_date:
    object?.assignedDate ?? object?.assigned_date ?? object?.date ?? null,
  end_date: object?.endDate ?? object?.end_date ?? null,
  sort_datetime:
    object?.sortDatetime ?? object?.sort_datetime ?? new Date().toISOString(),
  camera: safeJsonValue(object?.camera ?? null),
});

const equal = (first, second) => JSON.stringify(first) === JSON.stringify(second);

const indexById = (items) =>
  new Map((items || []).map((item) => [String(item.id), item]));

const parentsBeforeChildren = (rows) => {
  const byId = indexById(rows);
  const depthCache = new Map();
  const getDepth = (row, visiting = new Set()) => {
    if (depthCache.has(row.id)) return depthCache.get(row.id);
    const parentId = row.parent_id != null ? String(row.parent_id) : null;
    if (!parentId || !byId.has(parentId) || visiting.has(row.id)) return 0;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(row.id);
    const depth = getDepth(byId.get(parentId), nextVisiting) + 1;
    depthCache.set(row.id, depth);
    return depth;
  };

  return [...rows].sort((first, second) => getDepth(first) - getDepth(second));
};

export const flattenSequenceGroups = (groups) => {
  const result = [];
  if (!(groups instanceof Map)) return result;

  groups.forEach((group, key) => {
    (group?.objects || []).forEach((object) => {
      result.push({
        ...object,
        dbId: object?.dbId ?? createDraftId(),
        nodeId: object?.nodeId ?? group?.nodeId ?? key,
      });
    });
  });

  return result;
};

export const createPublishedSnapshot = ({ projectId, nodes, sequenceGroups }) => ({
  nodes: (nodes || []).map((node) => nodeRow(node, projectId)),
  objects: flattenSequenceGroups(sequenceGroups).map((object) =>
    objectRow(object, object.nodeId, projectId),
  ),
});

export const buildPublishChanges = ({ projectId, published, nodes, sequenceGroups }) => {
  const current = createPublishedSnapshot({ projectId, nodes, sequenceGroups });
  const oldNodes = indexById(published?.nodes);
  const newNodes = indexById(current.nodes);
  const oldObjects = indexById(published?.objects);
  const newObjects = indexById(current.objects);

  const createdNodes = parentsBeforeChildren(
    current.nodes.filter((row) => !oldNodes.has(row.id)),
  );
  const updatedNodes = current.nodes.filter((row) => {
    const previous = oldNodes.get(row.id);
    return previous && !equal(previous, row);
  });
  const deletedNodeIds = [...oldNodes.keys()].filter((id) => !newNodes.has(id));

  const createdObjects = current.objects.filter((row) => !oldObjects.has(row.id));
  const updatedObjects = current.objects.filter((row) => {
    const previous = oldObjects.get(row.id);
    return previous && !equal(previous, row);
  });
  const deletedObjectIds = [...oldObjects.keys()].filter(
    (id) => !newObjects.has(id),
  );

  return {
    current,
    changes: {
      nodes: {
        created: createdNodes,
        updated: updatedNodes,
        deleted: deletedNodeIds,
      },
      objects: {
        created: createdObjects,
        updated: updatedObjects,
        deleted: deletedObjectIds,
      },
    },
  };
};

export const getPublishedRevision = async (projectId) => {
  const { data, error } = await supabase.rpc("get_sequence_v2_revision", {
    p_trimble_project_id: String(projectId),
  });
  if (error) throw error;
  return Number(data || 0);
};

export const publishSequenceV2 = async ({ projectId, expectedRevision, changes }) => {
  const { data, error } = await supabase.rpc("publish_sequence_v2", {
    p_trimble_project_id: String(projectId),
    p_expected_revision: Number(expectedRevision || 0),
    p_changes: safeJsonValue(changes),
  });

  if (error) {
    const text = `${error.message || ""} ${error.details || ""}`;
    if (text.includes("SEQUENCE_VERSION_CONFLICT")) {
      const conflict = new Error("SEQUENCE_VERSION_CONFLICT");
      conflict.code = "SEQUENCE_VERSION_CONFLICT";
      conflict.originalError = error;
      throw conflict;
    }
    throw error;
  }

  return {
    revision: Number(data?.revision ?? expectedRevision),
    publishedAt: data?.published_at ?? null,
  };
};

export const hasPublishChanges = (changes) =>
  [changes?.nodes, changes?.objects].some((group) =>
    [group?.created, group?.updated, group?.deleted].some(
      (items) => Array.isArray(items) && items.length > 0,
    ),
  );
