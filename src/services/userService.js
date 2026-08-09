import { supabase } from "./supabase";

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,

    email: row.trimble_email || "",

    trimbleEmail: row.trimble_email || "",

    userName: row.user_name || "",

    companyName: row.company_name || "",

    status: row.status || "",

    startDate: row.start_date || null,

    endDate: row.end_date || null,

    role: row.role || "",

    licenseType: row.license_type || "",

    trialCount: Number(
      row.trial_count ?? 0,
    ),

    createdAt: row.created_at || null,

    updatedAt: row.updated_at || null,
  };
}

function getLocalDateString(
  date = new Date(),
) {
  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1,
  ).padStart(2, "0");

  const day = String(
    date.getDate(),
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeLicenseType(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export async function getUsers() {
  const { data, error } = await supabase
    .from("trimble_users")
    .select("*")
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  return (data || []).map(mapUser);
}

const createFreeUser = ({
  email,
  sourceUser = null,
  reason = "LICENSE_NOT_FOUND",
}) => ({
  /*
   * Free user chỉ tồn tại ở runtime.
   * Không insert vào trimble_users.
   */

  id: sourceUser?.id ?? null,

  email,

  trimbleEmail: email,

  userName: sourceUser?.userName || "",

  companyName: sourceUser?.companyName || "",

  status: "Free",

  role: "free",

  licenseType: "Free",

  startDate: null,

  endDate: null,

  trialCount: Number(
    sourceUser?.trialCount ?? 0,
  ),

  isOwner: false,

  isViewer: false,

  isFree: true,

  isTrial: false,

  freeReason: reason,
});

export async function checkTrimbleUser(
  trimbleEmail,
) {
  const email = normalizeEmail(
    trimbleEmail,
  );

  /*
   * Không lấy được email từ Trimble Connect.
   */
  if (!email) {
    return {
      allowed: false,

      reason:
        "Unable to retrieve the Trimble user email.",

      user: null,

      errorCode: "EMAIL_NOT_AVAILABLE",
    };
  }

  const { data, error } = await supabase
    .from("trimble_users")
    .select("*")
    .ilike(
      "trimble_email",
      email,
    )
    .maybeSingle();

  /*
   * Nếu Supabase lỗi:
   * không fallback sang Free.
   */
  if (error) {
    console.error(
      "Check Trimble user failed:",
      error,
    );

    return {
      allowed: false,

      reason:
        "Unable to verify your license. Please try again later.",

      user: null,

      errorCode:
        "LICENSE_CHECK_FAILED",
    };
  }

  /*
   * =====================================================
   * USER KHÔNG TỒN TẠI
   * =====================================================
   *
   * Không tạo record trong database.
   * Chỉ tạo Free user ở runtime.
   */
  if (!data) {
    return {
      allowed: true,

      reason: null,

      errorCode: "FREE_LICENSE",

      user: createFreeUser({
        email,

        reason:
          "LICENSE_NOT_FOUND",
      }),
    };
  }

  const user = mapUser(data);

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
   * =====================================================
   * LICENSE INACTIVE
   * =====================================================
   */
  if (
    normalizedStatus !== "active"
  ) {
    return {
      allowed: true,

      reason: null,

      errorCode: "FREE_LICENSE",

      user: createFreeUser({
        email,

        sourceUser: user,

        reason:
          "LICENSE_INACTIVE",
      }),
    };
  }

  /*
   * =====================================================
   * LICENSE CHƯA BẮT ĐẦU
   * =====================================================
   */
  if (
    user.startDate &&
    today < user.startDate
  ) {
    return {
      allowed: true,

      reason: null,

      errorCode: "FREE_LICENSE",

      user: createFreeUser({
        email,

        sourceUser: user,

        reason:
          "LICENSE_NOT_STARTED",
      }),
    };
  }

  /*
   * =====================================================
   * LICENSE HẾT HẠN
   * =====================================================
   */
  if (
    user.endDate &&
    today > user.endDate
  ) {
    return {
      allowed: true,

      reason: null,

      errorCode: "FREE_LICENSE",

      user: createFreeUser({
        email,

        sourceUser: user,

        reason:
          "LICENSE_EXPIRED",
      }),
    };
  }

  /*
   * =====================================================
   * ROLE VALIDATION
   * =====================================================
   */

  if (
    normalizedRole !== "owner" &&
    normalizedRole !== "viewer"
  ) {
    return {
      allowed: false,

      reason:
        "Your account does not have a valid application role.",

      user: null,

      errorCode: "INVALID_ROLE",
    };
  }

  /*
   * =====================================================
   * LICENSE TYPE VALIDATION
   * =====================================================
   */

  const validLicenseTypes = [
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
      allowed: false,

      reason:
        "Your account does not have a valid license type.",

      user: null,

      errorCode:
        "INVALID_LICENSE_TYPE",
    };
  }

  /*
   * =====================================================
   * LICENSE HỢP LỆ
   * =====================================================
   *
   * Trial và Role là 2 khái niệm riêng:
   *
   * Owner + Trial:
   * isOwner = true
   * isTrial = true
   *
   * Viewer + Trial:
   * isViewer = true
   * isTrial = true
   */

  const isTrial =
    normalizedLicenseType ===
    "trial";

  return {
    allowed: true,

    reason: null,

    errorCode: null,

    user: {
      ...user,

      role: normalizedRole,

      licenseType:
        user.licenseType,

      isOwner:
        normalizedRole === "owner",

      isViewer:
        normalizedRole === "viewer",

      isFree: false,

      isTrial,
    },
  };
}