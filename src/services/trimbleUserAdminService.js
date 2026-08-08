import dayjs from "dayjs";

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
  license_type,
  trial_count,
  created_at,
  updated_at
`;

const normalizeEmail = (
  value,
) =>
  String(
    value || "",
  )
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

    licenseType:
      row.license_type,

    trialCount:
      Number(
        row.trial_count ??
        0,
      ),

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at,
  };
}

function normalizeBaseValues({
  email,
  trimbleEmail,
  status,
  startDate,
  endDate,
  role,
  licenseType,
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

  const normalizedLicenseType =
    licenseType ||
    "Trial";

  if (
    normalizedLicenseType !==
      "Trial" &&
    normalizedLicenseType !==
      "Annual"
  ) {
    throw new Error(
      "License Type must be Trial or Annual.",
    );
  }

  const normalizedRole =
    role ||
    "Viewer";

  if (
    normalizedRole !==
      "Owner" &&
    normalizedRole !==
      "Viewer"
  ) {
    throw new Error(
      "Role must be Owner or Viewer.",
    );
  }

  const normalizedStatus =
    status ||
    "Active";

  if (
    normalizedStatus !==
      "Active" &&
    normalizedStatus !==
      "Inactive"
  ) {
    throw new Error(
      "Status must be Active or Inactive.",
    );
  }

  if (!startDate) {
    throw new Error(
      "Start Date is required.",
    );
  }

  let normalizedEndDate =
    endDate ||
    null;

  if (
    normalizedLicenseType ===
    "Trial"
  ) {
    normalizedEndDate =
      dayjs(
        startDate,
      )
        .add(
          14,
          "day",
        )
        .format(
          "YYYY-MM-DD",
        );
  }

  if (
    normalizedLicenseType ===
    "Annual"
  ) {
    normalizedEndDate =
      dayjs(
        startDate,
      )
        .add(
          365,
          "day",
        )
        .format(
          "YYYY-MM-DD",
        );
  }

  return {
    trimble_email:
      normalizedEmail,

    status:
      normalizedStatus,

    start_date:
      startDate,

    end_date:
      normalizedEndDate,

    role:
      normalizedRole,

    license_type:
      normalizedLicenseType,
  };
}

export async function getTrimbleUsers() {
  const {
    data,
    error,
  } = await supabase
    .from(
      "trimble_users",
    )
    .select(
      USER_COLUMNS,
    )
    .order(
      "trimble_email",
      {
        ascending:
          true,
      },
    );

  if (error) {
    throw error;
  }

  return (
    data || []
  ).map(
    mapTrimbleUser,
  );
}

export async function getTrimbleUserById(
  id,
) {
  if (!id) {
    throw new Error(
      "Trimble user ID is required.",
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from(
      "trimble_users",
    )
    .select(
      USER_COLUMNS,
    )
    .eq(
      "id",
      id,
    )
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data
    ? mapTrimbleUser(
        data,
      )
    : null;
}

export async function createTrimbleUser(
  values,
) {
  const row =
    normalizeBaseValues(
      values,
    );

  row.trial_count =
    row.license_type ===
    "Trial"
      ? 1
      : 0;

  const {
    data,
    error,
  } = await supabase
    .from(
      "trimble_users",
    )
    .insert(
      row,
    )
    .select(
      USER_COLUMNS,
    )
    .single();

  if (error) {
    if (
      error.code ===
      "23505"
    ) {
      throw new Error(
        "A Trimble user with this email already exists.",
      );
    }

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

  const currentUser =
    await getTrimbleUserById(
      id,
    );

  if (!currentUser) {
    throw new Error(
      "Trimble user was not found.",
    );
  }

  const row =
    normalizeBaseValues(
      values,
    );

  const changingToTrial =
    row.license_type ===
    "Trial";

  const alreadyUsedTrial =
    Number(
      currentUser.trialCount,
    ) >= 1;

  const currentlyTrial =
    currentUser.licenseType ===
    "Trial";

  if (
    changingToTrial &&
    alreadyUsedTrial &&
    !currentlyTrial
  ) {
    throw new Error(
      "This user has already used the free Trial.",
    );
  }

  let nextTrialCount =
    Number(
      currentUser.trialCount ??
      0,
    );

  if (
    changingToTrial &&
    nextTrialCount === 0
  ) {
    nextTrialCount =
      1;
  }

  row.trial_count =
    nextTrialCount;

  const {
    data,
    error,
  } = await supabase
    .from(
      "trimble_users",
    )
    .update(
      row,
    )
    .eq(
      "id",
      id,
    )
    .select(
      USER_COLUMNS,
    )
    .single();

  if (error) {
    if (
      error.code ===
      "23505"
    ) {
      throw new Error(
        "A Trimble user with this email already exists.",
      );
    }

    throw error;
  }

  return mapTrimbleUser(
    data,
  );
}

export async function deactivateTrimbleUser(
  id,
) {
  if (!id) {
    throw new Error(
      "Trimble user ID is required.",
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from(
      "trimble_users",
    )
    .update({
      status:
        "Inactive",
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
    .from(
      "trimble_users",
    )
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