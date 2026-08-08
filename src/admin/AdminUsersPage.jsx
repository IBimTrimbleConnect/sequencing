import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Input,
  Layout,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import {
  EditOutlined,
  LogoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useNavigate, useOutletContext } from "react-router-dom";
import AdminUserModal from "./AdminUserModal";
import {
  createTrimbleUser,
  deactivateTrimbleUser,
  getTrimbleUsers,
  updateTrimbleUser,
} from "../services/trimbleUserAdminService";
import { logoutAdmin } from "../services/adminAuthService";

const { Header, Content } = Layout;
const { Title, Text } = Typography;

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const { admin } = useOutletContext();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [search, setSearch] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await getTrimbleUsers());
    } catch (error) {
      console.error("Load Trimble users failed:", error);
      message.error(error?.message || "Unable to load Trimble users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return users;

    return users.filter((user) =>
      [
        user.email,
        user.status,
        user.role,
        user.licenseType,
        user.trialCount,
      ].some((value) =>
        String(value ?? "").toLowerCase().includes(keyword),
      ),
    );
  }, [search, users]);

  const handleSubmit = async (values) => {
    setSaving(true);

    try {
      if (editingUser?.id) {
        const updated = await updateTrimbleUser({
          id: editingUser.id,
          ...values,
        });

        setUsers((current) =>
          current.map((user) =>
            String(user.id) === String(updated.id) ? updated : user,
          ),
        );

        message.success("Trimble user updated.");
      } else {
        const created = await createTrimbleUser(values);

        setUsers((current) =>
          [...current, created].sort((a, b) =>
            String(a.email || "").localeCompare(String(b.email || "")),
          ),
        );

        message.success("Trimble user created.");
      }

      setModalOpen(false);
      setEditingUser(null);
    } catch (error) {
      console.error("Save Trimble user failed:", error);
      message.error(error?.message || "Unable to save Trimble user.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (user) => {
    try {
      const updated = await deactivateTrimbleUser(user.id);

      setUsers((current) =>
        current.map((item) =>
          String(item.id) === String(updated.id) ? updated : item,
        ),
      );

      message.success("Trimble user deactivated.");
    } catch (error) {
      console.error("Deactivate Trimble user failed:", error);
      message.error(error?.message || "Unable to deactivate Trimble user.");
    }
  };

  const handleLogout = async () => {
    try {
      await logoutAdmin();
      navigate("/admin/login", { replace: true });
    } catch (error) {
      message.error(error?.message || "Unable to sign out.");
    }
  };

  const columns = [
    { title: "Email", dataIndex: "email", key: "email" },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (value) => (
        <Tag color={String(value).toLowerCase() === "active" ? "success" : "default"}>
          {value || "Unknown"}
        </Tag>
      ),
    },
    {
      title: "Role",
      dataIndex: "role",
      key: "role",
      width: 100,
      render: (value) => <Tag>{value || "Viewer"}</Tag>,
    },
    {
      title: "License",
      dataIndex: "licenseType",
      key: "licenseType",
      width: 110,
      render: (value) => (
        <Tag color={value === "Annual" ? "blue" : "orange"}>
          {value || "Trial"}
        </Tag>
      ),
    },
    {
      title: "Trial Count",
      dataIndex: "trialCount",
      key: "trialCount",
      width: 105,
      align: "center",
      render: (value) => {
        const count = Number(value ?? 0);
        return <Tag color={count > 0 ? "warning" : "default"}>{count}</Tag>;
      },
    },
    {
      title: "Start Date",
      dataIndex: "startDate",
      key: "startDate",
      width: 120,
      render: (value) => value || "-",
    },
    {
      title: "End Date",
      dataIndex: "endDate",
      key: "endDate",
      width: 120,
      render: (value) => value || "-",
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      fixed: "right",
      render: (_, user) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingUser(user);
              setModalOpen(true);
            }}
          />

          {String(user.status).toLowerCase() === "active" && (
            <Popconfirm
              title="Deactivate user?"
              description={user.email}
              okText="Deactivate"
              cancelText="Cancel"
              onConfirm={() => handleDeactivate(user)}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<StopOutlined />}
              />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header
        style={{
          height: "auto",
          minHeight: 64,
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          background: "#fff",
          borderBottom: "1px solid #f0f0f0",
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Trimble Users
          </Title>

          <Text type="secondary">
            Signed in as{" "}
            {admin?.admin?.email ||
              admin?.authUser?.email ||
              "Administrator"}
          </Text>
        </div>

        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={loadUsers}
            loading={loading}
          >
            Refresh
          </Button>

          <Button icon={<LogoutOutlined />} onClick={handleLogout}>
            Sign Out
          </Button>
        </Space>
      </Header>

      <Content style={{ padding: 20 }}>
        <Card>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
              flexWrap: "wrap",
            }}
          >
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Search email, status, role, license..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 360, maxWidth: "100%" }}
            />

            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingUser(null);
                setModalOpen(true);
              }}
            >
              Add User
            </Button>
          </div>

          <Table
            rowKey="id"
            loading={loading}
            dataSource={filteredUsers}
            columns={columns}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (total) => `${total} user(s)`,
            }}
            scroll={{ x: 1050 }}
          />
        </Card>
      </Content>

      <AdminUserModal
        open={modalOpen}
        editingUser={editingUser}
        loading={saving}
        onCancel={() => {
          if (saving) return;
          setModalOpen(false);
          setEditingUser(null);
        }}
        onSubmit={handleSubmit}
      />
    </Layout>
  );
}
