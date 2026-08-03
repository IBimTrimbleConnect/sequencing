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
    throw new Error("Unable to retrieve the Trimble user email.");
  }

  const { data, error } = await supabase
    .from("trimble_users")
    .select("*")
    .ilike("trimble_email", email)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return {
      allowed: true,
      reason: null,
      user: {
        id: null,
        trimbleEmail: email,
        status: "active",
        startDate: null,
        endDate: null,
        role: "viewer",
        isOwner: false,
        isViewer: true,
        createdAt: null,
        updatedAt: null,
      },
    };
  }

  const user = mapUser(data);
  const today = getLocalDateString();

  if (String(user.status).toLowerCase() !== "active") {
    return {
      allowed: false,
      reason: "Your account is inactive.",
      user,
    };
  }

  if (user.startDate && today < user.startDate) {
    return {
      allowed: false,
      reason: `Your account will be activated on ${user.startDate}.`,
      user,
    };
  }

  if (user.endDate && today > user.endDate) {
    return {
      allowed: false,
      reason: `Your account expired on ${user.endDate}.`,
      user,
    };
  }

  return {
    allowed: true,
    reason: null,
    user: {
      ...user,
      isOwner: String(user.role).toLowerCase() === "owner",
      isViewer: String(user.role).toLowerCase() === "viewer",
    },
  };
}
