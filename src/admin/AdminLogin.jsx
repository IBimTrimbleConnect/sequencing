import React, { useEffect, useState } from "react";
import { Button, Card, Form, Input, Spin, Typography, message } from "antd";
import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { getCurrentAdmin, loginAdmin } from "../services/adminAuthService";

const { Title, Text } = Typography;

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [alreadyLoggedIn, setAlreadyLoggedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      try {
        const currentAdmin = await getCurrentAdmin();
        if (!cancelled) setAlreadyLoggedIn(Boolean(currentAdmin));
      } catch (error) {
        console.error("Check admin session failed:", error);
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    }

    checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  if (checkingSession) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (alreadyLoggedIn) {
    return <Navigate to="/admin/users" replace />;
  }

  const handleLogin = async (values) => {
    setLoading(true);

    try {
      await loginAdmin({ email: values.email, password: values.password });
      const destination = location.state?.from?.pathname || "/admin/users";
      navigate(destination, { replace: true });
    } catch (error) {
      console.error("Admin login failed:", error);
      message.error(error?.message || "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f5f5f5",
        padding: 16,
      }}
    >
      <Card style={{ width: "100%", maxWidth: 420, boxShadow: "0 12px 40px rgba(0,0,0,0.08)" }}>
        <Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
          Admin Login
        </Title>
        <Text type="secondary">Sign in to manage Trimble users.</Text>

        <Form layout="vertical" onFinish={handleLogin} style={{ marginTop: 24 }}>
          <Form.Item
            label="Email"
            name="email"
            rules={[
              { required: true, message: "Please enter your email." },
              { type: "email", message: "Please enter a valid email." },
            ]}
          >
            <Input prefix={<MailOutlined />} autoComplete="email" disabled={loading} />
          </Form.Item>

          <Form.Item
            label="Password"
            name="password"
            rules={[{ required: true, message: "Please enter your password." }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              autoComplete="current-password"
              disabled={loading}
            />
          </Form.Item>

          <Button type="primary" htmlType="submit" block loading={loading}>
            Sign In
          </Button>
        </Form>
      </Card>
    </div>
  );
}
