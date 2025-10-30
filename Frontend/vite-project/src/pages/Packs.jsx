import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  DatePicker,
  Input,
  Space,
  message,
  Typography,
  Tooltip,
  Tag,
  Spin,
  Modal,
  Dropdown,
} from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  EditOutlined,
  PrinterOutlined,
  MoreOutlined,
  InboxOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isSupervisor } from '../utils/roles';
import { getCompletedPacks, reopenPack, downloadPackingSlip } from '../api/packs';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

function Packs() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [searchInput, setSearchInput] = useState('');

  // Check if user is supervisor
  if (!isSupervisor(user?.role)) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <Title level={3} type="danger">Access Denied</Title>
          <Text type="secondary">This page is only available to supervisors.</Text>
        </div>
      </Card>
    );
  }

  // Load completed packs
  const loadPacks = useCallback(async () => {
    try {
      setLoading(true);
      // For now, don't use date filtering since completed_at is not populated
      const search = searchTerm.trim() || null;
      const data = await getCompletedPacks(null, search);
      setPacks(data);
    } catch (error) {
      message.error(error.message || 'Failed to load completed packs');
    } finally {
      setLoading(false);
    }
  }, [searchTerm]);

  // Load packs on mount and when filters change
  useEffect(() => {
    loadPacks();
  }, [loadPacks]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const [reopenModal, setReopenModal] = useState({ visible: false, packId: null, orderNo: null });

  const handleModifyPack = async (packId, orderNo) => {
    setReopenModal({ visible: true, packId, orderNo });
  };

  const handleConfirmReopen = async () => {
    const { packId, orderNo } = reopenModal;
    try {
      await reopenPack(packId);
      message.success(`Pack reopened successfully. Redirecting to Orders page for order ${orderNo}...`);
      // Close modal first
      setReopenModal({ visible: false, packId: null, orderNo: null });
      // Navigate to Orders page with the order number
      navigate(`/orders?order=${orderNo}`);
    } catch (error) {
      message.error(error.message || 'Failed to reopen pack');
    }
  };

  const handleCancelReopen = () => {
    setReopenModal({ visible: false, packId: null, orderNo: null });
  };

  const handlePrintPackingSlip = async (packId) => {
    try {
      await downloadPackingSlip(packId);
      message.success('Packing slip download started');
    } catch (error) {
      message.error(error.message || 'Failed to download packing slip');
    }
  };

  const columns = [
    {
      title: 'Order No',
      dataIndex: 'order_no',
      key: 'order_no',
      sorter: (a, b) => a.order_no.localeCompare(b.order_no),
      render: (text) => (
        <Text strong style={{ color: '#1677ff' }}>{text}</Text>
      ),
    },
    {
      title: 'Customer',
      dataIndex: 'customer_name',
      key: 'customer_name',
      sorter: (a, b) => (a.customer_name || '').localeCompare(b.customer_name || ''),
      render: (text) => text || <Text type="secondary">-</Text>,
    },
    {
      title: 'Ship To',
      key: 'ship_to',
      render: (_, record) => {
        const city = record.ship_city || '';
        const province = record.ship_province || '';
        const shipTo = [city, province].filter(Boolean).join(', ');
        return shipTo || <Text type="secondary">-</Text>;
      },
    },
    {
      title: 'Packager',
      dataIndex: 'packager_username',
      key: 'packager_username',
      render: (text) => (
        <Tag color="blue">{text || 'Unknown'}</Tag>
      ),
    },
    {
      title: 'Ship By',
      dataIndex: 'ship_by',
      key: 'ship_by',
      render: (text) => text || <Text type="secondary">-</Text>,
    },
    {
      title: 'Total Boxes',
      dataIndex: 'total_boxes',
      key: 'total_boxes',
      sorter: (a, b) => a.total_boxes - b.total_boxes,
      align: 'center',
      render: (value) => (
        <Tag color="green">{value}</Tag>
      ),
    },
    {
      title: 'Total Weight',
      dataIndex: 'total_weight',
      key: 'total_weight',
      sorter: (a, b) => (a.total_weight || 0) - (b.total_weight || 0),
      align: 'center',
      render: (value) => value ? `${value} lb` : <Text type="secondary">-</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Reopen Pack for Modification">
            <Button
              type="primary"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleModifyPack(record.pack_id, record.order_no)}
              style={{
                background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
                borderColor: '#1677ff',
              }}
            >
              Reopen
            </Button>
          </Tooltip>
          
          <Tooltip title="Print Packing Slip">
            <Button
              size="small"
              icon={<PrinterOutlined />}
              onClick={() => handlePrintPackingSlip(record.pack_id)}
              style={{
                background: 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)',
                borderColor: '#52c41a',
                color: 'white',
              }}
            >
              Print
            </Button>
          </Tooltip>
          
          <Dropdown
            menu={{
              items: [
                {
                  key: 'more',
                  label: 'More Actions',
                  disabled: true,
                },
              ],
            }}
            trigger={['click']}
          >
            <Button
              size="small"
              icon={<MoreOutlined />}
              disabled
            />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <InboxOutlined style={{ color: '#1677ff', fontSize: '20px' }} />
            <Title level={3} style={{ margin: 0 }}>
              Completed Packs
            </Title>
            <Text type="secondary" style={{ fontSize: '14px' }}>
              View and manage completed packing orders
            </Text>
          </div>
        }
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={loadPacks}
            loading={loading}
          >
            Refresh
          </Button>
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
        {/* Filters */}
        <div style={{ 
          marginBottom: '24px', 
          padding: '16px',
          background: 'linear-gradient(135deg, #fafbff 0%, #f0f8ff 100%)',
          borderRadius: '8px',
          border: '1px solid #e6f7ff'
        }}>
          <Space size="large" wrap>
            <div>
              <Text strong style={{ display: 'block', marginBottom: '4px' }}>
                <CalendarOutlined style={{ marginRight: '4px' }} />
                Completion Date
              </Text>
              <DatePicker
                value={selectedDate}
                onChange={setSelectedDate}
                format="YYYY-MM-DD"
                placeholder="All completed packs"
                style={{ width: 200 }}
                disabled
              />
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px' }}>
                Showing all completed packs
              </Text>
            </div>
            
            <div>
              <Text strong style={{ display: 'block', marginBottom: '4px' }}>
                <SearchOutlined style={{ marginRight: '4px' }} />
                Search Orders
              </Text>
              <Input
                placeholder="Search by order number or customer name"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ width: 300 }}
                prefix={<SearchOutlined style={{ color: '#1677ff' }} />}
              />
            </div>
          </Space>
        </div>

        {/* Results Summary */}
        <div style={{ 
          marginBottom: '16px',
          padding: '8px 12px',
          background: '#e6f7ff',
          borderRadius: '6px',
          border: '1px solid #91d5ff'
        }}>
          <Text strong style={{ color: '#1677ff' }}>
            Showing {packs.length} completed pack{packs.length !== 1 ? 's' : ''} 
            {selectedDate && ` for ${selectedDate.format('MMMM D, YYYY')}`}
            {searchTerm && ` matching "${searchTerm}"`}
          </Text>
        </div>

        {/* Table */}
        <Table
          columns={columns}
          dataSource={packs}
          rowKey="pack_id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) =>
              `${range[0]}-${range[1]} of ${total} packs`,
          }}
          style={{
            borderRadius: '8px',
          }}
          scroll={{ x: 1000 }}
        />

        {/* Reopen Confirmation Modal */}
        <Modal
          title="Reopen Pack for Modification"
          open={reopenModal.visible}
          onOk={handleConfirmReopen}
          onCancel={handleCancelReopen}
          okText="Yes, Reopen"
          cancelText="Cancel"
          okType="primary"
        >
          <p>
            Are you sure you want to reopen pack for order <strong>{reopenModal.orderNo}</strong>?
          </p>
          <p>
            This will change the pack status from 'complete' back to 'in progress' and make it available for modification.
          </p>
        </Modal>
      </Card>
    </div>
  );
}

export default Packs;