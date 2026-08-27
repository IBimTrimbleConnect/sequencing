import { supabase } from "./supabase";
import { createUtcSortDate } from "../utils/sortDate";

const NODE_COLUMNS = `
  id,
  trimble_project_id,
  parent_id,
  node_type,
  name,
  color,
  sort_order,
  created_at,
  updated_at
`;


const normalizeNodeColor = (color) => {
  if (color == null || color === "") return null;
  if (typeof color === "string") return color;
  const source = color?.rgb ?? color;
  const r = Number(source?.r);
  const g = Number(source?.g);
  const b = Number(source?.b);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    throw new Error("Node color must be a valid RGB value.");
  }
  return `rgb(${Math.max(0, Math.min(255, r))}, ${Math.max(0, Math.min(255, g))}, ${Math.max(0, Math.min(255, b))})`;
};

const mapNode = (row) => ({
  id: row.id,
  trimbleProjectId: row.trimble_project_id,
  parentId: row.parent_id,
  nodeType: row.node_type,
  name: row.name,
  color: row.color,
  sortOrder: row.sort_order ?? 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function getNodesByProject(trimbleProjectId) {
  if (!trimbleProjectId) {
    throw new Error("Trimble project ID is required.");
  }

  const { data, error } = await supabase
    .from("nodes")
    .select(NODE_COLUMNS)
    .eq("trimble_project_id", String(trimbleProjectId))
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data || []).map(mapNode);
}

export async function createNode({
  trimbleProjectId,
  parentId = null,
  name,
  color = null,
  nodeType,
  sortOrder = null,
}) {
  if (!trimbleProjectId) {
    throw new Error("Trimble project ID is required.");
  }

  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new Error("Node name is required.");
  }

  let resolvedSortOrder = Number(sortOrder);

  if (!Number.isFinite(resolvedSortOrder)) {
    let query = supabase
      .from("nodes")
      .select("sort_order")
      .eq("trimble_project_id", String(trimbleProjectId))
      .order("sort_order", { ascending: false })
      .limit(1);

    query = parentId
      ? query.eq("parent_id", parentId)
      : query.is("parent_id", null);

    const { data: existingRows, error: existingError } = await query;

    if (existingError) throw existingError;

    const maxSortOrder = Number(existingRows?.[0]?.sort_order);
    resolvedSortOrder = Number.isFinite(maxSortOrder)
      ? maxSortOrder + 1
      : 0;
  }

  const row = {
    trimble_project_id: String(trimbleProjectId),
    parent_id: parentId || null,
    name: normalizedName,
    color: normalizeNodeColor(color),
    sort_order: resolvedSortOrder,
  };

  // Keep the existing DB default/enum behavior when node_type is omitted.
  if (nodeType != null && nodeType !== "") {
    row.node_type = nodeType;
  }

  const { data, error } = await supabase
    .from("nodes")
    .insert(row)
    .select(NODE_COLUMNS)
    .single();

  if (error) throw error;

  return mapNode(data);
}


export async function createNodesBulk({ trimbleProjectId, nodes }) {
  if (!trimbleProjectId) {
    throw new Error("Trimble project ID is required.");
  }

  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error("At least one Node is required.");
  }

  const parentIds = [
    ...new Set(
      nodes.map((node) => String(node?.parentId || "__ROOT__")),
    ),
  ];

  const nextSortByParent = new Map();

  for (const parentKey of parentIds) {
    const parentId = parentKey === "__ROOT__" ? null : parentKey;

    let query = supabase
      .from("nodes")
      .select("sort_order")
      .eq("trimble_project_id", String(trimbleProjectId))
      .order("sort_order", { ascending: false })
      .limit(1);

    query = parentId == null
      ? query.is("parent_id", null)
      : query.eq("parent_id", parentId);

    const { data: existingRows, error: existingError } = await query;

    if (existingError) throw existingError;

    const maxSortOrder = Number(existingRows?.[0]?.sort_order);
    nextSortByParent.set(
      parentKey,
      Number.isFinite(maxSortOrder) ? maxSortOrder + 1 : 0,
    );
  }

  const normalizedNodes = nodes.map((node, index) => {
    const name = String(node?.name || "").trim();

    if (!name) {
      throw new Error(`Node name is required at index ${index}.`);
    }

    const parentKey = String(node?.parentId || "__ROOT__");
    const providedSortOrder = Number(node?.sortOrder);
    const sortOrder = Number.isFinite(providedSortOrder)
      ? providedSortOrder
      : nextSortByParent.get(parentKey) ?? index;

    if (!Number.isFinite(providedSortOrder)) {
      nextSortByParent.set(parentKey, sortOrder + 1);
    }

    return {
      trimble_project_id: String(trimbleProjectId),
      parent_id: node?.parentId || null,
      name,
      color: normalizeNodeColor(node?.color),
      ...(node?.nodeType ? { node_type: node.nodeType } : {}),
      sort_order: sortOrder,
    };
  });

  const { data, error } = await supabase
    .from("nodes")
    .insert(normalizedNodes)
    .select(NODE_COLUMNS);

  if (error) throw error;

  return (data || []).map(mapNode);
}

export async function updateNode({ id, name, color, sortOrder }) {
  if (!id) throw new Error("Node ID is required.");

  const updates = {};

  if (name !== undefined) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) throw new Error("Node name cannot be empty.");
    updates.name = normalizedName;
  }

  if (color !== undefined) updates.color = normalizeNodeColor(color);

  if (sortOrder !== undefined) {
    const numeric = Number(sortOrder);
    if (!Number.isFinite(numeric)) {
      throw new Error("Invalid Node sort order.");
    }
    updates.sort_order = numeric;
  }

  if (!Object.keys(updates).length) {
    throw new Error("No Node changes were provided.");
  }

  const { data, error } = await supabase
    .from("nodes")
    .update(updates)
    .eq("id", id)
    .select(NODE_COLUMNS)
    .single();

  if (error) throw error;

  return mapNode(data);
}

export async function updateNodesOrder(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) return [];

  const baseDate = new Date();
  const updated = [];

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node?.id) throw new Error(`Node ID is required at index ${index}.`);

    const result = await updateNode({
      id: node.id,
      sortOrder: index,
    });

    updated.push({
      ...result,
      sortOrder: index,
      sortDatetime: createUtcSortDate(baseDate, index),
    });
  }

  return updated;
}

export async function deleteNode(id) {
  if (!id) throw new Error("Node ID is required.");

  /*
   * The existing application treats deleting a SubPlan as deleting its
   * sequence objects as well. Keep the same behavior for a generic Node,
   * even if the FK on sequence_objects.node_id is not configured with
   * ON DELETE CASCADE in an older database.
   */
  const { data: rows, error: readError } = await supabase
    .from("nodes")
    .select("id, parent_id")
    .eq("id", id);

  if (readError) throw readError;
  if (!rows?.length) return id;

  const { data: allNodes, error: allNodesError } = await supabase
    .from("nodes")
    .select("id, parent_id");

  if (allNodesError) throw allNodesError;

  const childrenByParent = new Map();
  (allNodes || []).forEach((node) => {
    const parent = String(node.parent_id ?? "__ROOT__");
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(String(node.id));
  });

  const ids = [];
  const stack = [String(id)];
  while (stack.length) {
    const current = stack.pop();
    ids.push(current);
    (childrenByParent.get(current) || []).forEach((childId) => stack.push(childId));
  }

  const { error: objectError } = await supabase
    .from("sequence_objects")
    .delete()
    .in("node_id", ids);

  if (objectError) throw objectError;

  const { error } = await supabase
    .from("nodes")
    .delete()
    .in("id", ids);

  if (error) throw error;

  return id;
}

export async function moveNode({ id, parentId }) {
  if (!id) throw new Error("Node ID is required.");

  const { data, error } = await supabase
    .from("nodes")
    .update({ parent_id: parentId || null })
    .eq("id", id)
    .select(NODE_COLUMNS)
    .single();

  if (error) throw error;

  return mapNode(data);
}
