import dayjs from "dayjs";

import {
  supabase,
} from "./supabase";

const USER_COLUMNS = `
  id,
  trimble_email,
  user_name,
  company_name,
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
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeText = (
  value,
) =>
  String(value || "")
    .trim();

const getLicenseDurationDays = (
  licenseType,
) => {
  switch (licenseType) {
    case "Trial":
      return 14;

    case "Monthly":
      return 30;

    case "Annual":
      return 365;

    default:
      throw new Error(
        "License Type must be Trial, Monthly or Annual.",
      );
  }
};

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

    userName:
      row.user_name || "",

    companyName:
      row.company_name || "",

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
  userName,
  companyName,
  status,
  startDate,
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

  const normalizedUserName =
    normalizeText(
      userName,
    );

  if (!normalizedUserName) {
    throw new Error(
      "User Name is required.",
    );
  }

  const normalizedCompanyName =
    normalizeText(
      companyName,
    );

  if (!normalizedCompanyName) {
    throw new Error(
      "Company Name is required.",
    );
  }

  const normalizedLicenseType =
    licenseType ||
    "Trial";

  if (
    ![
      "Trial",
      "Monthly",
      "Annual",
    ].includes(
      normalizedLicenseType,
    )
  ) {
    throw new Error(
      "License Type must be Trial, Monthly or Annual.",
    );
  }

  const normalizedRole =
    role ||
    "Viewer";

  if (
    ![
      "Owner",
      "Viewer",
    ].includes(
      normalizedRole,
    )
  ) {
    throw new Error(
      "Role must be Owner or Viewer.",
    );
  }

  const normalizedStatus =
    status ||
    "Active";

  if (
    ![
      "Active",
      "Inactive",
    ].includes(
      normalizedStatus,
    )
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

  const durationDays =
    getLicenseDurationDays(
      normalizedLicenseType,
    );

  const normalizedEndDate =
    dayjs(
      startDate,
    )
      .add(
        durationDays,
        "day",
      )
      .format(
        "YYYY-MM-DD",
      );

  return {
    trimble_email:
      normalizedEmail,

    user_name:
      normalizedUserName,

    company_name:
      normalizedCompanyName,

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

export async function getTrimbleUserByEmail(
  email,
) {
  const normalizedEmail =
    normalizeEmail(
      email,
    );

  if (!normalizedEmail) {
    return null;
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
      "trimble_email",
      normalizedEmail,
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

  /*
   * Trial is consumed immediately.
   *
   * Monthly / Annual do not consume Trial.
   */
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

  const currentlyTrial =
    currentUser
      .licenseType ===
    "Trial";

  const alreadyUsedTrial =
    Number(
      currentUser
        .trialCount ??
        0,
    ) >= 1;

  /*
   * Trial -> Monthly/Annual is allowed.
   *
   * Monthly/Annual -> Trial is allowed only when
   * trial_count === 0.
   */
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
      currentUser
        .trialCount ??
        0,
    );

  if (
    changingToTrial &&
    nextTrialCount === 0
  ) {
    nextTrialCount =
      1;
  }

  /*
   * Never reset Trial Count when switching to
   * Monthly or Annual.
   */
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
