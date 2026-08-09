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

const createFreeUser = ({
  email,
  sourceUser = null,
  reason = "LICENSE_NOT_FOUND",
}) => ({
  /*
   * Free user không tồn tại trong database.
   */
  id: null,

  email,
  trimbleEmail: email,

  userName:
    sourceUser?.userName || "",

  companyName:
    sourceUser?.companyName || "",

  /*
   * Đây chỉ là trạng thái runtime.
   * Không được ghi vào trimble_users.
   */
  status: "Free",

  role: "free",

  licenseType: "Free",

  startDate: null,
  endDate: null,

  trialCount:
    Number(
      sourceUser?.trialCount ?? 0,
    ),

  isOwner: false,
  isViewer: false,
  isFree: true,

  freeReason: reason,
});

export async function checkTrimbleUser(
  trimbleEmail,
) {
  const email = String(
    trimbleEmail || "",
  )
    .trim()
    .toLowerCase();

  /*
   * Không lấy được email từ Trimble Connect.
   *
   * Không thể cấp Free vì không biết
   * người dùng hiện tại là ai.
   */
  if (!email) {
    return {
      allowed: false,

      reason:
        "Unable to retrieve the Trimble user email.",

      user: null,

      errorCode:
        "EMAIL_NOT_AVAILABLE",
    };
  }

  const {
    data,
    error,
  } = await supabase
    .from("trimble_users")
    .select("*")
    .ilike(
      "trimble_email",
      email,
    )
    .maybeSingle();

  /*
   * Database lỗi thì KHÔNG fallback Free.
   *
   * Nếu Supabase bị lỗi mạng mà tự động Free,
   * user Owner/Viewer hợp lệ cũng sẽ bị
   * chuyển thành Free.
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
   * Không insert vào database.
   * Tạo Free User chỉ ở runtime.
   */
  if (!data) {
    return {
      allowed: true,

      reason: null,

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
    mapUser(data);

  const today =
    getLocalDateString();

  const normalizedStatus =
    String(
      user.status || "",
    )
      .trim()
      .toLowerCase();

  const normalizedRole =
    String(
      user.role || "",
    )
      .trim()
      .toLowerCase();

  /*
   * =====================================================
   * LICENSE INACTIVE
   * =====================================================
   *
   * Có thể coi giống license không còn hiệu lực
   * và fallback về Free.
   */
  if (
    normalizedStatus !==
    "active"
  ) {
    return {
      allowed: true,

      reason: null,

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
   * =====================================================
   * LICENSE CHƯA BẮT ĐẦU
   * =====================================================
   *
   * Mình giữ là không được access license trả phí.
   *
   * Nếu muốn vẫn cho Free thì cũng có thể
   * đổi đoạn này sang createFreeUser().
   */
  if (
    user.startDate &&
    today < user.startDate
  ) {
    return {
      allowed: true,

      reason: null,

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
   * =====================================================
   * LICENSE HẾT HẠN
   * =====================================================
   *
   * Không sửa database.
   * Chỉ chuyển runtime user sang Free.
   */
  if (
    user.endDate &&
    today > user.endDate
  ) {
    return {
      allowed: true,

      reason: null,

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
   * =====================================================
   * LICENSE HỢP LỆ
   * =====================================================
   */

  if (
    normalizedRole !==
      "owner" &&
    normalizedRole !==
      "viewer"
  ) {
    return {
      allowed: false,

      reason:
        "Your account does not have a valid application role.",

      user: null,

      errorCode:
        "INVALID_ROLE",
    };
  }

  return {
    allowed: true,

    reason: null,

    errorCode: null,

    user: {
      ...user,

      role:
        normalizedRole,

      isOwner:
        normalizedRole ===
        "owner",

      isViewer:
        normalizedRole ===
        "viewer",

      isFree: false,
    },
  };
}
