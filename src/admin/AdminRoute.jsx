import React, { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Result, Spin } from "antd";
import { getCurrentAdmin } from "../services/adminAuthService";

export default function AdminRoute() {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function verifyAdmin() {
      try {
        const result = await getCurrentAdmin();
        if (!cancelled) setAdmin(result);
      } catch (verifyError) {
        console.error("Verify admin failed:", verifyError);
        if (!cancelled) {
          setError(verifyError?.message || "Unable to verify administrator access.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    verifyAdmin();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Spin size="large" tip="Checking administrator access..." />
      </div>
    );
  }

  if (error) {
    return <Result status="500" title="Unable to verify access" subTitle={error} />;
  }

  if (!admin) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }

  return <Outlet context={{ admin }} />;
}
