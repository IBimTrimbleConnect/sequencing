import { supabase } from "./supabase";

const ADMIN_COLUMNS = `
  user_id,
  email,
  created_at
`;

const normalizeEmail = (value) =>
  String(value || "").trim().toLowerCase();

async function getAdminRow(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from("admin_users")
    .select(ADMIN_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function loginAdmin({ email, password }) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) throw new Error("Admin email is required.");
  if (!password) throw new Error("Password is required.");

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error) throw error;

  const authUser = data?.user || data?.session?.user;

  if (!authUser?.id) {
    await supabase.auth.signOut();
    throw new Error("Unable to retrieve the authenticated user.");
  }

  const admin = await getAdminRow(authUser.id);

  if (!admin) {
    await supabase.auth.signOut();
    throw new Error("This account does not have administrator access.");
  }

  return {
    session: data.session,
    authUser,
    admin,
  };
}

export async function getCurrentAdmin() {
  const { data, error } = await supabase.auth.getSession();

  if (error) throw error;

  const session = data?.session;
  if (!session?.user?.id) return null;

  const admin = await getAdminRow(session.user.id);
  if (!admin) return null;

  return {
    session,
    authUser: session.user,
    admin,
  };
}

export async function logoutAdmin() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
