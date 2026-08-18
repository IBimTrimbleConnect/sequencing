import { supabase } from "./supabase";

/* ========================================================================== */
/* CONSTANTS                                                                  */
/* ========================================================================== */

export const LICENSE_TYPES = {
  TRIAL: "Trial",
  MONTHLY: "Monthly",
  ANNUAL: "Annual",
};

export const USER_ROLES = {
  OWNER: "Owner",
  VIEWER: "Viewer",
};

export const USER_STATUS = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

/* ========================================================================== */
/* MAP USER                                                                   */
/* ========================================================================== */

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,

    email:
      row.trimble_email || "",

    trimbleEmail:
      row.trimble_email || "",

    userName:
      row.user_name || "",

    companyName:
      row.company_name || "",

    status:
      row.status || "",

    startDate:
      row.start_date || null,

    endDate:
      row.end_date || null,

    role:
      row.role || "",

    licenseType:
      row.license_type || "",

    trialCount:
      Number(
        row.trial_count ?? 0,
      ),

    createdAt:
      row.created_at || null,

    updatedAt:
      row.updated_at || null,
  };
}

/* ========================================================================== */
/* DATE                                                                       */
/* ========================================================================== */

function getLocalDateString(
  date = new Date(),
) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1,
    ).padStart(
      2,
      "0",
    );

  const day =
    String(
      date.getDate(),
    ).padStart(
      2,
      "0",
    );

  return `${year}-${month}-${day}`;
}

function addDays(
  date,
  days,
) {
  const result =
    new Date(date);

  result.setDate(
    result.getDate() +
      Number(days || 0),
  );

  return result;
}

/* ========================================================================== */
/* NORMALIZE                                                                  */
/* ========================================================================== */

function normalizeEmail(
  value,
) {
  return String(
    value || "",
  )
    .trim()
    .toLowerCase();
}

function normalizeStatus(
  value,
) {
  return String(
    value || "",
  )
    .trim()
    .toLowerCase();
}

function normalizeRole(
  value,
) {
  return String(
    value || "",
  )
    .trim()
    .toLowerCase();
}

function normalizeLicenseType(
  value,
) {
  return String(
    value || "",
  )
    .trim()
    .toLowerCase();
}

/* ========================================================================== */
/* GET USERS                                                                  */
/* ========================================================================== */

export async function getUsers() {
  const {
    data,
    error,
  } =
    await supabase
      .from(
        "trimble_users",
      )
      .select("*")
      .order(
        "created_at",
        {
          ascending:
            false,
        },
      );

  if (error) {
    throw error;
  }

  return (
    data || []
  ).map(
    mapUser,
  );
}

/* ========================================================================== */
/* GET USER BY EMAIL                                                          */
/* ========================================================================== */

export async function getTrimbleUserByEmail(
  trimbleEmail,
) {
  const email =
    normalizeEmail(
      trimbleEmail,
    );

  if (!email) {
    return null;
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "trimble_users",
      )
      .select("*")
      .ilike(
        "trimble_email",
        email,
      )
      .maybeSingle();

  if (error) {
    console.error(
      "Get Trimble user failed:",
      error,
    );

    throw error;
  }

  return mapUser(
    data,
  );
}

/* ========================================================================== */
/* FREE USER                                                                  */
/* ========================================================================== */

const createFreeUser = ({
  email,
  sourceUser = null,
  reason = "LICENSE_NOT_FOUND",
}) => ({
  /*
   * Free user chỉ tồn tại runtime.
   * Không insert DB.
   */

  id:
    sourceUser?.id ??
    null,

  email,

  trimbleEmail:
    email,

  userName:
    sourceUser?.userName ||
    "",

  companyName:
    sourceUser?.companyName ||
    "",

  status:
    "Free",

  role:
    "free",

  licenseType:
    "Free",

  startDate:
    null,

  endDate:
    null,

  trialCount:
    Number(
      sourceUser
        ?.trialCount ??
        0,
    ),

  isOwner:
    false,

  isViewer:
    false,

  isFree:
    true,

  isTrial:
    false,

  freeReason:
    reason,
});

/* ========================================================================== */
/* CAN REGISTER TRIAL                                                         */
/* ========================================================================== */

export function canRegisterTrial(
  user,
) {
  /*
   * Chưa có DB user.
   */
  if (!user) {
    return true;
  }

  /*
   * Đã từng dùng Trial.
   */
  if (
    Number(
      user.trialCount ||
        0,
    ) > 0
  ) {
    return false;
  }

  const status =
    normalizeStatus(
      user.status,
    );

  const licenseType =
    normalizeLicenseType(
      user.licenseType,
    );

  /*
   * Paid license đang active.
   */
  if (
    status ===
      "active" &&
    (
      licenseType ===
        "annual" ||
      licenseType ===
        "monthly"
    )
  ) {
    return false;
  }

  return true;
}

/* ========================================================================== */
/* REGISTER TRIAL                                                             */
/* ========================================================================== */

export async function registerTrimbleTrial({
  trimbleEmail,
  userName,
  companyName,
  trialDays = 14,
}) {
  const email =
    normalizeEmail(
      trimbleEmail,
    );

  const normalizedUserName =
    String(
      userName || "",
    ).trim();

  const normalizedCompanyName =
    String(
      companyName || "",
    ).trim();

  if (!email) {
    throw new Error(
      "TRIMBLE_EMAIL_REQUIRED",
    );
  }

  if (!normalizedUserName) {
    throw new Error(
      "USER_NAME_REQUIRED",
    );
  }

  if (
    !normalizedCompanyName
  ) {
    throw new Error(
      "COMPANY_NAME_REQUIRED",
    );
  }

  const existingUser =
    await getTrimbleUserByEmail(
      email,
    );

  /*
   * ================================================================
   * ALREADY USED TRIAL
   * ================================================================
   */

  if (
    existingUser &&
    Number(
      existingUser
        .trialCount ||
        0,
    ) > 0
  ) {
    throw new Error(
      "TRIAL_ALREADY_USED",
    );
  }

  /*
   * ================================================================
   * ACTIVE PAID LICENSE
   * ================================================================
   */

  if (existingUser) {
    const status =
      normalizeStatus(
        existingUser.status,
      );

    const licenseType =
      normalizeLicenseType(
        existingUser
          .licenseType,
      );

    if (
      status ===
        "active" &&
      (
        licenseType ===
          "annual" ||
        licenseType ===
          "monthly"
      )
    ) {
      throw new Error(
        "PAID_LICENSE_ALREADY_ACTIVE",
      );
    }
  }

  const startDate =
    getLocalDateString();

  const endDate =
    getLocalDateString(
      addDays(
        new Date(),
        trialDays,
      ),
    );

  /*
   * ================================================================
   * EXISTING RECORD
   * ================================================================
   */

  if (
    existingUser?.id
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "trimble_users",
        )
        .update({
          trimble_email:
            email,

          user_name:
            normalizedUserName,

          company_name:
            normalizedCompanyName,

          status:
            USER_STATUS.ACTIVE,

          role:
            USER_ROLES.OWNER,

          license_type:
            LICENSE_TYPES.TRIAL,

          trial_count:
            Number(
              existingUser
                .trialCount ||
                0,
            ) + 1,

          start_date:
            startDate,

          end_date:
            endDate,
        })
        .eq(
          "id",
          existingUser.id,
        )
        .select("*")
        .single();

    if (error) {
      console.error(
        "Update Trial user failed:",
        error,
      );

      throw error;
    }

    return mapUser(
      data,
    );
  }

  /*
   * ================================================================
   * NEW RECORD
   * ================================================================
   */

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "trimble_users",
      )
      .insert({
        trimble_email:
          email,

        user_name:
          normalizedUserName,

        company_name:
          normalizedCompanyName,

        status:
          USER_STATUS.ACTIVE,

        role:
          USER_ROLES.OWNER,

        license_type:
          LICENSE_TYPES.TRIAL,

        trial_count:
          1,

        start_date:
          startDate,

        end_date:
          endDate,
      })
      .select("*")
      .single();

  if (error) {
    console.error(
      "Create Trial user failed:",
      error,
    );

    throw error;
  }

  return mapUser(
    data,
  );
}

/* ========================================================================== */
/* CHECK TRIMBLE USER                                                         */
/* ========================================================================== */

export async function checkTrimbleUser(
  trimbleEmail,
) {
  const email =
    normalizeEmail(
      trimbleEmail,
    );

  /*
   * ================================================================
   * EMAIL NOT AVAILABLE
   * ================================================================
   */

  if (!email) {
    return {
      allowed:
        false,

      reason:
        "Unable to retrieve the Trimble user email.",

      user:
        null,

      errorCode:
        "EMAIL_NOT_AVAILABLE",
    };
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "trimble_users",
      )
      .select("*")
      .ilike(
        "trimble_email",
        email,
      )
      .maybeSingle();

  /*
   * ================================================================
   * SUPABASE ERROR
   * ================================================================
   */

  if (error) {
    console.error(
      "Check Trimble user failed:",
      error,
    );

    return {
      allowed:
        false,

      reason:
        "Unable to verify your license. Please try again later.",

      user:
        null,

      errorCode:
        "LICENSE_CHECK_FAILED",
    };
  }

  /*
   * ================================================================
   * USER DOES NOT EXIST
   * ================================================================
   */

  if (!data) {
    return {
      allowed:
        true,

      reason:
        null,

      errorCode:
        "FREE_LICENSE",

      user:
        createFreeUser({
          email,

          reason:
            "LICENSE_NOT_FOUND",
        }),
    };
  }

  const user =
    mapUser(
      data,
    );

  const today =
    getLocalDateString();

  const normalizedStatus =
    normalizeStatus(
      user.status,
    );

  const normalizedRole =
    normalizeRole(
      user.role,
    );

  const normalizedLicenseType =
    normalizeLicenseType(
      user.licenseType,
    );

  /*
   * ================================================================
   * INACTIVE
   * ================================================================
   */

  if (
    normalizedStatus !==
    "active"
  ) {
    return {
      allowed:
        true,

      reason:
        null,

      errorCode:
        "FREE_LICENSE",

      user:
        createFreeUser({
          email,

          sourceUser:
            user,

          reason:
            "LICENSE_INACTIVE",
        }),
    };
  }

  /*
   * ================================================================
   * NOT STARTED
   * ================================================================
   */

  if (
    user.startDate &&
    today <
      user.startDate
  ) {
    return {
      allowed:
        true,

      reason:
        null,

      errorCode:
        "FREE_LICENSE",

      user:
        createFreeUser({
          email,

          sourceUser:
            user,

          reason:
            "LICENSE_NOT_STARTED",
        }),
    };
  }

  /*
   * ================================================================
   * EXPIRED
   * ================================================================
   */

  if (
    user.endDate &&
    today >
      user.endDate
  ) {
    return {
      allowed:
        true,

      reason:
        null,

      errorCode:
        "FREE_LICENSE",

      user:
        createFreeUser({
          email,

          sourceUser:
            user,

          reason:
            "LICENSE_EXPIRED",
        }),
    };
  }

  /*
   * ================================================================
   * ROLE
   * ================================================================
   */

  if (
    normalizedRole !==
      "owner" &&
    normalizedRole !==
      "viewer"
  ) {
    return {
      allowed:
        false,

      reason:
        "Your account does not have a valid application role.",

      user:
        null,

      errorCode:
        "INVALID_ROLE",
    };
  }

  /*
   * ================================================================
   * LICENSE TYPE
   * ================================================================
   */

  const validLicenseTypes =
    [
      "trial",
      "monthly",
      "annual",
    ];

  if (
    !validLicenseTypes.includes(
      normalizedLicenseType,
    )
  ) {
    return {
      allowed:
        false,

      reason:
        "Your account does not have a valid license type.",

      user:
        null,

      errorCode:
        "INVALID_LICENSE_TYPE",
    };
  }

  /*
   * ================================================================
   * VALID LICENSE
   * ================================================================
   */

  const isTrial =
    normalizedLicenseType ===
    "trial";

  return {
    allowed:
      true,

    reason:
      null,

    errorCode:
      null,

    user: {
      ...user,

      role:
        normalizedRole,

      licenseType:
        user.licenseType,

      isOwner:
        normalizedRole ===
        "owner",

      isViewer:
        normalizedRole ===
        "viewer",

      isFree:
        false,

      isTrial,
    },
  };
}