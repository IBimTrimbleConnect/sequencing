import { supabase } from "./supabase";

function mapUser(row) {
  return {
    id: row.id,
    trimbleEmail: row.trimble_email,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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

export async function checkTrimbleUser(trimbleEmail) {
  const email = String(trimbleEmail || "")
    .trim()
    .toLowerCase();

  if (!email) {
    return {
      allowed: false,
      reason: "Unable to retrieve the Trimble user email.",
      user: null,
      errorCode: "EMAIL_NOT_AVAILABLE",
    };
  }

  const { data, error } = await supabase
    .from("trimble_users")
    .select("*")
    .ilike("trimble_email", email)
    .maybeSingle();

  if (error) {
    console.error("Check Trimble user failed:", error);

    return {
      allowed: false,
      reason: "Unable to verify your license. Please try again later.",
      user: null,
      errorCode: "LICENSE_CHECK_FAILED",
    };
  }

  /*
   * Email không tồn tại trong trimble_users:
   * không cấp quyền Viewer mặc định.
   */
  if (!data) {
    return {
      allowed: false,

      reason:
        `The account '${email}' does not have a valid license. ` +
        "Please purchase a license to continue.",

      user: null,

      errorCode: "LICENSE_NOT_FOUND",
    };
  }

  const user = mapUser(data);

  const today = getLocalDateString();

  const normalizedStatus = String(user.status || "")
    .trim()
    .toLowerCase();

  const normalizedRole = String(user.role || "")
    .trim()
    .toLowerCase();

  if (normalizedStatus !== "active") {
    return {
      allowed: false,
      reason:
        "Your license is inactive. Please purchase or renew your license.",
      user,
      errorCode: "LICENSE_INACTIVE",
    };
  }

  if (user.startDate && today < user.startDate) {
    return {
      allowed: false,

      reason: `Your license will be activated on ${user.startDate}.`,

      user,

      errorCode: "LICENSE_NOT_STARTED",
    };
  }

  if (user.endDate && today > user.endDate) {
    return {
      allowed: false,

      reason:
        `Your license expired on ${user.endDate}. ` +
        "Please renew your license to continue.",

      user,

      errorCode: "LICENSE_EXPIRED",
    };
  }

  /*
   * Chỉ chấp nhận các role hợp lệ.
   */
  if (normalizedRole !== "owner" && normalizedRole !== "viewer") {
    return {
      allowed: false,

      reason: "Your account does not have a valid application role.",

      user,

      errorCode: "INVALID_ROLE",
    };
  }

  return {
    allowed: true,
    reason: null,
    errorCode: null,

    user: {
      ...user,

      role: normalizedRole,

      isOwner: normalizedRole === "owner",

      isViewer: normalizedRole === "viewer",
    },
  };
}
