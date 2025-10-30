import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  message,
  Space,
  Popconfirm,
  Tag,
  Typography,
  Divider,
  Tooltip,
  Badge,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  KeyOutlined,
  UserOutlined,
  TeamOutlined,
  ReloadOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import { userAPI } from '../api/users';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;
const { Option } = Select;

const ROLES = {
  PACKAGER: 'packager',
  SUPERVISOR: 'supervisor',
};

const ROLE_LABELS = {
  [ROLES.PACKAGER]: 'Packager',
  [ROLES.SUPERVISOR]: 'Supervisor',
};

const ROLE_COLORS = {
  [ROLES.PACKAGER]: 'blue',
  [ROLES.SUPERVISOR]: 'red',
};

function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [passwordUserId, setPasswordUserId] = useState(null);
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();

  // Load users on component mount
  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await userAPI.getUsers();
      setUsers(data);
    } catch (error) {
      message.error('Failed to load users');
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = () => {
    setEditingUser(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEditUser = (user) => {
    setEditingUser(user);
    form.setFieldsValue({
      username: user.username,
      role: user.role,
      active: user.active,
    });
    setModalVisible(true);
  };

  const handlePasswordReset = (user) => {
    setPasswordUserId(user.id);
    passwordForm.resetFields();
    setPasswordModalVisible(true);
  };

  const handleDeleteUser = async (userId) => {
    try {
      await userAPI.deleteUser(userId);
      message.success('User deleted successfully');
      loadUsers();
    } catch (error) {
      message.error(error.response?.data?.detail || 'Failed to delete user');
    }
  };

  const handleToggleActive = async (user) => {
    try {
      await userAPI.toggleUserActive(user.id);
      message.success(`User ${user.active ? 'deactivated' : 'activated'} successfully`);
      loadUsers();
    } catch (error) {
      message.error(error.response?.data?.detail || 'Failed to toggle user status');
    }
  };

  const handleModalSubmit = async (values) => {
    try {
      if (editingUser) {
        // Update existing user
        await userAPI.updateUser(editingUser.id, values);
        message.success('User updated successfully');
      } else {
        // Create new user
        await userAPI.createUser(values);
        message.success('User created successfully');
      }
      setModalVisible(false);
      loadUsers();
    } catch (error) {
      message.error(error.response?.data?.detail || 'Failed to save user');
    }
  };

  const handlePasswordSubmit = async (values) => {
    try {
      await userAPI.resetPassword(passwordUserId, values.password);
      message.success('Password reset successfully');
      setPasswordModalVisible(false);
    } catch (error) {
      message.error(error.response?.data?.detail || 'Failed to reset password');
    }
  };

  const columns = [
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      render: (text, record) => (
        <Space>
          <UserOutlined style={{ color: '#1677ff' }} />
          <Text strong={record.id === currentUser?.id}>{text}</Text>
          {record.id === currentUser?.id && (
            <Tag color="gold" size="small">You</Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role) => (
        <Tag color={ROLE_COLORS[role]} style={{ fontWeight: '600' }}>
          {ROLE_LABELS[role]}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'active',
      key: 'active',
      render: (active, record) => (
        <Badge
          status={active ? 'success' : 'error'}
          text={
            <Text type={active ? 'success' : 'danger'}>
              {active ? 'Active' : 'Inactive'}
            </Text>
          }
        />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Edit User">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEditUser(record)}
              disabled={record.id === currentUser?.id}
            />
          </Tooltip>
          
          <Tooltip title="Reset Password">
            <Button
              type="text"
              icon={<KeyOutlined />}
              onClick={() => handlePasswordReset(record)}
            />
          </Tooltip>
          
          <Tooltip title={record.active ? 'Deactivate' : 'Activate'}>
            <Button
              type="text"
              icon={record.active ? <LockOutlined /> : <UnlockOutlined />}
              onClick={() => handleToggleActive(record)}
              disabled={record.id === currentUser?.id}
              style={{ color: record.active ? '#ff4d4f' : '#52c41a' }}
            />
          </Tooltip>
          
          <Popconfirm
            title="Delete User"
            description="Are you sure you want to delete this user? This action cannot be undone."
            onConfirm={() => handleDeleteUser(record.id)}
            okText="Yes"
            cancelText="No"
            disabled={record.id === currentUser?.id}
          >
            <Tooltip title="Delete User">
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                disabled={record.id === currentUser?.id}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <TeamOutlined style={{ color: '#1677ff', fontSize: '20px' }} />
            <Title level={3} style={{ margin: 0 }}>
              User Management
            </Title>
            <Text type="secondary" style={{ fontSize: '14px' }}>
              Manage system users and permissions
            </Text>
          </div>
        }
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={loadUsers}
              loading={loading}
            >
              Refresh
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateUser}
              style={{
                background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
                borderColor: '#1677ff',
                boxShadow: '0 2px 8px rgba(22, 119, 255, 0.3)',
              }}
            >
              Add User
            </Button>
          </Space>
        }
        style={{
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          border: '1px solid #f0f0f0',
        }}
        headStyle={{
          background: 'linear-gradient(135deg, #fafbff 0%, #f0f8ff 100%)',
          borderBottom: '2px solid #e6f7ff',
          borderRadius: '12px 12px 0 0',
        }}
      >
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) =>
              `${range[0]}-${range[1]} of ${total} users`,
          }}
          style={{
            borderRadius: '8px',
          }}
        />
      </Card>

      {/* Create/Edit User Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
              color: 'white',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: 'bold'
            }}>
              {editingUser ? 'EDIT' : 'CREATE'}
            </span>
            <span style={{ fontSize: '16px', fontWeight: '600' }}>
              {editingUser ? 'Edit User' : 'New User'}
            </span>
          </div>
        }
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={500}
        style={{ top: 80 }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleModalSubmit}
          style={{ marginTop: '16px' }}
        >
          <Form.Item
            label={<span style={{ fontWeight: '600' }}>Username</span>}
            name="username"
            rules={[
              { required: true, message: 'Please enter username' },
              { min: 3, max: 64, message: 'Username must be 3-64 characters' },
            ]}
          >
            <Input
              placeholder="Enter username"
              size="large"
              prefix={<UserOutlined style={{ color: '#1677ff' }} />}
            />
          </Form.Item>

          {!editingUser && (
            <Form.Item
              label={<span style={{ fontWeight: '600' }}>Password</span>}
              name="password"
              rules={[
                { required: true, message: 'Please enter password' },
                { min: 6, message: 'Password must be at least 6 characters' },
              ]}
            >
              <Input.Password
                placeholder="Enter password"
                size="large"
                prefix={<KeyOutlined style={{ color: '#1677ff' }} />}
              />
            </Form.Item>
          )}

          <Form.Item
            label={<span style={{ fontWeight: '600' }}>Role</span>}
            name="role"
            rules={[{ required: true, message: 'Please select role' }]}
          >
            <Select
              placeholder="Select user role"
              size="large"
              style={{ width: '100%' }}
            >
              <Option value={ROLES.PACKAGER}>
                <Tag color={ROLE_COLORS[ROLES.PACKAGER]}>
                  {ROLE_LABELS[ROLES.PACKAGER]}
                </Tag>
              </Option>
              <Option value={ROLES.SUPERVISOR}>
                <Tag color={ROLE_COLORS[ROLES.SUPERVISOR]}>
                  {ROLE_LABELS[ROLES.SUPERVISOR]}
                </Tag>
              </Option>
            </Select>
          </Form.Item>

          <Form.Item
            label={<span style={{ fontWeight: '600' }}>Status</span>}
            name="active"
            valuePropName="checked"
          >
            <Switch
              checkedChildren="Active"
              unCheckedChildren="Inactive"
              style={{
                background: form.getFieldValue('active') ? '#52c41a' : '#d9d9d9',
              }}
            />
          </Form.Item>

          <Divider />

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <Button onClick={() => setModalVisible(false)} size="large">
              Cancel
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              style={{
                background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
                borderColor: '#1677ff',
                boxShadow: '0 2px 8px rgba(22, 119, 255, 0.3)',
              }}
            >
              {editingUser ? 'Update User' : 'Create User'}
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Password Reset Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              background: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)',
              color: 'white',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: 'bold'
            }}>
              RESET
            </span>
            <span style={{ fontSize: '16px', fontWeight: '600' }}>
              Reset Password
            </span>
          </div>
        }
        open={passwordModalVisible}
        onCancel={() => setPasswordModalVisible(false)}
        footer={null}
        width={400}
        style={{ top: 100 }}
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handlePasswordSubmit}
          style={{ marginTop: '16px' }}
        >
          <Form.Item
            label={<span style={{ fontWeight: '600' }}>New Password</span>}
            name="password"
            rules={[
              { required: true, message: 'Please enter new password' },
              { min: 6, message: 'Password must be at least 6 characters' },
            ]}
          >
            <Input.Password
              placeholder="Enter new password"
              size="large"
              prefix={<KeyOutlined style={{ color: '#ff4d4f' }} />}
            />
          </Form.Item>

          <Form.Item
            label={<span style={{ fontWeight: '600' }}>Confirm Password</span>}
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Please confirm password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password
              placeholder="Confirm new password"
              size="large"
              prefix={<KeyOutlined style={{ color: '#ff4d4f' }} />}
            />
          </Form.Item>

          <Divider />

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <Button onClick={() => setPasswordModalVisible(false)} size="large">
              Cancel
            </Button>
            <Button
              type="primary"
              danger
              htmlType="submit"
              size="large"
              style={{
                background: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)',
                borderColor: '#ff4d4f',
                boxShadow: '0 2px 8px rgba(255, 77, 79, 0.3)',
              }}
            >
              Reset Password
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

export default UserManagement;
