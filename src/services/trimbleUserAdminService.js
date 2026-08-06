import {
  supabase,
} from "./supabase";

const USER_COLUMNS = `
  id,
  trimble_email,
  status,
  start_date,
  end_date,
  role,
  created_at,
  updated_at
`;

const normalizeEmail = (
  value,
) =>
  String(value || "")
    .trim()
    .toLowerCase();

function mapTrimbleUser(
  row,
) {
  return {
    id:
      row.id,

    email:
      row.trimble_email,

    trimbleEmail:
      row.trimble_email,

    status:
      row.status,

    startDate:
      row.start_date,

    endDate:
      row.end_date,

    role:
      row.role,

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at,
  };
}

function normalizeTrimbleUser({
  email,
  trimbleEmail,
  status,
  startDate,
  endDate,
  role,
}) {
  const normalizedEmail =
    normalizeEmail(
      trimbleEmail ??
        email,
    );

  if (!normalizedEmail) {
    throw new Error(
      "Trimble email is required.",
    );
  }

  return {
    trimble_email:
      normalizedEmail,

    status:
      status || "Active",

    start_date:
      startDate || null,

    end_date:
      endDate || null,

    role:
      role || "Viewer",
  };
}

export async function getTrimbleUsers() {
  const {
    data,
    error,
  } = await supabase
    .from("trimble_users")
    .select(USER_COLUMNS)
    .order(
      "trimble_email",
      {
        ascending: true,
      },
    );

  if (error) {
    throw error;
  }

  return (data || []).map(
    mapTrimbleUser,
  );
}

export async function createTrimbleUser(
  values,
) {
  const row =
    normalizeTrimbleUser(
      values,
    );

  const {
    data,
    error,
  } = await supabase
    .from("trimble_users")
    .insert(row)
    .select(USER_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return mapTrimbleUser(
    data,
  );
}

export async function updateTrimbleUser({
  id,
  ...values
}) {
  if (!id) {
    throw new Error(
      "Trimble user ID is required.",
    );
  }

  const row =
    normalizeTrimbleUser(
      values,
    );

  const {
    data,
    error,
  } = await supabase
    .from("trimble_users")
    .update({
      ...row,

      updated_at:
        new Date().toISOString(),
    })
    .eq(
      "id",
      id,
    )
    .select(
      USER_COLUMNS,
    )
    .single();

  if (error) {
    throw error;
  }

  return mapTrimbleUser(
    data,
  );
}

export async function deleteTrimbleUser(
  id,
) {
  if (!id) {
    throw new Error(
      "Trimble user ID is required.",
    );
  }

  const {
    error,
  } = await supabase
    .from("trimble_users")
    .delete()
    .eq(
      "id",
      id,
    );

  if (error) {
    throw error;
  }

  return id;
}